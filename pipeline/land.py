"""Residential land price per square foot by tract (FHFA, Davis et al.).

The FHFA tract panel covers almost no San Mateo tracts, so:
  1. Start from the tract pooled cross-section (as-is $/acre, base year 2015, 2010 tracts).
  2. Map 2010 tracts to 2020 tracts by land-area share.
  3. Scale 2015 -> 2022 by the tract's ZIPs' panel ratio (HU-weighted), else the county ratio.
Fallbacks when step 1 has no value: ZIP 2022 panel value, then county 2022 panel value.
Each tract records which method produced its value.
"""
from __future__ import annotations

import pandas as pd

from .common import RAW, DataError, counties
from .geo import tract_2010_weights, weighted, zip_weights

SQFT_PER_ACRE = 43_560
TARGET_YEAR = 2022
BASE_YEAR = 2015
XLSX = RAW / "Land-Prices_2024_20_June.xlsx"
ACRE_COL = "Land Value\n(Per Acre, As-Is)"


def _sheet(name: str) -> pd.DataFrame:
    df = pd.read_excel(XLSX, sheet_name=name, header=1)
    if ACRE_COL not in df.columns:
        raise DataError(f"FHFA sheet {name!r} lacks {ACRE_COL!r}")
    return df


def tract_land(geoids: list[str]) -> tuple[dict[str, dict], dict]:
    cfg = counties()
    xs = _sheet("Cross-Section Census Tracts")
    xs = xs[xs.State == cfg["state_name"]]
    xs_val = {str(int(t)).zfill(11): float(v) for t, v in zip(xs["Census Tract"], xs[ACRE_COL]) if pd.notna(v)}

    zp = _sheet("Panel ZIP Codes")
    zp["zip"] = zp["ZIP Code"].map(lambda z: str(int(z)).zfill(5))
    zp = zp.pivot_table(index="zip", columns="Year", values=ACRE_COL)
    zip_2022 = zp[TARGET_YEAR].dropna().to_dict()
    zip_ratio = (zp[TARGET_YEAR] / zp[BASE_YEAR]).dropna().to_dict()

    cp = _sheet("Panel Counties")
    cp["fips"] = cp.FIPS.map(lambda f: str(int(f)).zfill(5))
    cp = cp.pivot_table(index="fips", columns="Year", values=ACRE_COL)

    w10 = tract_2010_weights()
    zw = zip_weights()
    out, methods = {}, {}
    for g in geoids:
        county = g[:5]
        if county not in cp.index:
            raise DataError(f"FHFA county panel has no {county}")
        c2022 = float(cp.loc[county, TARGET_YEAR])
        cratio = c2022 / float(cp.loc[county, BASE_YEAR])
        base, cov10 = weighted(w10.get(g, {}), xs_val)
        if base is not None:
            r, rcov = weighted(zw[g], zip_ratio)
            if r is not None and rcov >= 0.5:
                acre, method = base * r, "tract_2015_scaled_by_zip"
            else:
                acre, method = base * cratio, "tract_2015_scaled_by_county"
        else:
            v, zcov = weighted(zw[g], zip_2022)
            if v is not None and zcov >= 0.5:
                acre, method = v, "zip_2022"
            else:
                acre, method = c2022, "county_2022"
        out[g] = {
            "land_per_acre": round(acre, -2),
            "land_per_sqft": round(acre / SQFT_PER_ACRE, 2),
            "land_method": method,
            "land_xs_coverage": round(cov10, 2),
        }
        methods[method] = methods.get(method, 0) + 1
    county_vals = {c: round(float(cp.loc[c, TARGET_YEAR]) / SQFT_PER_ACRE, 2) for c in {g[:5] for g in geoids}}
    return out, {"year": TARGET_YEAR, "methods": methods, "county_per_sqft": county_vals}
