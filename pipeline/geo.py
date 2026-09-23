"""Tract geometry, city labels, and crosswalk weights.

Weights are built from 2020 census blocks. Each block's internal point is placed in
a ZCTA and in an MTC TAZ, so:
  zip_weights[tract][zcta] = share of the tract's housing units in that ZCTA
  taz_weights[tract][taz]  = share of the tract's population in that TAZ
Tracts with no housing units (or no population) fall back to land-area shares.
"""
from __future__ import annotations

import json
from functools import lru_cache

import geopandas as gpd
import pandas as pd
from shapely.geometry import Point

from .common import RAW, DataError, counties, county_geoids
from .sources import CB_YEAR

EQUAL_AREA = 3310  # California Albers


@lru_cache
def tracts() -> gpd.GeoDataFrame:
    st = counties()["state_fips"]
    g = gpd.read_file(f"zip://{RAW}/cb_{CB_YEAR}_{st}_tract_500k.zip")
    g = g[(g.STATEFP + g.COUNTYFP).isin(county_geoids()) & (g.ALAND > 0)].copy()
    if g.empty:
        raise DataError("No tracts found for configured counties")
    g["geoid"] = g.GEOID
    return g[["geoid", "NAME", "NAMELSADCO", "ALAND", "geometry"]].reset_index(drop=True)


def tract_labels() -> pd.DataFrame:
    """City (Census place) holding the most of each tract's housing units, else 'Unincorporated'."""
    st = counties()["state_fips"]
    places = gpd.read_file(f"zip://{RAW}/cb_{CB_YEAR}_{st}_place_500k.zip").to_crs(EQUAL_AREA)
    # Census designated places (LSAD 57) are unincorporated communities; label them as such.
    places["label"] = [f"{n} (unincorporated)" if l == "57" else n for n, l in zip(places.NAME, places.LSAD)]
    b = blocks().to_crs(EQUAL_AREA)
    j = gpd.sjoin(b, places[["label", "geometry"]], how="left", predicate="within")
    j = j[~j.index.duplicated()]
    j["label"] = j["label"].fillna("Unincorporated")
    j["w"] = j.hu.where(j.groupby("tract").hu.transform("sum") > 0, 1)
    best = j.groupby(["tract", "label"]).w.sum().reset_index().sort_values("w").groupby("tract").tail(1)
    t = tracts()
    return t[["geoid", "NAME"]].rename(columns={"NAME": "tract_name"}).merge(
        best[["tract", "label"]].rename(columns={"tract": "geoid", "label": "city"}), on="geoid", how="left")


@lru_cache
def blocks() -> gpd.GeoDataFrame:
    """2020 blocks with housing units, population and internal point, for configured counties."""
    frames = []
    for geoid in county_geoids():
        b = gpd.read_file(f"zip://{RAW}/tl_2020_{geoid}_tabblock20.zip")
        pl = json.load(open(RAW / f"pl2020_blocks_{geoid}.json"))
        pl = pd.DataFrame(pl[1:], columns=pl[0])
        pl["GEOID20"] = pl.state + pl.county + pl.tract + pl.block
        pl["hu"] = pl.H1_001N.astype(int)
        pl["pop"] = pl.P1_001N.astype(int)
        b = b.merge(pl[["GEOID20", "hu", "pop"]], on="GEOID20", how="left", validate="1:1")
        if b.hu.isna().any():
            raise DataError(f"{b.hu.isna().sum()} blocks in {geoid} lack PL counts")
        b["tract"] = b.GEOID20.str[:11]
        b["geometry"] = gpd.points_from_xy(b.INTPTLON20.astype(float), b.INTPTLAT20.astype(float), crs=4326)
        frames.append(b[["GEOID20", "tract", "hu", "pop", "geometry"]])
    return gpd.GeoDataFrame(pd.concat(frames, ignore_index=True), crs=4326)


def _assign(pts: gpd.GeoDataFrame, polys: gpd.GeoDataFrame, key: str) -> pd.Series:
    """Polygon key for each point; points outside every polygon take the nearest one."""
    pts = pts.to_crs(EQUAL_AREA)
    polys = polys[[key, "geometry"]].to_crs(EQUAL_AREA)
    j = gpd.sjoin(pts, polys, how="left", predicate="within")
    j = j[~j.index.duplicated()]
    miss = j[key].isna()
    if miss.any():
        near = gpd.sjoin_nearest(pts[miss], polys, how="left")
        near = near[~near.index.duplicated()]
        j.loc[miss, key] = near[key]
    return j[key]


def _weights(b: pd.DataFrame, zone: str, weight: str, fallback: pd.DataFrame) -> dict[str, dict[str, float]]:
    out: dict[str, dict[str, float]] = {}
    for tract, grp in b.groupby("tract"):
        tot = grp[weight].sum()
        if tot > 0:
            s = grp.groupby(zone)[weight].sum() / tot
        else:
            f = fallback[fallback.tract == tract]
            s = f.set_index(zone)["area"] / f["area"].sum()
        out[tract] = {str(k): float(v) for k, v in s.items() if v > 0}
    return out


@lru_cache
def zip_weights() -> dict[str, dict[str, float]]:
    b = blocks().copy()
    z = gpd.read_file(f"zip://{RAW}/cb_2020_us_zcta520_500k.zip")
    b["zcta"] = _assign(b, z.rename(columns={"ZCTA5CE20": "zcta"}), "zcta").values
    rel = pd.read_csv(RAW / "tab20_zcta520_tract20_natl.txt", sep="|", dtype=str)
    rel = rel[rel.GEOID_TRACT_20.str[:5].isin(county_geoids()) & rel.GEOID_ZCTA5_20.notna()]
    fb = pd.DataFrame({"tract": rel.GEOID_TRACT_20, "zcta": rel.GEOID_ZCTA5_20,
                       "area": rel.AREALAND_PART.astype(float)})
    return _weights(b, "zcta", "hu", fb)


