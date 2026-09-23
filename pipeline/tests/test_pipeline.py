"""Checks on the emitted data. Run after `make data`: pytest pipeline/tests"""
import json
import math

import pytest

from pipeline.common import ROOT, SITE_DATA, assumptions
from pipeline.geo import taz_weights, zip_weights
from pipeline.sources import SOURCES


@pytest.fixture(scope="module")
def tracts():
    return json.load(open(SITE_DATA / "tracts.json"))


@pytest.fixture(scope="module")
def params():
    return json.load(open(SITE_DATA / "params.json"))


def test_tract_count_and_geometry(tracts):
    gj = json.load(open(SITE_DATA / "tracts.geojson"))
    ids = {f["properties"]["geoid"] for f in gj["features"]}
    assert ids == set(tracts), "geometry and data must cover the same tracts"
    assert len(tracts) >= 150


@pytest.mark.parametrize("weights", [zip_weights, taz_weights])
def test_crosswalk_weights_sum_to_one(weights, tracts):
    w = weights()
    for g in tracts:
        assert math.isclose(sum(w[g].values()), 1.0, abs_tol=1e-6), g


def test_every_tract_has_budget_inputs(tracts):
    for g, r in tracts.items():
        for b in "01234":
            assert 1000 < r["safmr"][b] < 10000, (g, b)
        assert 20 < r["land_per_sqft"] < 2000, g
        assert 1 < r["vmt_per_resident_weekday"] < 80, g
        for b, v in r["zhvi"].items():
            assert v is None or 200_000 < v < 20_000_000, (g, b)
            assert (v is None) == (r["zhvi_series"][b] == "unavailable")


def test_rent_rises_with_bedrooms(tracts):
    for g, r in tracts.items():
        for series in ("safmr", "rent_zillow"):
            if r[series] is None:
                continue
            rents = [r[series][b] for b in "01234"]
            assert rents == sorted(rents), (g, series)
            assert 1000 < rents[0] and rents[-1] < 15000, (g, series)


def test_zillow_rent_mostly_available(tracts):
    missing = [g for g, r in tracts.items() if r["rent_zillow"] is None]
    assert len(missing) / len(tracts) < 0.1
    for g in missing:
        assert "rent_zillow_unavailable" in tracts[g]["flags"]


def test_fallbacks_are_flagged(tracts):
    for g, r in tracts.items():
        if r["land_method"] in ("zip_2022", "county_2022"):
            assert f"land_{r['land_method']}" in r["flags"]
        if any(v is None for v in r["zhvi"].values()):
            assert "owner_cost_unavailable" in r["flags"]


def test_acs_moe_present_where_estimates_shown(tracts):
    for g, r in tracts.items():
        acs = r["acs"]
        for group in ("vehicles", "commute"):
            for k, v in acs.get(group, {}).items():
                if v["share"] is not None:
                    assert v["moe"] is not None, (g, group, k)


def test_params_parsed(params):
    a = params["aaa"]
    assert a["depreciation"] == 4334 and a["finance"] == 1131 and a["insurance"] == 1694
    assert params["transit"]["caltrain"]["monthly_by_zones"]["1"] > 0
    assert 0.02 < params["pmms"]["rate_30yr"] < 0.15
    assert 2 < params["ca_gas"]["avg_52wk"] < 10


def test_sources_complete():
    s = json.load(open(ROOT / "data" / "sources.json"))
    assert set(s) == set(SOURCES)
    for sid, v in s.items():
        assert v["retrieved"] and v["url"].startswith("http"), sid
        assert v["classification"] in ("observed", "modeled", "assumption"), sid


def test_assumptions_well_formed():
    for group, items in assumptions().items():
        if group.startswith("_"):
            continue
        for k, v in items.items():
            assert {"value", "unit", "classification", "note"} <= set(v), (group, k)
            if "source" in v:
                assert v["source"] in SOURCES, (group, k)


def test_place_labels(tracts):
    labeled = [r for r in tracts.values() if r["label"]]
    assert len(labeled) > len(tracts) * 0.3
    for g, r in tracts.items():
        assert isinstance(r["neighborhoods"], list) and isinstance(r["stations"], list)
        if r["label"]:
            assert r["city"].replace(" (unincorporated)", "") in r["label"], (g, r["label"])
        for s in r["stations"]:
            assert s.endswith(("Caltrain", "BART", "BART/Caltrain")), s
