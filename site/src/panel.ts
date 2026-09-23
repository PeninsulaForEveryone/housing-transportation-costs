// One tract's panel: heading, Sankey, notes, text-alternative table, and ACS context.

import type { Budget } from './model/household';
import type { Params, Share, SourceInfo, Tract } from './model/types';
import { CLASS_LEGEND, renderSankey } from './sankey';
import { CLASS_LABEL, el, mo, pct, usd, yr } from './format';

const FLAG_TEXT: Record<string, string> = {
  land_zip_2022: 'Land value uses the ZIP code average because FHFA has no tract estimate here (common where few homes are single-family).',
  land_county_2022: 'Land value uses the county average because FHFA has no tract or ZIP estimate here.',
  rent_zillow_unavailable: 'Zillow has no rent data covering most of this tract; Zillow rent falls back to HUD.',
  owner_cost_unavailable: 'Zillow has no home value covering this tract for some home sizes.',
  safmr_low_coverage: 'HUD rents cover less than half of this tract\'s housing units.',
};

export const METHODOLOGY = 'methodology.html';

function share(s?: Share): string {
  if (!s || s.share == null) return 'n/a';
  return `${pct(s.share)} (±${pct(s.moe ?? 0)})`;
}

/** Short place name: a neighborhood or nearby station when one is known, else the city. */
export function placeName(t: Tract): string {
  return t.label ?? t.city;
}

/** Place name plus tract number, unique across the county. */
export function tractTitle(t: Tract): string {
  return `${placeName(t)} (tract ${t.name})`;
}

export interface PanelOptions {
  letter: 'A' | 'B';
  geoid: string;
  tract: Tract;
  budget: Budget;
  params: Params;
  sources: Record<string, SourceInfo>;
  width: number;
  note?: string;            // e.g. the what-if applied to this place
  onDownload: () => void;
}

