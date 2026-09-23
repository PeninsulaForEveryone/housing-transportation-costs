"""Download every source into raw/ (cached). Stops with DataError on any failure.

Run: python -m pipeline.fetch [--refresh]
"""
from __future__ import annotations

import sys
from pathlib import Path

import requests

from .common import BROWSER_UA, RAW, DataError, census_key, counties, log_fetch
from .sources import MTC_VMT_LAYER, SOURCES

TIMEOUT = 300


def _session() -> requests.Session:
    s = requests.Session()
    s.headers["User-Agent"] = BROWSER_UA
    return s


def _download(sess, source_id: str, url: str, dest: Path, refresh: bool, *, log_url: str | None = None,
              expect: str | None = None, referer: str | None = None) -> Path:
    if dest.exists() and dest.stat().st_size > 0 and not refresh:
        return dest
    headers = {"Referer": referer} if referer else {}
    r = sess.get(url, timeout=TIMEOUT, headers=headers)
    if r.status_code != 200 or not r.content:
        raise DataError(f"{source_id}: GET {log_url or url} returned HTTP {r.status_code}, {len(r.content)} bytes")
    if expect and expect not in r.headers.get("content-type", ""):
        raise DataError(f"{source_id}: expected content-type {expect}, got {r.headers.get('content-type')}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(r.content)
    log_fetch(source_id, log_url or url, dest)
    print(f"  fetched {dest.name} ({len(r.content):,} bytes)")
    return dest


OSM_QUERY = """[out:json][timeout:150];
area["name"="{county}"]["boundary"="administrative"]["admin_level"="6"]->.a;
(nwr(area.a)["place"~"^(neighbourhood|suburb|quarter|hamlet|village)$"]["name"];
 node(area.a)["railway"="station"]["name"];);
out center tags;"""


def _post_overpass(sess, county: str, dest: Path, refresh: bool) -> None:
    if dest.exists() and dest.stat().st_size > 0 and not refresh:
        return
    url = SOURCES["osm_places"]["url"]
    # Overpass refuses browser-like agents; identify the build script instead.
    r = sess.post(url, data={"data": OSM_QUERY.format(county=county)}, timeout=TIMEOUT,
                  headers={"User-Agent": "what-your-location-costs/0.1 (data build script)"})
    if r.status_code != 200 or not r.json().get("elements"):
        raise DataError(f"osm_places: Overpass returned HTTP {r.status_code} or no elements for {county}")
    dest.write_bytes(r.content)
    log_fetch("osm_places", url, dest)
    print(f"  fetched {dest.name} ({len(r.content):,} bytes)")


def fetch_all(refresh: bool = False) -> None:
    cfg = counties()
    st = cfg["state_fips"]
    sess = _session()
    key = census_key()
    if not key:
        raise DataError("CENSUS_API_KEY is not set (env or .env). The Census API now requires a key.")

    def fmt(u, **kw):
        return u.format(state=st, state_name_upper=cfg["state_name"].upper(), **kw)

    print("Census geography")
    for sid in ["census_cb_tracts", "census_cb_places", "census_zcta", "census_zcta_tract_rel", "census_tract_rel_2010"]:
        u = fmt(SOURCES[sid]["url"])
        _download(sess, sid, u, RAW / Path(u).name, refresh)

    for c in cfg["counties"]:
        cty = c["fips"]
        _post_overpass(sess, c["name"], RAW / f"osm_places_{st}{cty}.json", refresh)
        u = fmt(SOURCES["census_blocks"]["url"], county=cty)
        _download(sess, "census_blocks", u, RAW / Path(u).name, refresh)

        u = fmt(SOURCES["census_pl_blocks"]["url"], county=cty)
        _download(sess, "census_pl_blocks", f"{u}&key={key}", RAW / f"pl2020_blocks_{st}{cty}.json", refresh,
                  log_url=u, expect="json")

        for table in ["B08203", "B08301", "B19013"]:
            u = fmt(SOURCES["acs"]["url"], county=cty, table=table)
            _download(sess, "acs", f"{u}&key={key}", RAW / f"acs_{table}_{st}{cty}.json", refresh,
                      log_url=u, expect="json")
        u = SOURCES["acs"]["url"].split("?")[0].replace("/acs5", "/acs5/groups/{t}.json")
        for table in ["B08203", "B08301", "B19013"]:
            gu = u.format(t=table)
            _download(sess, "acs", gu, RAW / f"acs_{table}_vars.json", refresh, expect="json")

    u = SOURCES["acs"]["url"].split("?")[0]
    q = f"{u}?get=group(B25042)&for=zip%20code%20tabulation%20area:*"
    _download(sess, "acs", f"{q}&key={key}", RAW / "acs_B25042_zcta.json", refresh, log_url=q, expect="json")

    print("Housing")
    s = SOURCES["hud_safmr"]
    if not (RAW / Path(s["url"]).name).exists() or refresh:
        sess.get(s["landing"], timeout=TIMEOUT)  # HUD sets a cookie on the index page before serving files
    _download(sess, "hud_safmr", s["url"], RAW / Path(s["url"]).name, refresh, referer=s["landing"],
              expect="spreadsheet")
    for sid in ["zillow_zori", "zillow_zhvi", "freddie_pmms", "fhfa_land"]:
        s = SOURCES[sid]
        for u in [s["url"], *s.get("extra_urls", [])]:
            _download(sess, sid, u, RAW / Path(u).name, refresh)

    print("Transportation")
    for sid in ["aaa_2025", "eia_ca_gas"]:
        u = SOURCES[sid]["url"]
        _download(sess, sid, u, RAW / Path(u).name, refresh)
    mtc_names = ",".join(f"'{c['mtc_county']}'" for c in cfg["counties"])
    q = (f"{MTC_VMT_LAYER}/query?where=county%20IN%20({mtc_names})&outFields=*"
         f"&outSR=4326&f=geojson")
    _download(sess, "mtc_vmt", q, RAW / "mtc_vmt_taz.geojson", refresh)
    _download(sess, "mtc_vmt", f"{MTC_VMT_LAYER}?f=json", RAW / "mtc_vmt_layer.json", refresh)
    _download(sess, "caltrain_fares", SOURCES["caltrain_fares"]["url"], RAW / "caltrain_fares.html", refresh)
    _download(sess, "samtrans_fares", SOURCES["samtrans_fares"]["url"], RAW / "samtrans_fares.html", refresh)

    print("Parking and taxes")
    _download(sess, "gabbe_pierce_2017",
              "https://api.openalex.org/works/doi:10.1080/10511482.2016.1205647",
              RAW / "gabbe_pierce_openalex.json", refresh, log_url=SOURCES["gabbe_pierce_2017"]["url"])
    _download(sess, "ca_civ_1947_1", SOURCES["ca_civ_1947_1"]["url"], RAW / "ca_civ_1947_1.html", refresh)
    _download(sess, "wgi_2026", SOURCES["wgi_2026"]["url"], RAW / "wgi_2026.html", refresh)
    for sid in ["irs_rp_2025_32", "irs_pub15_2026", "ftb_2025_schedules", "ftb_2025_booklet", "edd_2026_methb"]:
        u = SOURCES[sid]["url"]
        _download(sess, sid, u, RAW / Path(u).name, refresh)
    for u in [SOURCES["irs_sch8812"]["url"], *SOURCES["irs_sch8812"]["extra_urls"]]:
        _download(sess, "irs_sch8812", u, RAW / Path(u).name, refresh)
    _download(sess, "irs_amt_qa", SOURCES["irs_amt_qa"]["url"], RAW / "irs_amt_qa.html", refresh)
    _download(sess, "edd_sdi_2026", SOURCES["edd_sdi_2026"]["url"], RAW / "edd_rates.html", refresh)


def main() -> None:
    try:
        fetch_all(refresh="--refresh" in sys.argv)
    except (DataError, requests.RequestException) as e:
        print(f"\nFETCH FAILED: {e}\nNo values were substituted. Fix the source or its URL in pipeline/sources.py.",
              file=sys.stderr)
        sys.exit(1)
    print("All sources present in raw/.")


if __name__ == "__main__":
    main()
