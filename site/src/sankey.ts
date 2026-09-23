// Sankey diagram for one budget, drawn with d3-sankey into a plain SVG element.
// The same function renders the on-screen chart and the PNG export.

import { sankey, type SankeyLink, type SankeyNode } from 'd3-sankey';
import type { Budget, Flow, FlowId } from './model/household';
import { CLASS_LABEL, mo, yr } from './format';

const NS = 'http://www.w3.org/2000/svg';

export const FLOW_COLOR: Record<FlowId | 'budget', string> = {
  income: 'var(--flow-income)',
  curb_inkind: 'var(--flow-car)',
  shortfall: 'var(--flow-shortfall)',
  budget: 'var(--flow-budget)',
  taxes: 'var(--flow-taxes)',
  shelter: 'var(--flow-housing)',
  car_storage: 'var(--flow-car)',
  vehicle: 'var(--flow-car)',
  fuel: 'var(--flow-car)',
  transit: 'var(--flow-transit)',
  remainder: 'var(--flow-remainder)',
};

/** Literal colors for the export, where CSS variables from the page are not available. */
export const EXPORT_COLORS: Record<string, string> = {
  '--flow-income': '#4a6358', '--flow-budget': '#4a6358', '--flow-taxes': '#9ab8ae',
  '--flow-housing': '#2a78d6', '--flow-car': '#eb6834', '--flow-transit': '#4a3aa7',
  '--flow-remainder': '#cbe0d7', '--flow-shortfall': '#c0392b',
  '--ink-1': '#111b17', '--ink-2': '#4a6358', '--ink-3': '#7d9a8f', '--surface': '#ffffff',
  '--brand': '#1d6b50', '--brand-dark': '#144d3a',
};

/** Web font on screen; the PNG export falls back to system fonts because an SVG image cannot load web fonts. */
const SCREEN_FONT = "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const EXPORT_FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

/** Symbols for how each figure was produced. Shape, not color, carries the meaning. */
export const CLASS_MARK: Record<string, string> = { observed: '●', modeled: '◐', assumption: '○' };
const CLASS_HELP: Record<string, string> = {
  observed: 'Observed: a published figure used as published.',
  modeled: 'Modeled: calculated from published data with a stated method.',
  assumption: 'Assumption: a constant we chose; you can change it.',
  derived: 'Derived: arithmetic on the other flows.',
  input: 'Your input.',
};
export const CLASS_LEGEND = '● Observed   ◐ Modeled   ○ Assumption. Hover or select a label for details.';

interface N { id: string; flow?: Flow; label: string; column: number }
interface L { source: string; target: string; value: number; flow: Flow }