export function renderPanel(o: PanelOptions): HTMLElement {
  const { tract: t, budget: b } = o;
  const sec = el('section', { class: 'panel', 'aria-labelledby': `panel-${o.letter}-h` });
  const head = el('div', { class: 'panel-head' },
    el('span', { class: `panel-letter panel-letter-${o.letter.toLowerCase()}`, 'aria-hidden': 'true' }, o.letter),
    el('div', {},
      el('h2', { id: `panel-${o.letter}-h` }, el('span', { class: 'visually-hidden' }, `Place ${o.letter}: `), placeName(t)),
      el('div', { class: 'panel-sub' }, `Census tract ${t.name} · ${t.county} County · ZIP ${Object.keys(t.zips).slice(0, 3).join(', ')} · ${t.housing_units_2020.toLocaleString('en-US')} homes (2020)`),
    ),
  );
  sec.append(head);
  if (o.note) sec.append(el('p', { class: 'panel-note' }, o.note));

  if (!b.available) {
    sec.append(el('p', { class: 'unavailable' }, b.unavailableReason ?? 'Not available.'));
    return sec;
  }

  // Plain-language notes on the two ideas people most often question, placed right above the chart.
  const callouts: HTMLElement[] = [];
  if (b.curbInKind > 0) {
    const range = b.curbRange && b.curbRange[1] > b.curbRange[0] + 1
      ? ` Estimates range from ${mo(b.curbRange[0])} to ${mo(b.curbRange[1])}/mo; the lower is used.`
      : '';
    callouts.push(el('p', {},
      el('strong', {}, 'Street parking. '),
      `The curb space your car uses is worth about ${mo(b.curbInKind)}/mo to rent, based on land prices here.${range} `,
      'The city provides it free, so the chart shows it as non-cash value coming in and going to car storage. Your cash budget is the same either way.'));
  }
  if (b.parkingInHousing > 0) {
    callouts.push(el('p', {},
      el('strong', {}, 'Parking in the housing cost. '),
      `About ${mo(b.parkingInHousing)}/mo of your ${b.items.some((i) => i.flow === 'shelter' && i.label.startsWith('Rent')) ? 'rent' : 'home cost'} pays for parking. `,
      'It is shown under car storage instead of housing. It is moved, not added: the two together equal the full cost.'));
  }
  if (callouts.length) sec.append(el('div', { class: 'callout' }, ...callouts));

  const figure = el('figure', { class: 'sankey-figure' });
  const font = o.width < 480 ? 11 : 13;
  const height = Math.round(Math.max(420, Math.min(560, o.width * 0.85)));
  const svgEl = renderSankey(b, { width: o.width, height, font, idPrefix: `p${o.letter}`, methodologyHref: METHODOLOGY });
  svgEl.setAttribute('aria-labelledby', `panel-${o.letter}-cap`);
  figure.append(svgEl);
  figure.append(el('div', { class: 'class-legend' }, CLASS_LEGEND));
  figure.append(el('figcaption', { id: `panel-${o.letter}-cap` },
    `Where ${yr(b.inflows.reduce((s, f) => s + f.amount, 0))}/yr goes for this household in ${placeName(t)}. `,
    'Select a label to see how it is estimated. The table below has the same numbers.'));
  sec.append(figure);

  const dl = el('button', { type: 'button', class: 'button-secondary' }, `Download PNG (${o.letter})`);
  dl.addEventListener('click', o.onDownload);
  sec.append(el('div', { class: 'panel-actions' }, dl));

  const notes = [...b.notes, ...t.flags.map((f) => FLAG_TEXT[f]).filter(Boolean)];
  if (notes.length) sec.append(el('ul', { class: 'notes' }, ...notes.map((n) => el('li', {}, n))));

  // Text alternative: same numbers as the diagram.
  const table = el('table', { class: 'data-table' },
    el('caption', {}, `Annual budget, ${tractTitle(t)}`),
    el('thead', {}, el('tr', {}, ...['Flow', 'Per year', 'Per month', 'How produced', 'Sources'].map((h) => el('th', { scope: 'col' }, h)))),
  );
  const tb = el('tbody');
  const row = (dir: string, f: Budget['inflows'][number]) => {
    const srcCell = el('td', { class: 'sources-cell' });
    const seen = new Set<string>();
    for (const sid of f.sources) {
      const name = shortSource(sid);
      if (seen.has(name)) continue;
      if (seen.size) srcCell.append(', ');
      seen.add(name);
      srcCell.append(o.sources[sid] ? el('a', { href: `${METHODOLOGY}#src-${sid}` }, name) : name);
    }
    const cls = el('td', {}, f.classification === 'input' || f.classification === 'derived'
      ? CLASS_LABEL[f.classification]
      : el('a', { href: `${METHODOLOGY}#flow-${f.id}` }, CLASS_LABEL[f.classification]));
    tb.append(el('tr', {},
      el('th', { scope: 'row' }, `${dir} ${f.label}`),
      el('td', { class: 'num' }, yr(f.amount)), el('td', { class: 'num' }, mo(f.amount)), cls, srcCell));
  };
  b.inflows.forEach((f) => row('In:', f));
  b.outflows.filter((f) => f.amount > 0.5 || f.id === 'car_storage').forEach((f) => row('Out:', f));
  table.append(tb);
  sec.append(el('div', { class: 'table-wrap' }, table));

  const details = el('details', { class: 'breakdown' }, el('summary', {}, 'Line-item detail'));
  const dt = el('table', { class: 'data-table' },
    el('thead', {}, el('tr', {}, ...['Item', 'Per year', 'Note'].map((h) => el('th', { scope: 'col' }, h)))));
  const dtb = el('tbody');
  for (const it of b.items) {
    dtb.append(el('tr', {}, el('th', { scope: 'row' }, it.label), el('td', { class: 'num' }, yr(it.amount)),
      el('td', {}, [it.note, it.range && it.range[1] > it.range[0] + 1 ? `Range ${yr(it.range[0])} to ${yr(it.range[1])}.` : ''].filter(Boolean).join(' '))));
  }
  dt.append(dtb);
  details.append(el('div', { class: 'table-wrap' }, dt));
  if (b.milesSource === 'model') {
    details.append(el('p', { class: 'hint' },
      `Miles: MTC estimates ${t.vmt_per_resident_weekday.toFixed(1)} weekday miles per resident here, times household size, times ${o.params.assumptions.vmt.days_per_year.value} days. This counts home-based trips only and averages over residents who do not drive, so it likely understates driving for car owners. You can enter your own miles.`));
  }
  sec.append(details);

  // Context from the ACS (not used in the arithmetic).
  const acs = t.acs;
  const ctx = el('details', { class: 'context' }, el('summary', {}, 'Who lives here (ACS 2020-2024, with margins of error)'));
  const dl2 = el('dl');
  const item = (k: string, v: string) => dl2.append(el('dt', {}, k), el('dd', {}, v));
  if (acs.median_hh_income != null) {
    item('Median household income', acs.median_hh_income >= 250000 ? '$250,000 or more (top-coded)' :
      `${usd(acs.median_hh_income)} (±${usd(acs.median_hh_income_moe ?? 0)})`);
  }
  if (acs.vehicles) {
    item('Households with no vehicle', share(acs.vehicles['0']));
    item('With 1 / 2 / 3+ vehicles', `${share(acs.vehicles['1'])} / ${share(acs.vehicles['2'])} / ${share(acs.vehicles['3+'])}`);
  }
  if (acs.commute) {
    item('Commute: drove alone', share(acs.commute.drove_alone));
    item('Commute: transit', share(acs.commute.transit));
    item('Commute: walk or bike', share(acs.commute.walk_bike));
    item('Worked from home', share(acs.commute.work_from_home));
  }
  ctx.append(dl2, el('p', { class: 'hint' }, 'These describe current residents and are shown for context only. Margins are 90% confidence intervals.'));
  sec.append(ctx);
  return sec;
}

export function shortSource(sid: string): string {
  const m: Record<string, string> = {
    hud_safmr: 'HUD SAFMR', zillow_zori: 'Zillow ZORI', zillow_zhvi: 'Zillow ZHVI', acs: 'Census ACS', freddie_pmms: 'Freddie Mac',
    fhfa_land: 'FHFA land prices', gabbe_pierce_2017: 'Gabbe & Pierce 2017', wgi_2026: 'WGI 2026', aaa_2025: 'AAA 2025',
    eia_ca_gas: 'EIA gas prices', mtc_vmt: 'MTC VMT', caltrain_fares: 'Caltrain', samtrans_fares: 'SamTrans',
    irs_rp_2025_32: 'IRS', irs_sch8812: 'IRS Sch. 8812', irs_pub15_2026: 'IRS Pub 15', irs_amt_qa: 'IRS',
    ftb_2025_schedules: 'CA FTB', ftb_2025_booklet: 'CA FTB', edd_2026_methb: 'CA EDD', edd_sdi_2026: 'CA EDD',
  };
  return m[sid] ?? sid;
}

/** Names for A and B that tell them apart: cities if they differ, else place names, else with tract numbers. */
export function distinctNames(a: Tract, b: Tract): [string, string] {
  if (a.city !== b.city) return [a.city, b.city];
  if (placeName(a) !== placeName(b)) return [placeName(a), placeName(b)];
  return [tractTitle(a), tractTitle(b)];
}
