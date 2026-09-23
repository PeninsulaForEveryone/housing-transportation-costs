import './styles.css';
import { assumptionValue, compare, computeBudget, withCarCount, type Budget } from './model/household';
import type { Household, Params, SourceInfo, Tract } from './model/types';
import { renderControls } from './controls';
import { comparisonExportSvg, downloadPng, singleExportSvg } from './export';
import { el, mo, pct, yr } from './format';
import { createMap, type MapHandle } from './map';
import { distinctNames, placeName, renderPanel, tractTitle } from './panel';
import { HOUSEHOLD_PRESETS, TRACT_PAIRS } from './presets';
import { decode, encode, type AppState, type Metric } from './state';

type Geo = Parameters<typeof createMap>[2];

const METRICS: Record<Metric, { label: string; fmt: (v: number) => string }> = {
  ht_share: { label: 'Housing + transportation, share of this household\'s income', fmt: (v) => pct(v, 1) },
  car_cost: { label: 'Car costs for this household (parking paid in cash, cars, fuel), $/yr', fmt: (v) => yr(v) },
  car_storage: { label: 'Car storage for this household, including free curb space, $/yr', fmt: (v) => yr(v) },
  curb: { label: 'Value of one curb parking space, $/yr (land value method)', fmt: (v) => yr(v) },
  vmt: { label: 'Weekday miles driven per resident (regional travel model)', fmt: (v) => v.toFixed(1) },
};

async function loadJson<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`Could not load ${path} (${r.status})`);
  return r.json() as Promise<T>;
}

function presetMatch(h: Household): string | null {
  const key = (x: Household) => JSON.stringify(x);
  return HOUSEHOLD_PRESETS.find((p) => key(p.household) === key(h))?.id ?? null;
}

const plural = (n: number) => (n === 0 ? 'no car' : `${n} car${n > 1 ? 's' : ''}`);