@lru_cache
def taz() -> gpd.GeoDataFrame:
    t = gpd.read_file(RAW / "mtc_vmt_taz.geojson")
    if len(t) == 0:
        raise DataError("MTC VMT layer returned no TAZs")
    t["taz"] = t.taz1454.astype(int).astype(str)
    return t


@lru_cache
def taz_weights() -> dict[str, dict[str, float]]:
    b = blocks().copy()
    tz = taz()
    b["taz"] = _assign(b, tz, "taz").values
    # Area fallback: intersect tract polygons with TAZs.
    ov = gpd.overlay(tracts().to_crs(EQUAL_AREA)[["geoid", "geometry"]], tz.to_crs(EQUAL_AREA)[["taz", "geometry"]])
    fb = pd.DataFrame({"tract": ov.geoid, "taz": ov.taz, "area": ov.area})
    return _weights(b, "taz", "pop", fb)


@lru_cache
def tract_2010_weights() -> dict[str, dict[str, float]]:
    """Land-area share of each 2020 tract that falls in each 2010 tract."""
    st = counties()["state_fips"]
    rel = pd.read_csv(RAW / f"tab20_tract20_tract10_st{st}.txt", sep="|", dtype=str)
    rel = rel[rel.GEOID_TRACT_20.str[:5].isin(county_geoids())]
    rel["part"] = rel.AREALAND_PART.astype(float)
    out = {}
    for t20, g in rel.groupby("GEOID_TRACT_20"):
        tot = g.part.sum()
        if tot > 0:
            out[t20] = {r.GEOID_TRACT_10: r.part / tot for r in g.itertuples() if r.part > 0}
    return out


def weighted(weights: dict[str, float], values: dict[str, float]) -> tuple[float | None, float]:
    """Weighted mean over zones that have a value, renormalized. Returns (value, coverage)."""
    have = {z: w for z, w in weights.items() if z in values and values[z] is not None and pd.notna(values[z])}
    cov = sum(have.values())
    if cov <= 0:
        return None, 0.0
    return sum(values[z] * w for z, w in have.items()) / cov, cov


def simplified_geojson(geoids: list[str]) -> dict:
    t = tracts()
    t = t[t.geoid.isin(geoids)].to_crs(EQUAL_AREA)
    t["geometry"] = t.geometry.simplify(25, preserve_topology=True)
    t = t.to_crs(4326)
    gj = json.loads(t[["geoid", "geometry"]].to_json(to_wgs84=True))

    def rnd(c):
        return [rnd(x) for x in c] if isinstance(c[0], list) else [round(c[0], 5), round(c[1], 5)]

    for f in gj["features"]:
        f["geometry"]["coordinates"] = rnd(f["geometry"]["coordinates"])
        f.pop("id", None)
    return gj


STATION_NETWORKS = ("Caltrain", "BART")
STATION_NEAR_M = 400


def tract_places(labels: pd.DataFrame) -> dict[str, dict]:
    """Nearby rail stations and named OSM places for each tract, and a short display label.

    Label: "<city>, near <station> <network>" if a Caltrain or BART station is within 400 m of the tract,
    else "<neighborhood>, <city>" if a named OSM place lies inside it, else None (the UI shows city and tract number).
    """
    pts = []
    for geoid in county_geoids():
        for e in json.load(open(RAW / f"osm_places_{geoid}.json"))["elements"]:
            lat = e.get("lat", e.get("center", {}).get("lat"))
            lon = e.get("lon", e.get("center", {}).get("lon"))
            if lat is None:
                continue
            tags = e["tags"]
            if tags.get("railway") == "station":
                if tags.get("network") not in STATION_NETWORKS:
                    continue
                pts.append({"name": tags["name"], "kind": "station", "network": tags["network"], "geometry": Point(lon, lat)})
            else:
                pts.append({"name": tags["name"], "kind": "place", "network": "", "geometry": Point(lon, lat)})
    if not pts:
        raise DataError("No OSM places found")
    g = gpd.GeoDataFrame(pts, crs=4326).to_crs(EQUAL_AREA)
    t = tracts().to_crs(EQUAL_AREA).set_index("geoid")
    city = labels.set_index("geoid")["city"]
    centers = t.representative_point()
    stations = g[g.kind == "station"]
    places = g[g.kind == "place"]
    out = {}
    for geoid, poly in t.geometry.items():
        c = city.get(geoid, "")
        base = c.replace(" (unincorporated)", "")
        near = stations[stations.distance(poly) <= STATION_NEAR_M].copy()
        near["d"] = near.distance(centers[geoid])
        # One entry per station name, listing every network that stops there (e.g. Millbrae BART/Caltrain).
        st_list = []
        for name, grp in near.sort_values("d").groupby("name", sort=False):
            st_list.append(f"{name} {'/'.join(sorted(grp.network.unique()))}")
        inside = places[places.within(poly) & ~places.name.str.lower().isin({base.lower(), c.lower()})].copy()
        inside["d"] = inside.distance(centers[geoid])
        nb = inside.sort_values("d").name.drop_duplicates().tolist()
        if st_list:
            label = f"{base}, near {st_list[0]}"
        elif nb:
            label = f"{nb[0]}, {base}"
        else:
            label = None
        out[geoid] = {"label": label, "neighborhoods": nb, "stations": st_list}
    return out
