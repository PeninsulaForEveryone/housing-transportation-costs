# PLAN: What Your Location Costs (San Mateo County v1)

Status 2026-09-22: pipeline, tests, sanity table, and front end done. Rent default is Zillow (split by bedroom via HUD ratios and ACS B25042), with HUD as a switch.

## Decisions made (2026-09-22)

- D1 Node: Homebrew could not upgrade Node (it needs Xcode Command Line Tools on this macOS). Instead, the official Node 24.21.0 LTS binary was installed to `~/.local/node-v24.21.0-darwin-arm64` (checksum verified) and pinned in `.nvmrc`.
- D2 Land: tract cross-section scaled to 2022 by the ZIP panel ratio, as proposed. Result for 172 tracts: 144 scaled by ZIP, 13 scaled by county, 14 fall back to ZIP 2022 values (all flagged), and 1 falls back to the county value (flagged).
- D3 Bundled parking: default $1,700/yr (the Gabbe & Pierce abstract figure, nominal) for both used and unused bundled spaces. The unverified $621 figure is not used. The alternative is WGI 2026 construction cost ($43,000/space in SF, hard cost only) annualized at 5% over 50 years, which comes to about $2,360/yr. The UI can switch between the two, and the default is the lower, published figure. All of it lives in `assumptions.json`.
- D4 Fuel: AAA fuel cost per mile is scaled by the EIA California 52-week average price divided by AAA's national $3.151 basis.
- D5 Weights: ZIP to tract uses 2020 block housing units. TAZ to tract uses 2020 block population. Area weights are used only for tracts with no housing.
- D6 Owners: tracts with no ZHVI coverage show owner cost as unavailable. Only 1 tract is affected (SFO), and it is excluded because it has no housing.
- D7 Taxes: includes the federal child tax credit (with its refundable part), CA exemption credits with their phase-out, CA SDI, and the Additional Medicare Tax. Every number is checked against the fetched IRS, FTB and EDD documents at build time.
- D8 Deploy: out of scope. The user handles deployment; no workflow or deploy steps are to be written.
- VMT days/yr: 365 (not 347), because no published source for 347 was found.

## 1. Source reachability check

Every source below was fetched into `raw/` on 2026-09-22 and opened to confirm its format. "OK" means it downloaded and I parsed the fields we need.

