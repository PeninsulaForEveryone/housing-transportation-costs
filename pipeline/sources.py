"""Registry of every external source. fetch.py downloads them; build.py writes
data/sources.json from this registry plus the retrieval dates in the fetch log.

classification describes how the value reaches the budget:
  observed   published measurement used as-is
  modeled    derived by a model (ours or the publisher's)
  assumption a chosen constant (these live in config/assumptions.json)
"""
from __future__ import annotations

ACS_YEAR = 2024
CB_YEAR = 2025
HUD_FY = 2027
MTC_VMT_LAYER = (
    "https://services3.arcgis.com/i2dkYWmb4wHvYPda/arcgis/rest/services/"
    "mtc_vmt_home_work_pba2050p/FeatureServer/0"
)
ZILLOW = "https://files.zillowstatic.com/research/public_csvs"

SOURCES: dict[str, dict] = {
    "census_cb_tracts": {
        "title": f"Census cartographic boundary file, census tracts, {CB_YEAR}, 1:500k",
        "url": f"https://www2.census.gov/geo/tiger/GENZ{CB_YEAR}/shp/cb_{CB_YEAR}_{{state}}_tract_500k.zip",
        "vintage": str(CB_YEAR), "classification": "observed",
        "notes": "2020 tract geography. Simplified for the web map.",
    },
    "census_cb_places": {
        "title": f"Census cartographic boundary file, places, {CB_YEAR}, 1:500k",
        "url": f"https://www2.census.gov/geo/tiger/GENZ{CB_YEAR}/shp/cb_{CB_YEAR}_{{state}}_place_500k.zip",
        "vintage": str(CB_YEAR), "classification": "observed",
        "notes": "Used only to label tracts with the city containing their center.",
    },
    "census_zcta": {
        "title": "Census cartographic boundary file, ZIP Code Tabulation Areas, 2020, 1:500k",
        "url": "https://www2.census.gov/geo/tiger/GENZ2020/shp/cb_2020_us_zcta520_500k.zip",
        "vintage": "2020", "classification": "observed",
        "notes": "ZCTAs approximate USPS ZIP codes. Used to assign census blocks to ZIPs.",
    },
    "census_blocks": {
        "title": "TIGER/Line 2020 census blocks (PL 94-171 release)",
        "url": "https://www2.census.gov/geo/tiger/TIGER2020PL/STATE/{state}_{state_name_upper}/{state}{county}/tl_2020_{state}{county}_tabblock20.zip",
        "vintage": "2020", "classification": "observed",
        "notes": "Block internal points, used to build housing-unit and population weights.",
    },
    "census_pl_blocks": {
        "title": "2020 Census Redistricting Data (PL 94-171): housing units (H1_001N) and population (P1_001N) by block",
        "url": "https://api.census.gov/data/2020/dec/pl?get=H1_001N,P1_001N&for=block:*&in=state:{state}%20county:{county}%20tract:*",
        "vintage": "2020", "classification": "observed",
        "notes": "Weights for ZIP-to-tract (housing units) and TAZ-to-tract (population).",
    },
    "census_zcta_tract_rel": {
        "title": "Census 2020 ZCTA to census tract relationship file",
        "url": "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_tract20_natl.txt",
        "vintage": "2020", "classification": "observed",
        "notes": "Land-area weights. Fallback only, for tracts with no housing units.",
    },
    "census_tract_rel_2010": {
        "title": "Census 2020 tract to 2010 tract relationship file",
        "url": "https://www2.census.gov/geo/docs/maps-data/data/rel2020/tract/tab20_tract20_tract10_st{state}.txt",
        "vintage": "2020", "classification": "observed",
        "notes": "Carries FHFA values published on 2010 tracts onto 2020 tracts.",
    },
    "osm_places": {
        "title": "OpenStreetMap: named neighborhoods, villages, and rail stations (via the Overpass API)",
        "url": "https://overpass-api.de/api/interpreter",
        "landing": "https://www.openstreetmap.org/copyright",
        "vintage": "query as retrieved", "classification": "observed",
        "notes": "Labels only: a tract is named for the neighborhood or station inside it. Not used in any estimate. Data (c) OpenStreetMap contributors, ODbL.",
    },
    "acs": {
        "title": f"American Community Survey 5-year estimates, {ACS_YEAR - 4}-{ACS_YEAR}: B08203, B08301, B19013 (tracts); B25042 (ZCTAs)",
        "url": f"https://api.census.gov/data/{ACS_YEAR}/acs/acs5?get=group({{table}})&for=tract:*&in=state:{{state}}%20county:{{county}}",
        "vintage": f"{ACS_YEAR - 4}-{ACS_YEAR}", "classification": "observed",
        "notes": "B08203, B08301, B19013 are context only, shown with margins of error. B25042 (renter units by bedrooms, by ZIP) sets the bedroom mix used to split Zillow's all-sizes rent by bedroom count.",
    },
    "hud_safmr": {
        "title": f"HUD Small Area Fair Market Rents, FY{HUD_FY}",
        "url": f"https://www.huduser.gov/portal/datasets/fmr/fmr{HUD_FY}/FY{str(HUD_FY)[2:]}_safmrs.xlsx",
        "landing": "https://www.huduser.gov/portal/datasets/fmr/smallarea/index.html",
        "vintage": f"FY{HUD_FY}", "classification": "observed",
        "notes": "40th percentile gross rent for recent movers, by ZIP and bedroom count. Alternative renter shelter cost, source of bedroom ratios, and fallback where Zillow has no data.",
    },
    "zillow_zori": {
        "title": "Zillow Observed Rent Index (ZORI), all homes plus multifamily, smoothed, by ZIP",
        "url": f"{ZILLOW}/zori/Zip_zori_uc_sfrcondomfr_sm_month.csv",
        "landing": "https://www.zillow.com/research/data/",
        "vintage": "latest month in file", "classification": "observed",
        "notes": "Default renter shelter cost. ZORI covers all unit sizes; it is split by bedroom count using HUD SAFMR bedroom ratios and each ZIP's renter bedroom mix (ACS B25042). Tracts where ZIPs with ZORI hold under half the housing units fall back to HUD.",
    },
    "zillow_zhvi": {
        "title": "Zillow Home Value Index (ZHVI), middle tier, by ZIP, all homes and by bedroom count",
        "url": f"{ZILLOW}/zhvi/Zip_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv",
        "extra_urls": [
            f"{ZILLOW}/zhvi/Zip_zhvi_bdrmcnt_{b}_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv"
            for b in range(1, 6)
        ],
        "landing": "https://www.zillow.com/research/data/",
        "vintage": "latest month in file", "classification": "observed",
        "notes": "Home value for owners. Bedroom-specific series used when available.",
    },
    "freddie_pmms": {
        "title": "Freddie Mac Primary Mortgage Market Survey, 30-year fixed rate history",
        "url": "https://www.freddiemac.com/pmms/docs/PMMS_history.csv",
        "landing": "https://www.freddiemac.com/pmms",
        "vintage": "latest week in file", "classification": "observed",
        "notes": "Mortgage rate for owner payment.",
    },
    "fhfa_land": {
        "title": "FHFA, The Price of Residential Land for Counties, ZIP Codes, and Census Tracts (Davis, Larson, Oliner & Shui), Version 4.0",
        "url": "https://www.fhfa.gov/sites/default/files/2024-08/Land-Prices_2024_20_June.xlsx",
        "landing": "https://www.fhfa.gov/research/papers/wp1901",
        "vintage": "June 2024 release, data 2012-2022", "classification": "modeled",
        "notes": "Land value per acre, single-family parcels. Tract cross-section (2015 base) scaled to 2022 with the ZIP or county panel.",
    },
    "aaa_2025": {
        "title": "AAA, Your Driving Costs 2025 fact sheet",
        "url": "https://newsroom.aaa.com/wp-content/uploads/2025/09/UPDATE-AAA-Fact-Sheet-Your-Driving-Cost-9.2025-1.pdf",
        "vintage": "2025", "classification": "observed",
        "notes": "New-car national averages over 5 years and 75,000 miles. AAA's later editions changed methodology and are not directly comparable.",
    },
    "eia_ca_gas": {
        "title": "EIA, Weekly California regular all formulations retail gasoline price",
        "url": "https://www.eia.gov/dnav/pet/hist_xls/EMM_EPMR_PTE_SCA_DPGw.xls",
        "landing": "https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?n=PET&s=EMM_EPMR_PTE_SCA_DPG&f=W",
        "vintage": "trailing 52 weeks", "classification": "observed",
        "notes": "Scales AAA fuel cost per mile from the national to the California price.",
    },
    "mtc_vmt": {
        "title": "MTC, Vehicle Miles Traveled (Plan Bay Area 2050+), home-based VMT per resident by TAZ, 2023 base year",
        "url": MTC_VMT_LAYER,
        "landing": "https://opendata.mtc.ca.gov/",
        "vintage": "2023 base year (Travel Model 1.5)", "classification": "modeled",
        "notes": "Typical weekday. Excludes airport trips, trips leaving the region, and drive access to transit.",
    },
    "caltrain_fares": {
        "title": "Caltrain fares",
        "url": "https://www.caltrain.com/fares",
        "vintage": "page as retrieved", "classification": "observed",
        "notes": "Adult Clipper monthly pass by number of zones.",
    },
    "samtrans_fares": {
        "title": "SamTrans fares",
        "url": "https://www.samtrans.com/fares",
        "vintage": "page as retrieved", "classification": "observed",
        "notes": "Adult Clipper monthly pass, local and express.",
    },
    "gabbe_pierce_2017": {
        "title": "Gabbe, C.J. and Pierce, G. (2017). Hidden Costs and Deadweight Losses: Bundled Parking and Residential Rents in the Metropolitan United States. Housing Policy Debate 27(2).",
        "url": "https://doi.org/10.1080/10511482.2016.1205647",
        "vintage": "2017 (American Housing Survey data)", "classification": "modeled",
        "notes": "Abstract states garage parking adds about $1,700/yr, about 17% of rent. Full text is paywalled; only the abstract figures are used.",
        "manual": True,
    },
    "wgi_2026": {
        "title": "WGI, 2026 Parking Structure Cost Outlook (press release)",
        "url": "https://parkingtoday.com/press-releases/wgi-releases-2026-parking-structure-cost-outlook-finds-national-construction-costs-rise-6/",
        "vintage": "published 2026-08-31", "classification": "observed",
        "notes": "San Francisco median $43,000 per space, hard construction cost only.",
        "manual": True,
    },
    "ca_civ_1947_1": {
        "title": "California Civil Code section 1947.1 (AB 1317, 2023): unbundled parking in new residential buildings",
        "url": "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1947.1",
        "vintage": "page as retrieved", "classification": "observed",
        "notes": "Applies to 16+ unit buildings with a certificate of occupancy on or after Jan 1, 2025, in listed counties. San Mateo County is not listed.",
    },
    "irs_rp_2025_32": {
        "title": "IRS Revenue Procedure 2025-32 (2026 inflation adjustments)",
        "url": "https://www.irs.gov/pub/irs-drop/rp-25-32.pdf",
        "vintage": "tax year 2026", "classification": "observed",
        "notes": "Federal brackets, standard deduction, child tax credit.",
    },
    "irs_pub15_2026": {
        "title": "IRS Publication 15 (2026), Employer's Tax Guide",
        "url": "https://www.irs.gov/pub/irs-pdf/p15.pdf",
        "vintage": "2026", "classification": "observed",
        "notes": "Social Security wage base, FICA rates, Additional Medicare Tax threshold.",
    },
    "irs_sch8812": {
        "title": "IRS Schedule 8812 (Form 1040) and its instructions, tax year 2025",
        "url": "https://www.irs.gov/pub/irs-pdf/f1040s8.pdf",
        "extra_urls": ["https://www.irs.gov/pub/irs-pdf/i1040s8.pdf"],
        "vintage": "2025 form (thresholds are statutory, not indexed)", "classification": "observed",
        "notes": "Child tax credit phase-out ($400,000 joint, $200,000 other; 5% of excess rounded up to $1,000) and refundable portion (15% of earned income over $2,500).",
    },
    "irs_amt_qa": {
        "title": "IRS, Questions and answers for the Additional Medicare Tax",
        "url": "https://www.irs.gov/businesses/small-businesses-self-employed/questions-and-answers-for-the-additional-medicare-tax",
        "vintage": "page as retrieved", "classification": "observed",
        "notes": "0.9% Additional Medicare Tax thresholds by filing status (statutory, not indexed).",
    },
    "ftb_2025_schedules": {
        "title": "California FTB, 2025 California Tax Rate Schedules",
        "url": "https://www.ftb.ca.gov/forms/2025/2025-540-tax-rate-schedules.pdf",
        "vintage": "tax year 2025 (latest published)", "classification": "observed",
        "notes": "The 2026 schedule is not yet published. EDD's 2026 withholding tables use the same bracket thresholds.",
    },
    "ftb_2025_booklet": {
        "title": "California FTB, 2025 Form 540 booklet",
        "url": "https://www.ftb.ca.gov/forms/2025/2025-540-booklet.pdf",
        "vintage": "tax year 2025", "classification": "observed",
        "notes": "Standard deduction, exemption credits and their phase-out, Behavioral Health Services Tax.",
    },
    "edd_2026_methb": {
        "title": "California EDD, California Withholding Schedules for 2026, Method B",
        "url": "https://edd.ca.gov/siteassets/files/pdf_pub_ctr/26methb.pdf",
        "vintage": "2026", "classification": "observed",
        "notes": "Confirms 2026 CA standard deduction and bracket thresholds.",
    },
    "edd_sdi_2026": {
        "title": "California EDD, Rates and withholding (SDI rate 2026)",
        "url": "https://edd.ca.gov/en/payroll_taxes/rates_and_withholding/",
        "vintage": "2026", "classification": "observed",
        "notes": "SDI withholding rate 1.3%, no wage cap.",
    },
}