export interface SankeyOptions {
  width: number;
  height: number;
  font: number;             // base font size in px
  idPrefix: string;         // keeps pattern ids unique when several charts share a page
  methodologyHref?: string; // badge links; omitted in exports
  literalColors?: boolean;  // resolve CSS variables to hex (for export)
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/** A link as a filled band (avoids the distortion of very wide strokes on curves). */
function ribbon(l: SankeyLink<N, L>): string {
  const s = l.source as SankeyNode<N, L>, t = l.target as SankeyNode<N, L>;
  const w = Math.max(1, l.width ?? 1);
  const x0 = s.x1!, x1 = t.x0!, xm = (x0 + x1) / 2;
  const a0 = l.y0! - w / 2, a1 = l.y1! - w / 2, b0 = l.y0! + w / 2, b1 = l.y1! + w / 2;
  return `M${x0},${a0}C${xm},${a0} ${xm},${a1} ${x1},${a1}L${x1},${b1}C${xm},${b1} ${xm},${b0} ${x0},${b0}Z`;
}

function wrapWords(s: string, maxChars: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const w of s.split(' ')) {
    if (cur && (cur + ' ' + w).length > maxChars) { out.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) out.push(cur);
  return out;
}

export function renderSankey(b: Budget, o: SankeyOptions): SVGSVGElement {
  const color = (c: string) => (o.literalColors ? c.replace(/var\((--[\w-]+)\)/, (_, v) => EXPORT_COLORS[v]) : c);
  const root = svg('svg', { viewBox: `0 0 ${o.width} ${o.height}`, width: o.width, height: o.height, role: 'img', class: 'sankey' });
  root.style.fontFamily = o.literalColors ? EXPORT_FONT : SCREEN_FONT;

  // Hatched fill marks the non-cash inflow.
  const defs = svg('defs');
  const pid = `${o.idPrefix}-hatch`;
  const pat = svg('pattern', { id: pid, width: 8, height: 8, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
  pat.append(svg('rect', { width: 8, height: 8, fill: color('var(--surface)') }));
  pat.append(svg('rect', { width: 3.5, height: 8, fill: color('var(--flow-car)') }));
  defs.append(pat);
  root.append(defs);

  const inflows = b.inflows.filter((f) => f.amount > 0.5);
  const outflows = b.outflows.filter((f) => f.amount > 0.5);
  const nodes: N[] = [
    ...inflows.map((f) => ({ id: f.id, flow: f, label: f.label, column: 0 })),
    ...outflows.map((f) => ({ id: f.id, flow: f, label: f.label, column: 1 })),
  ];
  // Income pays the outflows in order; free curb space pays only for car storage;
  // a shortfall (if any) covers whatever income cannot.
  const links: L[] = [];
  const inkind = inflows.find((f) => f.id === 'curb_inkind');
  const income = inflows.find((f) => f.id === 'income');
  const shortfall = inflows.find((f) => f.id === 'shortfall');
  let incomeLeft = income?.amount ?? 0;
  for (const out of outflows) {
    let need = out.amount;
    if (out.id === 'car_storage' && inkind) need -= inkind.amount;
    const fromIncome = Math.min(need, incomeLeft);
    if (income && fromIncome > 0.5) links.push({ source: 'income', target: out.id, value: fromIncome, flow: out });
    incomeLeft -= fromIncome;
    if (shortfall && need - fromIncome > 0.5) links.push({ source: 'shortfall', target: out.id, value: need - fromIncome, flow: shortfall });
    if (out.id === 'car_storage' && inkind) links.push({ source: 'curb_inkind', target: out.id, value: inkind.amount, flow: inkind });
  }

  const f = o.font;
  const labelW = f * 15.5;
  const leftW = f * 12;
  const pad = f * 3.1;
  const layout = sankey<N, L>()
    .nodeId((d) => d.id)
    .nodeAlign((d) => (d as unknown as N).column)
    .nodeWidth(Math.max(10, f))
    .nodePadding(pad)
    .nodeSort(null)
    .linkSort(null)
    .extent([[leftW, f], [o.width - labelW, o.height - f]]);
  const graph = layout({ nodes: nodes.map((d) => ({ ...d })), links: links.map((d) => ({ ...d })) });

  const linkG = svg('g');
  for (const l of graph.links as SankeyLink<N, L>[]) {
    const fl = l.flow;
    const w = Math.max(1, l.width ?? 1);
    const thin = w < 6;
    const path = svg('path', { d: ribbon(l), class: 'sankey-link' });
    if (fl.inKind) {
      // Non-cash: striped when wide enough to see stripes, dashed outline when thin.
      path.setAttribute('fill', thin ? 'none' : `url(#${pid})`);
      path.setAttribute('stroke', color('var(--flow-car)'));
      path.setAttribute('stroke-width', '1.5');
      path.setAttribute('stroke-dasharray', '4 3');
    } else {
      const toKey = (l.target as SankeyNode<N, L>).flow?.id as FlowId;
      path.setAttribute('fill', color(FLOW_COLOR[fl.id === 'shortfall' ? 'shortfall' : toKey]));
      path.setAttribute('fill-opacity', '0.35');
    }
    const t = svg('title');
    t.textContent = `${fl.label}: ${yr(fl.amount)}/yr (${mo(fl.amount)}/mo)`;
    path.append(t);
    linkG.append(path);
  }
  root.append(linkG);

  const nodeG = svg('g');
  for (const n of graph.nodes as SankeyNode<N, L>[]) {
    const x0 = n.x0!, x1 = n.x1!, y0 = n.y0!, y1 = n.y1!;
    const fl = n.flow;
    const key = (fl?.id ?? 'budget') as FlowId | 'budget';
    const rect = svg('rect', {
      x: x0, y: y0, width: x1 - x0, height: Math.max(1, y1 - y0), rx: 2,
      fill: fl?.inKind ? `url(#${pid})` : color(FLOW_COLOR[key]),
    });
    if (fl?.inKind) {
      rect.setAttribute('stroke', color('var(--flow-car)'));
      rect.setAttribute('stroke-width', '1.5');
    }
    nodeG.append(rect);
    if (!fl) continue;

    const left = n.column === 0;
    const tx = left ? x0 - f * 0.6 : x1 + f * 0.6;
    const anchor = left ? 'end' : 'start';
    const reserve = CLASS_MARK[fl.classification] ? 2 : 0; // room for the classification symbol
    const names = wrapWords(fl.label, Math.floor((left ? leftW : labelW) / (f * 0.6)) - reserve);
    const lineH = f * 1.2;
    const blockH = names.length * lineH + f * 1.1;
    let y = (y0 + y1) / 2 - blockH / 2 + f * 0.9;
    const g = svg('g', { class: 'sankey-label' });
    const help = svg('title');
    help.textContent = `${fl.label}: ${yr(fl.amount)}/yr. ${CLASS_HELP[fl.classification] ?? ''}`;
    g.append(help);
    names.forEach((line, i) => {
      const t = svg('text', { x: tx, y, 'text-anchor': anchor, 'font-size': f, 'font-weight': 600, fill: color('var(--ink-1)') });
      t.textContent = line;
      // The classification symbol follows the name on its last line.
      if (i === names.length - 1 && CLASS_MARK[fl.classification]) {
        const badge = svg('tspan', { dx: f * 0.35, 'font-size': f * 0.85, 'font-weight': 400, fill: color('var(--ink-2)'), class: 'badge' });
        badge.textContent = CLASS_MARK[fl.classification];
        t.append(badge);
      }
      g.append(t);
      y += lineH;
    });
    const val = svg('text', { x: tx, y: y - lineH + f * 1.15, 'text-anchor': anchor, 'font-size': f * 0.9, fill: color('var(--ink-2)') });
    val.textContent = `${yr(fl.amount)}/yr · ${mo(fl.amount)}/mo`;
    g.append(val);
    if (o.methodologyHref && fl.classification !== 'input' && fl.classification !== 'derived') {
      const a = svg('a', { href: `${o.methodologyHref}#flow-${fl.id}`, 'aria-label': `${fl.label}: how this is estimated (${CLASS_LABEL[fl.classification]})` });
      a.append(g);
      nodeG.append(a);
    } else {
      nodeG.append(g);
    }
  }
  root.append(nodeG);

  // Bracket grouping the car-related outflows.
  const carNodes = (graph.nodes as SankeyNode<N, L>[]).filter((n) => n.column === 1 && n.flow?.carRelated);
  if (carNodes.length > 1) {
    const y0 = Math.min(...carNodes.map((n) => n.y0!));
    const y1 = Math.max(...carNodes.map((n) => n.y1!));
    const x = carNodes[0].x0! - f * 0.5;
    root.append(svg('path', {
      d: `M${x + 4},${y0} H${x} V${y1} H${x + 4}`, fill: 'none', stroke: color('var(--flow-car)'), 'stroke-width': 1.5,
    }));
  }

  const incomeAmt = inflows.find((x) => x.id === 'income')?.amount ?? 0;
  const extra = inflows.filter((x) => x.id !== 'income').map((x) => `${x.label} ${yr(x.amount)}`);
  const title = svg('title');
  title.textContent = `Budget diagram: ${yr(incomeAmt)}/yr income${extra.length ? ` (plus ${extra.join(', ')})` : ''}, split into ${outflows.map((x) => `${x.label} ${yr(x.amount)}`).join(', ')}.`;
  root.prepend(title);
  return root;
}