| # | Source | Result | Notes |
|---|---|---|---|
| 1 | Census cartographic boundary tracts, **2025** vintage, 500k, CA (`cb_2025_06_tract_500k.zip`) | OK | 173 tracts in 06081, all with land area. This is the 2020 tract geography. The ~160 figure in the brief was the 2010 count. |
| 2a | ACS 5-year **2020-2024** (latest; 2025 5-year is not out yet) | OK, with changes | The Census API now **requires a key** (keyless calls redirect to `missing_key.html`). Your key is in `.env` (gitignored) as `CENSUS_API_KEY`. It is used only at build time and never ships to the browser. With the key, the tract query for B19013 returned 174 rows (one is water-only and has no polygon). |
| 2b | ACS summary files (keyless fallback) `acsdt5y2024-b08203/b08301/b19013.dat` | OK | Pipe-delimited, national, 18 to 88 MB each. Estimates and MOEs are included. This is the fallback if no key is set. |
| 3a | HUD Small Area FMR **FY2027** (`FY27_safmrs.xlsx`) | OK, with workaround | Plain curl gets a bot-check 202 with an empty body. It works with a browser User-Agent plus the cookie from the index page. 113 ZIPs in the San Francisco HUD Metro FMR Area, 0 to 4 BR. |
| 3b | Zillow ZORI by ZIP (`Zip_zori_uc_sfrcondomfr_sm_month.csv`) | OK | Latest month 2026-08. **Only 20 San Mateo County ZIPs** have data, so it works as a cross-check only. |
| 3c | Zillow ZHVI by ZIP, middle tier (`Zip_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv`) | OK | Latest month 2026-08. 28 San Mateo County ZIPs. ZIPs with no ZHVI need a fallback (see decision D6). |
| 3d | Freddie Mac PMMS history CSV | OK | Latest is 2026-09-17: 30-yr 6.95%. |
| 3e | Census 2020 ZCTA-to-tract relationship file | OK | It has **land area only** and no housing-unit counts. HU weighting needs 2020 block counts (decision D5). |
| 4 | AAA Your Driving Costs 2025 fact sheet (PDF) | OK | Parsed: depreciation $4,334/yr, finance $1,131/yr, insurance $1,694/yr, license/registration/taxes $813/yr, fuel 13¢/mi (at $3.151/gal national), maintenance/repair/tires 11.04¢/mi. All figures are averages over 5 yrs and 75k mi. |
| 5 | MTC home-based VMT per resident, Plan Bay Area 2050+ (Travel Model 1.5, TAZ1454) | OK | ArcGIS FeatureServer `mtc_vmt_home_work_pba2050p/0`, item modified 2026-04. 156 San Mateo TAZs. Field `home_vmt_2023by` is **weekday** daily VMT per resident for the 2023 base year: min 8.1, median 14.1, max 39.1 mi. It excludes airport trips, trips leaving the region, and drive access to transit. Because it is available, the CNT fallback is not needed. |
| 5b | (FYI) C/CAG county-model VMT by TAZ on the same MTC org (`county_vmt_metrics_taz`) | OK | Finer zones than TAZ1454. Not used, because the brief names TM1.5. Noted as a possible upgrade. |
| 6 | Caltrain fares page | OK | Adult Clipper monthly pass: $96 / $150 / $204 / $258 / $312 / $366 for 1 to 6 zones. Monthly passes of 2+ zones include free SamTrans local rides. |
| 6b | SamTrans fares page | OK | Adult Clipper monthly pass is $65.60. |
| 7a | Gabbe & Pierce 2017, Housing Policy Debate, doi:10.1080/10511482.2016.1205647 | **Partial** | The abstract (via OpenAlex) confirms **$1,700/yr, about 17% of rent**. The article is paywalled (tandfonline returns 403, and OpenAlex lists no open-access copy). **I could not verify the $621/yr figure for carless renters** (decision D3). |
| 7b | FHFA land prices, Version 4.0, June 2024 (`Land-Prices_2024_20_June.xlsx`) | **Partial: tract panel unusable** | "Panel Census Tracts" has **1** San Mateo tract. "Cross-Section Census Tracts" has **136** San Mateo tracts, but it pools 2012-2022 at base year 2015, uses 2010 tract IDs (123 of 136 match 2020 IDs), and covers single-family parcels only. The ZIP panel has 41 SM ZIPs through 2022, and the county panel has 06081 through 2022 ($7.91M/acre as-is). See decision D2. |
| 8a | IRS Rev. Proc. 2025-32 (2026 inflation adjustments, reflects OBBBA) | OK | 2026 brackets parse cleanly (MFJ: 10% up to $24,800, 12% up to $100,800, ...). |
| 8b | FICA 2026 wage base | OK via IRS Pub 15 (2026) | Pub 15 gives $184,500. SSA.gov returns 403 to scripts, so IRS Pub 15 is the recorded source. |
| 8c | CA 2026 brackets | OK via EDD | The FTB 2026 540 schedule is **not published yet** (404). EDD's "California Withholding Schedules for 2026, Method B" (`26methb.pdf`) has FTB's 2026 annual tax rate tables, the standard deduction ($5,706 / $11,412), and exemption credits. I will use it, and swap in the FTB schedule once it is out. |
| 8d | CA SDI 2026 | OK | EDD rates page: 1.3%, no wage cap. |
| extra | EIA weekly California regular gasoline price (keyless XLS) | OK | $6.003/gal for the week of 2026-09-21. Used only if you approve decision D4. |
| extra | Census 2020-to-2010 tract relationship file, CA | OK | Needed to carry the FHFA 2010-tract values onto 2020 tracts. |

**Failures you need to know about:**
- FHFA tract panel: only 1 tract.
- Gabbe & Pierce $621 figure: could not verify.
- FTB 2026 schedule: not published (EDD substitute found).
- SSA: blocked (IRS substitute found).
- Census API: now keyed (your key solves this).

## 2. Proposed file layout

```
Makefile                      # make data | make test | make sanity
.env                          # CENSUS_API_KEY (gitignored)
config/
  counties.json               # [{"state":"06","county":"081","name":"San Mateo", "hud_fmr_area":..., ...}]; add counties here
  assumptions.json            # every tunable constant, each with value, unit, rationale, source_id
data/
  sources.json                # id -> {url, vintage, retrieved, classification: observed|modeled|assumption, notes}
pipeline/
  fetch.py                    # download to raw/ (cached; browser UA for HUD); writes retrieval dates
  geo.py                      # tracts -> simplified GeoJSON; ZCTA->tract & TAZ->tract & 2010->2020 weights
  acs.py                      # B08203, B08301, B19013 est + MOE (API w/ key, summary-file fallback)
  housing.py                  # SAFMR, ZORI, ZHVI by ZIP -> tract
  land.py                     # FHFA land $/acre -> tract (with fallback flags)
  vmt.py                      # MTC TAZ home VMT -> tract
  static_params.py            # AAA, fares, PMMS, EIA, tax tables -> site/data/params.json
  build.py                    # join and emit site/data/*.json; validate; print sanity table
  tests/                      # pytest: crosswalk weights sum to 1, no NaNs, tax parity cases
site/                         # Vite root
  index.html, methodology.html
  src/
    main.ts, state.ts (URL <-> state), map.ts (MapLibre + choropleth),
    household.ts (pure budget arithmetic), taxes.ts (pure), sankey.ts (d3-sankey),
    export.ts (PNG 1080x1350), table.ts (accessible table), presets.ts, format.ts
    *.test.ts                 # vitest: taxes, household arithmetic, URL round-trip
  data/                       # emitted: tracts.geojson, tracts.json, params.json, sources.json
README.md
```

