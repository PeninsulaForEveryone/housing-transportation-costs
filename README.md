# What Your Location Costs

A static web tool that holds one household fixed and shows what it would spend on housing and transportation in two San Mateo County census tracts. Each tract gets a Sankey diagram. The diagrams include the costs of car storage that are easy to miss: parking bundled into rent, the land under a garage, and curb space the city provides for free (shown as a non-cash inflow).

- Every figure traces to `data/sources.json` (fetched sources, with retrieval dates) or `config/assumptions.json` (chosen constants).
- Every flow is labeled Observed, Modeled, or Assumption and links to `methodology.html`.
- The URL holds every input and both tracts, so any view can be shared by copying the address.

## Requirements

- Python 3.12 or newer (developed on 3.14)
- Node 20 or newer (pinned to 24 in `.nvmrc`)
- A Census API key (free: https://api.census.gov/data/key_signup.html). Put it in `.env`:

  ```
  CENSUS_API_KEY=your-key
  ```

  `.env` is gitignored. The key is used only while building the data and never reaches the browser.

## Rebuild from a clean checkout

```sh
npm ci                 # JavaScript dependencies
make data              # creates .venv, downloads every source into raw/, builds site/public/data/*.json
make test              # pipeline checks (pytest) and model tests (vitest)
make sanity            # prints inputs and budgets for six contrasting tracts
npm run build          # type-checks and writes the static site to dist/
npm run preview        # serves dist/ at http://localhost:4173
```

`make data` runs two steps, which can also be run separately:

- `make fetch` downloads into `raw/` (gitignored) and skips files already there. To re-download everything, run `.venv/bin/python -m pipeline.fetch --refresh`.
- `make build` parses, joins, validates, and writes the browser data.

If a source cannot be fetched or parsed, or a number no longer matches its source document, the build stops with an error. It never substitutes a value.

For development with live reload: `npm run dev`.

## Publishing (GitHub Pages)

`.github/workflows/pages.yml` builds and publishes the site on every push to `main` (or `master`), and can also be run by hand from the Actions tab. It runs the model tests, then `npm run build`, then deploys `dist/`. It uses the data files already committed in `site/public/data/`, so it needs no Census key and downloads nothing.

One-time setup: in the repository's **Settings > Pages**, set **Source** to **GitHub Actions**.

To publish new data: run `make data && make test` locally, commit the updated `site/public/data/` and `data/sources.json`, and push.

## Layout

```
config/counties.json       counties in the build (add a Bay Area county here)
config/assumptions.json    every tunable constant, with unit, label, and rationale
data/sources.json          generated: every source with URL, vintage, retrieval date, label
pipeline/                  Python: fetch -> parse -> join -> emit
  sources.py               source registry
  fetch.py                 downloads (HUD needs a browser User-Agent and cookie)
  geo.py                   tracts, block-based ZIP/TAZ/2010-tract weights, place names
                           (city, plus OpenStreetMap neighborhoods and Caltrain/BART stations)
  housing.py               Zillow ZORI/ZHVI, HUD SAFMR, PMMS
  land.py                  FHFA land prices
  context.py               MTC VMT, ACS context with margins of error
  params.py                AAA, EIA, fares, tax tables (each checked against its source text)
  build.py                 writes site/public/data/*.json
  tests/                   pytest checks on the emitted data
site/                      Vite + TypeScript front end
  src/model/               pure budget and tax arithmetic, with vitest tests
  src/sankey.ts            d3-sankey diagram (screen and PNG export)
  src/map.ts               MapLibre map with OpenFreeMap basemap (no key)
  src/state.ts             URL <-> state
  methodology.html         method, sources, assumptions, limitations
scripts/sanity.ts          sanity table using the site's own model code
PLAN.md                    source check and decisions
.github/workflows/pages.yml  build and deploy to GitHub Pages
```

## Changing assumptions

Edit `config/assumptions.json`, then run `make build`. Each entry has a `value`, a `unit`, a `classification`, and a `note` explaining it. Most can also be overridden in the UI under "Adjust estimates and assumptions". Overrides are stored in the URL as `o.<group>.<key>=<value>`.

## Adding a county

1. Add an entry to `config/counties.json` with its FIPS code and MTC county name.
2. Run `make data`.

Everything downstream loops over that list. The map's initial bounds (`site/src/map.ts`) and the example tract pairs (`site/src/presets.ts`) are San Mateo specific and will need updating.

## Data refresh notes

- **HUD SAFMR:** the fiscal year is set in `pipeline/sources.py` (`HUD_FY`). HUD's file names change between years (for example `FY27_safmrs.xlsx`), so check the SAFMR page when updating.
- **ACS:** the vintage is `ACS_YEAR` in `pipeline/sources.py`.
- **Zillow, PMMS, EIA:** the build uses the latest month or week in each file.
- **California income tax:** uses the 2025 FTB schedule, the latest published. When FTB publishes 2026, update `CA` in `pipeline/params.py` and the file names in `sources.py`. The build checks every value against the fetched PDF.
