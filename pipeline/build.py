"""Join all sources and emit the browser data files plus data/sources.json.

Run: python -m pipeline.build
"""
from __future__ import annotations

import shutil
import sys

from .common import DATA, SITE_DATA, DataError, assumptions, counties, read_fetch_log, write_json
from .context import tract_acs, tract_vmt
from .geo import blocks, simplified_geojson, tract_labels, tract_places, tracts
from .housing import tract_housing
from .land import tract_land
from .params import build_params
from .sources import SOURCES


def build_sources() -> dict:
    log = read_fetch_log()
    out = {}
    for sid, s in SOURCES.items():
        if sid not in log:
            raise DataError(f"Source {sid} has no fetch record; run make fetch")
        out[sid] = {k: s[k] for k in ("title", "url", "vintage", "classification", "notes")}
        if "landing" in s:
            out[sid]["landing"] = s["landing"]
        out[sid]["retrieved"] = log[sid]["retrieved"]
    return out


def build() -> dict:
    print("Tracts and labels")
    geo = tracts()
    counts = blocks().groupby("tract")[["hu", "pop"]].sum()
    empty = sorted(g for g in geo.geoid if counts.hu.get(g, 0) == 0)
    geoids = sorted(g for g in geo.geoid if g not in empty)
    label_df = tract_labels()
    labels = label_df.set_index("geoid")
    places = tract_places(label_df)
    print(f"  {len(geoids)} tracts with housing; excluded (no housing units): {empty}")

    print("Housing (SAFMR, ZORI, ZHVI)")
    housing, hmeta = tract_housing(geoids)
    print("Land (FHFA)")
    land, lmeta = tract_land(geoids)
    print(f"  methods: {lmeta['methods']}")
    print("VMT (MTC)")
    vmt = tract_vmt(geoids)
    print("ACS context")
    acs = tract_acs(geoids)
    print("Parameters (AAA, EIA, fares, PMMS, taxes)")
    params = build_params()

    county_names = {cfg_fips: name for cfg_fips, name in
                    ((counties()["state_fips"] + c["fips"], c["short_name"]) for c in counties()["counties"])}
    tract_rows = {}
    for g in geoids:
        h, l = housing[g], land[g]
        flags = list(h.pop("flags"))
        if l["land_method"] in ("zip_2022", "county_2022"):
            flags.append(f"land_{l['land_method']}")
        if any(s == "unavailable" for s in h["zhvi_series"].values()):
            flags.append("owner_cost_unavailable")
        tract_rows[g] = {
            "name": labels.loc[g, "tract_name"],
            "city": labels.loc[g, "city"],
            "label": places[g]["label"],
            "neighborhoods": places[g]["neighborhoods"],
            "stations": places[g]["stations"],
            "county": county_names[g[:5]],
            "housing_units_2020": int(counts.hu[g]),
            "population_2020": int(counts["pop"][g]),
            **h,
            **l,
            "vmt_per_resident_weekday": vmt[g]["vmt_per_resident_weekday"],
            "acs": acs.get(g, {}),
            "flags": sorted(flags),
        }

    meta = {
        "counties": county_names,
        "housing": hmeta,
        "land": lmeta,
        "built": read_fetch_log().get("census_cb_tracts", {}).get("retrieved"),
    }
    sources = build_sources()
    params["assumptions"] = assumptions()
    params["meta"] = meta

    SITE_DATA.mkdir(parents=True, exist_ok=True)
    write_json(SITE_DATA / "tracts.geojson", simplified_geojson(geoids), compact=True)
    write_json(SITE_DATA / "tracts.json", tract_rows, compact=True)
    write_json(SITE_DATA / "params.json", params)
    write_json(DATA / "sources.json", sources)
    shutil.copy(DATA / "sources.json", SITE_DATA / "sources.json")
    shutil.copy(DATA.parent / "config" / "assumptions.json", SITE_DATA / "assumptions.json")
    for f in sorted(SITE_DATA.iterdir()):
        print(f"  wrote {f.relative_to(DATA.parent)} ({f.stat().st_size:,} bytes)")
    return tract_rows


def main() -> None:
    try:
        build()
    except DataError as e:
        print(f"\nBUILD FAILED: {e}\nNo values were substituted.", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
