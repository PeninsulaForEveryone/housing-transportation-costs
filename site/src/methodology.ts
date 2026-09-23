// Fills the methodology page's numbers and tables from the same data files the tool uses.
import './styles.css';
import type { Params, SourceInfo, Tract } from './model/types';
import { assumptionValue, constructionAnnual } from './model/household';
import { HOUSEHOLD_PRESETS } from './presets';
import { CLASS_LABEL, el, usd, yr } from './format';

function get(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], obj);
}

function fmt(v: unknown, f: string | undefined): string {
  if (typeof v === 'boolean') return v ? 'on by default' : 'off by default';
  if (typeof v !== 'number') return String(v ?? '');
  switch (f) {
    case 'usd': return usd(v);
    case 'usd2': return `$${v.toFixed(2)}`;
    case 'pct0': return `${Math.round(v * 100)}%`;
    case 'pct1': return `${+(v * 100).toFixed(1)}%`;
    case 'pct2': return `${(v * 100).toFixed(2)}%`;
    case 'cents': return `${+(v * 100).toFixed(2)}¢`;
    default: return String(v);
  }
}

async function main() {
  const [params, sources, tracts] = await Promise.all([
    fetch('data/params.json').then((r) => r.json() as Promise<Params>),
    fetch('data/sources.json').then((r) => r.json() as Promise<Record<string, SourceInfo>>),
    fetch('data/tracts.json').then((r) => r.json() as Promise<Record<string, Tract>>),
  ]);

  document.querySelectorAll<HTMLElement>('[data-param]').forEach((e) => {
    e.textContent = fmt(get(params, e.dataset.param!), e.dataset.fmt);
  });
  document.querySelectorAll<HTMLElement>('[data-assume]').forEach((e) => {
    const [g, k] = e.dataset.assume!.split('.');
    const raw = params.assumptions[g]?.[k]?.value;
    e.textContent = typeof raw === 'boolean' ? fmt(raw, undefined) : fmt(assumptionValue(params.assumptions, {}, e.dataset.assume!), e.dataset.fmt);
  });
  document.querySelectorAll<HTMLElement>('[data-computed="construction"]').forEach((e) => {
    e.textContent = yr(constructionAnnual(params, HOUSEHOLD_PRESETS[0].household));
  });
  document.querySelectorAll<HTMLElement>('[data-count="tracts"]').forEach((e) => { e.textContent = String(Object.keys(tracts).length); });
  document.querySelectorAll<HTMLElement>('[data-count="vintage"]').forEach((e) => { e.textContent = sources.census_cb_tracts.vintage; });

  const sb = document.querySelector('#sources-table tbody')!;
  for (const [id, s] of Object.entries(sources)) {
    sb.append(el('tr', { id: `src-${id}` },
      el('th', { scope: 'row' }, el('a', { href: s.landing ?? s.url }, s.title)),
      el('td', {}, s.vintage), el('td', {}, s.retrieved), el('td', {}, CLASS_LABEL[s.classification]), el('td', {}, s.notes)));
  }

  const ab = document.querySelector('#assumptions-table tbody')!;
  for (const [group, items] of Object.entries(params.assumptions)) {
    if (group.startsWith('_')) continue;
    for (const [k, a] of Object.entries(items)) {
      const v = typeof a.value === 'boolean' ? (a.value ? 'yes' : 'no') : `${a.value.toLocaleString('en-US')} ${a.unit}`;
      const why = el('td', {}, a.note);
      if (a.source && sources[a.source]) why.append(' ', el('a', { href: `#src-${a.source}` }, 'Source'));
      ab.append(el('tr', {}, el('th', { scope: 'row' }, el('code', {}, `${group}.${k}`)), el('td', {}, v), el('td', {}, CLASS_LABEL[a.classification]), why));
    }
  }
  document.getElementById('built')!.textContent = `Data built ${params.meta.built}.`;
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
}

main().catch((e) => {
  document.getElementById('app-error')!.textContent = `Could not load the data: ${e.message}`;
});