Browser data (estimated 300 to 600 KB total):
- `tracts.geojson`: simplified geometry.
- `tracts.json`: per tract, rent by BR, ZHVI, land $/sqft, VMT/resident, ACS context with MOE, and flags.
- `params.json`: AAA, fares, taxes, PMMS, and the defaults from assumptions.

Taxes live in TypeScript because they depend on the household. Python writes the tables, and a shared fixture keeps a few test cases identical in both languages.

## 3. Method notes (so you can object before I build)

- **Rent** = SAFMR for the chosen bedroom count, taken from the tract's HU-weighted (or area-weighted) ZIPs. SAFMR is HUD's 40th-percentile gross rent for recent movers, so it runs slightly low. ZORI is shown next to it where it exists.
- **Owner cost** = ZHVI × (1 − down %) amortized at the PMMS 30-yr rate, plus property tax, plus insurance. Down %, the tax rate, and insurance are assumptions.
- **Household VMT** = `home_vmt_2023by` × household size × days/yr × car-use factor. Days/yr is an assumption; I propose 347, CARB's usual weekday-to-annual factor. The per-resident figure averages over car-free residents too. If cars = 0, driving VMT is 0. The user can override VMT.
- **Car storage, bundled garage** = Gabbe & Pierce $1,700/yr. The alternative method is local construction cost per space × yield, and both values appear on the methodology page. A car-free renter in a bundled building is charged the carless figure (D3).
- **Land-value parking** (owned garage/driveway and curb) = land $/sqft × stall sqft × yield. Curb defaults: 160 sqft, 5%. Garage: 200 sqft. The curb value is shown as a range against the user's optional private-rent figure, with the lower value as the default.
- **Taxes**: federal + CA + FICA (SS to the wage base, Medicare including the 0.9% additional tax) + CA SDI. Filing status: MFJ if 2 adults, otherwise HoH if there are children, otherwise single. All income is treated as wages, split evenly across workers for the SS cap.

## 4. Decisions needed from you

- **D1. Node toolchain.** This machine has Node v10.15 and no npm. Vite needs Node 20+. OK to run `brew install node` (or would you prefer fnm/volta)? I'll pin the version in `.nvmrc` and `package.json` engines.
- **D2. FHFA land values.** The tract panel covers 1 SM tract. My proposal is the tract cross-section (base 2015), mapped from 2010 to 2020 tracts by area and scaled to 2022 by that tract's ZIP panel ratio (ZIP 2022 ÷ ZIP 2015). The scaling would fall back to the county ratio. Tracts missing from the cross-section fall back to the ZIP 2022 value and then the county value, and each fallback is flagged. The alternative is simpler: ZIP 2022 panel values for every tract (coarser, but no 2015-base splice). Which do you want?
- **D3. Gabbe & Pierce $621/yr for carless renters.** I can't reach the full text. Options:
  - (a) you provide the page or table reference and I cite it;
  - (b) apply $1,700 to car-free renters in bundled units too (the paper's headline says renters "may be paying for parking that they do not need");
  - (c) leave the carless figure out.

  Separately, the AHS data behind these figures is roughly 2011 dollars. Should I CPI-adjust to 2026 using BLS CPI-U (classified as modeled), or show the nominal paper figure?
- **D4. Fuel price.** AAA's 13¢/mi assumes $3.151/gal national gas. CA gas was $6.00 last week, per EIA. Scale fuel ¢/mi by the EIA CA price (modeled, about 25¢/mi), or keep AAA as published (observed but understated here)? I recommend scaling. AAA insurance and registration are also national averages; I'll note that and not adjust.
- **D5. ZIP-to-tract weights.** Weight by area (as the brief says) or by 2020 housing units (block-level counts from the Census API, which the key now allows)? HU weighting is better where ZIPs include open space, which is common on the coast side. I recommend HU.
- **D6. Owner cost for ZIPs with no ZHVI.** 28 SM ZIPs have ZHVI. For tracts with none, fall back to the county ZHVI and flag it, or mark owner cost as unavailable for that tract?
- **D7. Taxes beyond brackets.** Include the federal Child Tax Credit (2026: $2,200/child), CA SDI, and the CA dependent exemption credit? I recommend yes. Otherwise families are overstated by several thousand dollars.

After you answer, I'll build the pipeline and tests and print the 5-tract sanity table (downtown San Mateo near Caltrain, Half Moon Bay, Hillsborough, East Palo Alto, Daly City). I won't start the UI until you've seen that table.
