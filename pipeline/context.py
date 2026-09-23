"""MTC home-based VMT per resident, and ACS context (with margins of error)."""
from __future__ import annotations

import json
import math

import pandas as pd

from .common import RAW, DataError, county_geoids
from .geo import taz, taz_weights, weighted


def tract_vmt(geoids: list[str]) -> dict[str, dict]:
    t = taz()
    if "home_vmt_2023by" not in t.columns:
        raise DataError("MTC layer lacks home_vmt_2023by")
    vals = {r.taz: float(r.home_vmt_2023by) for r in t.itertuples() if pd.notna(r.home_vmt_2023by) and r.home_vmt_2023by > 0}
    tw = taz_weights()
    out = {}
    for g in geoids:
        v, cov = weighted(tw.get(g, {}), vals)
        if v is None:
            raise DataError(f"No MTC VMT for tract {g}")
        out[g] = {"vmt_per_resident_weekday": round(v, 2),
                  "tazs": {z: round(w, 3) for z, w in tw[g].items()}}
    return out


def _acs(table: str) -> pd.DataFrame:
    frames = []
    for c in county_geoids():
        d = json.load(open(RAW / f"acs_{table}_{c}.json"))
        frames.append(pd.DataFrame(d[1:], columns=d[0]))
    df = pd.concat(frames, ignore_index=True)
    df["geoid"] = df.state + df.county + df.tract
    return df.set_index("geoid")


def _num(df, col):
    return pd.to_numeric(df[col], errors="coerce")


def _share(num, num_moe, den, den_moe):
    """ACS proportion and its MOE (Census ACS handbook formula)."""
    if not den or den <= 0 or pd.isna(num):
        return None, None
    p = num / den
    rad = num_moe ** 2 - p ** 2 * den_moe ** 2
    if rad < 0:
        rad = num_moe ** 2 + p ** 2 * den_moe ** 2
    return round(p, 3), round(math.sqrt(rad) / den, 3)


def _sum_moe(moes):
    return math.sqrt(sum(m ** 2 for m in moes))


def tract_acs(geoids: list[str]) -> dict[str, dict]:
    veh, mode, inc = _acs("B08203"), _acs("B08301"), _acs("B19013")
    out = {}
    for g in geoids:
        rec = {}
        if g in inc.index:
            e, m = _num(inc, "B19013_001E")[g], _num(inc, "B19013_001M")[g]
            # Census uses large negative sentinels for suppressed or top-coded cells.
            rec["median_hh_income"] = None if pd.isna(e) or e < 0 else int(e)
            rec["median_hh_income_moe"] = None if pd.isna(m) or m < 0 else int(m)
        if g in veh.index:
            v = {k: float(veh.loc[g, k]) for k in veh.columns if k.startswith("B08203_0") and k[-1] in "EM"}
            den, den_m = v["B08203_001E"], v["B08203_001M"]
            cats = {"0": ["002"], "1": ["003"], "2": ["004"], "3+": ["005", "006"]}
            rec["households"] = int(den)
            rec["vehicles"] = {}
            for k, codes in cats.items():
                n = sum(v[f"B08203_{c}E"] for c in codes)
                nm = _sum_moe([v[f"B08203_{c}M"] for c in codes])
                p, pm = _share(n, nm, den, den_m)
                rec["vehicles"][k] = {"share": p, "moe": pm}
        if g in mode.index:
            v = {k: float(mode.loc[g, k]) for k in mode.columns if k.startswith("B08301_0") and k[-1] in "EM"}
            den, den_m = v["B08301_001E"], v["B08301_001M"]
            cats = {"drove_alone": ["003"], "carpool": ["004"], "transit": ["010"],
                    "walk_bike": ["018", "019"], "work_from_home": ["021"], "other": ["016", "017", "020"]}
            rec["workers"] = int(den)
            rec["commute"] = {}
            for k, codes in cats.items():
                n = sum(v[f"B08301_{c}E"] for c in codes)
                nm = _sum_moe([v[f"B08301_{c}M"] for c in codes])
                p, pm = _share(n, nm, den, den_m)
                rec["commute"][k] = {"share": p, "moe": pm}
        out[g] = rec
    return out