async function main() {
  const [params, tracts, geo, sources] = await Promise.all([
    loadJson<Params>('data/params.json'),
    loadJson<Record<string, Tract>>('data/tracts.json'),
    loadJson<Geo>('data/tracts.geojson'),
    loadJson<Record<string, SourceInfo>>('data/sources.json'),
  ]);
  const state: AppState = decode(location.search, (g) => g in tracts);

  const $ = (id: string) => document.getElementById(id)!;
  const controlsRoot = $('controls');
  const panelsRoot = $('panels');
  const summaryRoot = $('summary');
  const metricSel = $('metric') as HTMLSelectElement;
  const pairSel = $('pair') as HTMLSelectElement;
  const selectionRoot = $('selection');
  const searchInput = $('place-search') as HTMLInputElement;
  const searchResults = $('search-results');
  let map: MapHandle | null = null;

  for (const [k, m] of Object.entries(METRICS)) metricSel.append(el('option', { value: k }, m.label));
  metricSel.addEventListener('change', () => { state.metric = metricSel.value as Metric; update(); });

  pairSel.append(el('option', { value: '' }, 'Pick an example pair'));
  for (const p of TRACT_PAIRS) pairSel.append(el('option', { value: p.id }, p.label));
  pairSel.addEventListener('change', () => {
    const p = TRACT_PAIRS.find((x) => x.id === pairSel.value);
    if (p) { state.a = p.a; state.b = p.b; update(); }
  });

  function setTract(letter: 'a' | 'b', g: string) {
    if (!(g in tracts)) return;
    const other = letter === 'a' ? 'b' : 'a';
    // Choosing the other slot's tract swaps the two rather than comparing a place with itself.
    if (state[other] === g) state[other] = state[letter];
    state[letter] = g;
    update();
  }

  /** The household as it lives in B: the same, unless the what-if drops cars. */
  const householdB = (h: Household) => (state.bCars == null ? h : withCarCount(h, state.bCars, params));
  const budgets = (): [Budget, Budget] => [
    computeBudget(tracts[state.a], params, state.household),
    computeBudget(tracts[state.b], params, householdB(state.household)),
  ];

  function renderSelection() {
    selectionRoot.replaceChildren();
    for (const k of ['a', 'b'] as const) {
      selectionRoot.append(el('span', { class: 'selection-item' },
        el('span', { class: `panel-letter panel-letter-${k}`, 'aria-hidden': 'true' }, k.toUpperCase()),
        el('span', { class: 'visually-hidden' }, `Place ${k.toUpperCase()}: `), tractTitle(tracts[state[k]])));
    }
    const swap = el('button', { type: 'button', class: 'link-button' }, 'Swap A and B');
    swap.addEventListener('click', () => { [state.a, state.b] = [state.b, state.a]; update(); });
    selectionRoot.append(swap);
  }

  // Place search over local data: city, neighborhood, station, ZIP, or tract number. No external service.
  const index = Object.entries(tracts).map(([g, t]) => ({
    g, t, text: [t.label, t.city, ...t.neighborhoods, ...t.stations, ...Object.keys(t.zips), `tract ${t.name}`]
      .filter(Boolean).join(' ').toLowerCase(),
  }));
  function renderSearch() {
    searchResults.replaceChildren();
    const q = searchInput.value.trim().toLowerCase();
    if (q.length < 2) return;
    const words = q.split(/\s+/);
    // Tracts in a matching city first, then matching neighborhoods or stations, then ZIP or tract number matches.
    const rank = (t: Tract) => (t.city.toLowerCase().startsWith(q) ? 0 : (t.label ?? '').toLowerCase().includes(q) ? 1 : 2);
    const hits = index.filter((x) => words.every((w) => x.text.includes(w)))
      .sort((x, y) => rank(x.t) - rank(y.t) || placeName(x.t).localeCompare(placeName(y.t)) || x.t.name.localeCompare(y.t.name));
    if (!hits.length) {
      searchResults.append(el('li', { class: 'hint' }, 'No match. Try a city, neighborhood, station, or ZIP code.'));
      return;
    }
    for (const x of hits.slice(0, 8)) {
      const li = el('li', {}, el('span', {}, tractTitle(x.t)));
      for (const letter of ['a', 'b'] as const) {
        const btn = el('button', { type: 'button', class: 'button-secondary', 'aria-label': `Set ${tractTitle(x.t)} as ${letter.toUpperCase()}` },
          `Set as ${letter.toUpperCase()}`);
        btn.addEventListener('click', () => {
          searchInput.value = '';
          searchResults.replaceChildren();
          map?.focus(x.g);
          setTract(letter, x.g);
        });
        li.append(btn);
      }
      searchResults.append(li);
    }
    if (hits.length > 8) searchResults.append(el('li', { class: 'hint' }, `${hits.length - 8} more; add a word to narrow it down.`));
  }
  searchInput.addEventListener('input', renderSearch);

  function metricValues(h: Household): Record<string, number | null> {
    const out: Record<string, number | null> = {};
    const curbSqft = assumptionValue(params.assumptions, h.overrides, 'parking.curb_stall_sqft');
    const yieldRate = assumptionValue(params.assumptions, h.overrides, 'parking.land_yield');
    for (const [g, t] of Object.entries(tracts) as [string, Tract][]) {
      if (state.metric === 'vmt') { out[g] = t.vmt_per_resident_weekday; continue; }
      if (state.metric === 'curb') { out[g] = t.land_per_sqft * curbSqft * yieldRate; continue; }
      const b = computeBudget(t, params, h);
      if (!b.available) { out[g] = null; continue; }
      out[g] = state.metric === 'ht_share' ? (h.income > 0 ? b.cashCost / h.income : null)
        : state.metric === 'car_cost' ? b.carCashCost
        : b.outflows.find((f) => f.id === 'car_storage')!.amount;
    }
    return out;
  }
  let lastValues: Record<string, number | null> = {};

  function renderSummary(a: Budget, b: Budget) {
    summaryRoot.replaceChildren();
    const ta = tracts[state.a], tb = tracts[state.b];
    const [na, nb] = distinctNames(ta, tb);
    const h = state.household;

    // What-if: fewer cars in B.
    let whatIf = '';
    if (h.cars.length > 0) {
      const opts: [string, string][] = [['', `Same as A (${plural(h.cars.length)})`]];
      for (let n = h.cars.length - 1; n >= 0; n--) opts.push([String(n), plural(n)]);
      const sel = el('select', { id: 'what-if' });
      for (const [v, l] of opts) {
        const o = el('option', { value: v }, l);
        if ((state.bCars == null ? '' : String(state.bCars)) === v) o.selected = true;
        sel.append(o);
      }
      sel.addEventListener('change', () => { state.bCars = sel.value === '' ? null : Number(sel.value); update(); });
      summaryRoot.append(el('div', { class: 'what-if' },
        el('label', { for: 'what-if' }, `What if, living in ${nb}, this household kept`), sel));
      if (state.bCars != null) {
        const dropped = h.cars.slice(state.bCars);
        whatIf = `What-if: in B the household keeps ${plural(state.bCars)} instead of ${plural(h.cars.length)}.`;
        summaryRoot.append(el('p', { class: 'hint' },
          `${whatIf} The last ${dropped.length > 1 ? `${dropped.length} cars in the list are` : 'car in the list is'} dropped along with ${dropped.length > 1 ? 'their' : 'its'} parking, and miles shrink in proportion. Any new transit fares are not added; set transit passes above if needed.`));
      }
    }

    if (!a.available || !b.available) {
      summaryRoot.append(el('p', {}, 'A comparison needs both places to have data for this household.'));
      return;
    }
    const c = compare(a, b);
    const dir = (x: number) => (x >= 0 ? 'more' : 'less');
    const headline = Math.abs(c.diff) < 50
      ? `Living in ${nb} (B) costs this household about the same as ${na} (A).`
      : `Living in ${nb} (B) instead of ${na} (A) costs this household ${yr(Math.abs(c.diff))}/yr ${dir(c.diff)} (${mo(Math.abs(c.diff))}/mo).`;
    summaryRoot.prepend(el('p', { class: 'summary-headline' }, headline));

    // Where the difference comes from, by category. Signs are spelled out, never shown by color alone.
    const signed = (x: number) => (Math.abs(x) < 50 ? 'same' : `${x > 0 ? '+' : '−'}${yr(Math.abs(x))}`);
    const table = el('table', { class: 'data-table diff-table' },
      el('caption', { class: 'visually-hidden' }, 'Yearly cash costs by category in each place'),
      el('thead', {}, el('tr', {},
        el('th', { scope: 'col' }, 'Per year'),
        el('th', { scope: 'col', class: 'num' }, `A: ${na}`),
        el('th', { scope: 'col', class: 'num' }, `B: ${nb}`),
        el('th', { scope: 'col', class: 'num' }, 'Difference'))));
    const body = el('tbody');
    for (const x of c.categories) {
      if (x.a < 0.5 && x.b < 0.5) continue;
      body.append(el('tr', {}, el('th', { scope: 'row' }, x.label),
        el('td', { class: 'num' }, yr(x.a)), el('td', { class: 'num' }, yr(x.b)), el('td', { class: 'num' }, signed(x.diff))));
    }
    body.append(el('tr', { class: 'total' }, el('th', { scope: 'row' }, 'Total housing and transportation'),
      el('td', { class: 'num' }, yr(a.cashCost)), el('td', { class: 'num' }, yr(b.cashCost)),
      el('td', { class: 'num' }, signed(c.diff))));
    table.append(body);
    summaryRoot.append(el('div', { class: 'table-wrap' }, table));

    const notes = ['Taxes are the same in both places because the household is the same.'];
    if (Math.abs(c.inKindDiff) >= 50) {
      notes.push(`Not counted above: the free curb space this household uses is worth ${yr(Math.abs(c.inKindDiff))}/yr ${dir(c.inKindDiff)} in B. That value is real, but it is not paid in cash.`);
    }
    summaryRoot.append(el('p', { class: 'hint' }, notes.join(' ')));
    const dl = el('button', { type: 'button', class: 'button-primary' }, 'Download comparison PNG');
    dl.addEventListener('click', () => downloadPng(
      comparisonExportSvg({ tract: ta, geoid: state.a, budget: a, letter: 'A' }, { tract: tb, geoid: state.b, budget: b, letter: 'B' },
        c, h, siteUrl(), whatIf || undefined),
      `location-cost-${ta.name}-vs-${tb.name}.png`));
    summaryRoot.append(dl);
  }

  const siteUrl = () => location.origin + location.pathname.replace(/index\.html$/, '');

  function renderPanels(a: Budget, b: Budget) {
    panelsRoot.replaceChildren();
    // Match the CSS grid: one column on narrow screens, two side by side on wide ones.
    const w = panelsRoot.clientWidth;
    const cols = getComputedStyle(panelsRoot).gridTemplateColumns.split(' ').filter(Boolean).length || 1;
    const width = Math.max(300, Math.floor((w - 32 * (cols - 1)) / cols));
    for (const [k, budget] of [['a', a], ['b', b]] as const) {
      const g = state[k];
      const letter = k.toUpperCase() as 'A' | 'B';
      const hh = k === 'b' ? householdB(state.household) : state.household;
      panelsRoot.append(renderPanel({
        letter, geoid: g, tract: tracts[g], budget, params, sources, width,
        note: k === 'b' && state.bCars != null ? `What-if: this household keeps ${plural(state.bCars)} here instead of ${plural(state.household.cars.length)}.` : undefined,
        onDownload: () => downloadPng(singleExportSvg({ tract: tracts[g], geoid: g, budget, letter }, hh, siteUrl()),
          `location-cost-${tracts[g].name}.png`),
      }));
    }
  }

  function update() {
    const h = state.household;
    if (state.bCars != null && state.bCars >= h.cars.length) state.bCars = null;
    const [a, b] = budgets();
    // Typical miles for each place, shown as guidance next to the miles question.
    const modelMiles = (g: string) => computeBudget(tracts[g], params, { ...h, vmtOverride: null }).annualMiles;
    renderControls(controlsRoot, h, params, update, presetMatch(h), {
      a: modelMiles(state.a), b: modelMiles(state.b), aName: placeName(tracts[state.a]), bName: placeName(tracts[state.b]),
    });
    renderSummary(a, b);
    renderPanels(a, b);
    renderSelection();
    const pair = TRACT_PAIRS.find((p) => p.a === state.a && p.b === state.b);
    pairSel.value = pair?.id ?? '';
    metricSel.value = state.metric;
    if (map) {
      lastValues = metricValues(h);
      map.setSelection(state.a, state.b);
      map.setValues(lastValues, METRICS[state.metric].fmt, METRICS[state.metric].label);
    }
    history.replaceState(null, '', `?${encode(state)}`);
  }

  try {
    map = createMap($('map'), $('legend'), geo, {
      describe: (g) => {
        const t = tracts[g];
        if (!t) return null;
        const v = lastValues[g];
        return { title: tractTitle(t), detail: `${METRICS[state.metric].label}: ${v == null ? 'not available' : METRICS[state.metric].fmt(v)}` };
      },
      onSet: setTract,
    });
  } catch (e) {
    $('map').append(el('p', { class: 'unavailable' }, 'The map could not load. Use place search or the example pairs above.'));
    console.error(e);
  }

  let lastWidth = panelsRoot.clientWidth;
  new ResizeObserver(() => {
    if (Math.abs(panelsRoot.clientWidth - lastWidth) > 40) {
      lastWidth = panelsRoot.clientWidth;
      renderPanels(...budgets());
    }
  }).observe(panelsRoot);

  $('built').textContent = `Data built ${params.meta.built}. Rents: Zillow ${params.meta.housing.zori_month.slice(0, 7)}, HUD FY${params.meta.housing.safmr_fy}. Mortgage rate ${(params.pmms.rate_30yr * 100).toFixed(2)}% (week of ${params.pmms.week_of}).`;
  update();
}

main().catch((e) => {
  document.getElementById('app-error')!.textContent = `Something went wrong loading the data: ${e.message}`;
  console.error(e);
});
