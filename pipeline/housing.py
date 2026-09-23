"""Market housing costs by ZIP, carried to tracts with housing-unit weights."""
from __future__ import annotations

import json

import pandas as pd

from .common import RAW, DataError, assumptions
from .geo import weighted, zip_weights
from .sources import HUD_FY

BEDROOMS = [0, 1, 2, 3, 4]


def _zip(s) -> str:
    return str(int(s)).zfill(5)


def safmr_by_zip() -> dict[int, dict[str, float]]:
    df = pd.read_excel(RAW / f"FY{str(HUD_FY)[2:]}_safmrs.xlsx")
    df.columns = [str(c).replace("\n", " ") for c in df.columns]
    zc = "ZIP Code"
    need = [zc] + [f"SAFMR {b}BR" for b in BEDROOMS]
    missing = [c for c in need if c not in df.columns]
    if missing:
        raise DataError(f"SAFMR file missing columns {missing}; got {list(df.columns)[:8]}")
    df["zip"] = df[zc].map(_zip)
    # A ZIP can appear under two FMR areas; HUD lists each. Keep the first.
    df = df.drop_duplicates("zip")
    return {b: dict(zip(df.zip, df[f"SAFMR {b}BR"].astype(float))) for b in BEDROOMS}


def renter_mix_by_zip() -> dict[str, dict[int, float]]:
    """Share of renter-occupied units by bedroom count (0-4; 5+ counted as 4), ACS B25042 by ZCTA."""
    d = json.load(open(RAW / "acs_B25042_zcta.json"))
    df = pd.DataFrame(d[1:], columns=d[0])
    cols = {0: ["010"], 1: ["011"], 2: ["012"], 3: ["013"], 4: ["014", "015"]}
    out = {}
    for row in df.to_dict("records"):
        counts = {b: sum(float(row[f"B25042_{c}E"] or 0) for c in cs) for b, cs in cols.items()}
        tot = sum(counts.values())
        if tot > 0:
            out[row["zip code tabulation area"]] = {b: v / tot for b, v in counts.items()}
    return out


def zillow_rent_by_zip(safmr: dict[int, dict[str, float]], zori: dict[str, float]) -> dict[int, dict[str, float]]:
    """Split ZORI (all unit sizes) by bedroom count.

    rent_b = ZORI x SAFMR_b / sum_k(mix_k x SAFMR_k), where mix is the ZIP's renter bedroom mix.
    This keeps Zillow's rent level and HUD's ratios between bedroom sizes.
    """
    mix = renter_mix_by_zip()
    out: dict[int, dict[str, float]] = {b: {} for b in BEDROOMS}
    for z, level in zori.items():
        if z not in mix or any(z not in safmr[b] for b in BEDROOMS):
            continue
        typical = sum(mix[z][b] * safmr[b][z] for b in BEDROOMS)
        for b in BEDROOMS:
            out[b][z] = level * safmr[b][z] / typical
    return out


def _zillow_latest(path) -> tuple[dict[str, float], str]:
    header = pd.read_csv(path, nrows=0).columns
    last = [c for c in header if c[:2] == "20"][-1]
    df = pd.read_csv(path, usecols=["RegionName", last], dtype={"RegionName": str})
    df["zip"] = df.RegionName.str.zfill(5)
    s = df.set_index("zip")[last].dropna()
    return s.astype(float).to_dict(), last


def zori_by_zip():
    return _zillow_latest(RAW / "Zip_zori_uc_sfrcondomfr_sm_month.csv")


def zhvi_by_zip():
    """{'all': {...}, 1: {...}, ..., 5: {...}}, month."""
    out, month = {}, None
    out["all"], month = _zillow_latest(RAW / "Zip_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv")
    for b in range(1, 6):
        out[b], m = _zillow_latest(RAW / f"Zip_zhvi_bdrmcnt_{b}_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv")
        if m != month:
            raise DataError(f"ZHVI {b}BR latest month {m} differs from all-homes {month}")
    return out, month


def pmms_latest() -> dict:
    df = pd.read_csv(RAW / "PMMS_history.csv")
    df = df.dropna(subset=["pmms30"])
    last = df.iloc[-1]
    d = pd.to_datetime(last["date"], format="%m/%d/%Y")
    return {"rate_30yr": float(last["pmms30"]) / 100, "week_of": d.date().isoformat()}


def tract_housing(geoids: list[str]) -> tuple[dict[str, dict], dict]:
    zw = zip_weights()
    safmr = safmr_by_zip()
    zori, zori_month = zori_by_zip()
    zillow_rent = zillow_rent_by_zip(safmr, zori)
    zhvi, zhvi_month = zhvi_by_zip()
    min_cov = assumptions()["display"]["min_zip_coverage"]["value"]
    out = {}
    for g in geoids:
        w = zw.get(g)
        if not w:
            raise DataError(f"No ZIP weights for tract {g}")
        rec: dict = {"zips": {z: round(v, 3) for z, v in sorted(w.items(), key=lambda x: -x[1])}}
        rent, flags = {}, []
        for b in BEDROOMS:
            v, cov = weighted(w, safmr[b])
            if v is None:
                raise DataError(f"No SAFMR for any ZIP in tract {g}")
            rent[b] = round(v)
            if cov < min_cov:
                flags.append("safmr_low_coverage")
        rec["safmr"] = rent
        v, cov = weighted(w, zori)
        rec["zori"] = round(v) if v is not None else None
        rec["zori_coverage"] = round(cov, 2)
        zr = {}
        for b in BEDROOMS:
            v, cov = weighted(w, zillow_rent[b])
            zr[b] = round(v) if v is not None and cov >= min_cov else None
        if any(v is None for v in zr.values()):
            rec["rent_zillow"] = None
            flags.append("rent_zillow_unavailable")
        else:
            rec["rent_zillow"] = zr

        # Owner value: bedroom-specific ZHVI (0BR uses the 1BR series), else all-homes, else unavailable.
        val, src = {}, {}
        for b in BEDROOMS:
            series = max(b, 1)
            v, cov = weighted(w, zhvi[series])
            if v is not None and cov >= min_cov:
                val[b], src[b] = round(v, -3), f"zhvi_{series}br"
                continue
            v, cov = weighted(w, zhvi["all"])
            if v is not None and cov >= min_cov:
                val[b], src[b] = round(v, -3), "zhvi_all_homes"
            else:
                val[b], src[b] = None, "unavailable"
        rec["zhvi"] = val
        rec["zhvi_series"] = src
        rec["flags"] = sorted(set(flags))
        out[g] = rec
    meta = {"zori_month": zori_month, "zhvi_month": zhvi_month, "safmr_fy": HUD_FY}
    return out, meta
