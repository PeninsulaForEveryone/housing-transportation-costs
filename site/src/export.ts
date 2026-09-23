// PNG export at 1080x1350 (4:5 portrait, the common social feed size).
// Builds a standalone SVG with literal colors, rasterizes it on a canvas, and downloads it.

import type { Budget, Comparison } from './model/household';
import type { Household, Tract } from './model/types';
import { EXPORT_COLORS, renderSankey } from './sankey';
import { yr } from './format';
import { distinctNames } from './panel';

const W = 1080;
const H = 1350;
const NS = 'http://www.w3.org/2000/svg';
const INK = EXPORT_COLORS['--ink-1'];
const INK2 = EXPORT_COLORS['--ink-2'];
const INK3 = EXPORT_COLORS['--ink-3'];

export interface ExportItem { tract: Tract; geoid: string; budget: Budget; letter: 'A' | 'B' }

function text(x: number, y: number, s: string, size: number, fill: string, weight = 400, anchor = 'start') {
  const t = document.createElementNS(NS, 'text');
  t.setAttribute('x', String(x));
  t.setAttribute('y', String(y));
  t.setAttribute('font-size', String(size));
  t.setAttribute('font-weight', String(weight));
  t.setAttribute('fill', fill);
  t.setAttribute('text-anchor', anchor);
  t.textContent = s;
  return t;
}

/** Greedy word wrap using an average glyph width estimate. */
function wrap(s: string, size: number, width: number): string[] {
  const maxChars = Math.floor(width / (size * 0.52));
  const lines: string[] = [];
  let cur = '';
  for (const w of s.split(' ')) {
    if ((cur + ' ' + w).trim().length > maxChars) {
      lines.push(cur.trim());
      cur = w;
    } else cur += ' ' + w;
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines;
}

export function householdSummary(h: Household): string {
  const people = `${h.adults} adult${h.adults > 1 ? 's' : ''}${h.children ? `, ${h.children} child${h.children > 1 ? 'ren' : ''}` : ''}`;
  const home = `${h.tenure === 'rent' ? 'renting' : 'owning'} ${h.bedrooms === '0' ? 'a studio' : `${h.bedrooms} bedrooms`}`;
  const cars = h.cars.length === 0 ? 'no car' : `${h.cars.length} car${h.cars.length > 1 ? 's' : ''}`;
  return `${yr(h.income)}/yr income, ${people}, ${home}, ${cars}`;
}

export const tractName = (t: Tract) => `${t.label ?? t.city} (census tract ${t.name})`;

function frame(title: string, subtitle: string[], siteUrl: string): { root: SVGSVGElement; top: number; bottom: number } {
  const root = document.createElementNS(NS, 'svg');
  root.setAttribute('xmlns', NS);
  root.setAttribute('width', String(W));
  root.setAttribute('height', String(H));
  root.setAttribute('viewBox', `0 0 ${W} ${H}`);
  root.style.fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
  const bg = document.createElementNS(NS, 'rect');
  bg.setAttribute('width', String(W));
  bg.setAttribute('height', String(H));
  bg.setAttribute('fill', EXPORT_COLORS['--surface']);
  root.append(bg);
  const bar = document.createElementNS(NS, 'rect');
  bar.setAttribute('width', String(W));
  bar.setAttribute('height', '14');
  bar.setAttribute('fill', EXPORT_COLORS['--brand-dark']);
  root.append(bar);
  let y = 84;
  for (const line of wrap(title, 40, W - 120)) {
    root.append(text(60, y, line, 40, INK, 700));
    y += 48;
  }
  for (const s of subtitle) {
    for (const line of wrap(s, 24, W - 120)) {
      root.append(text(60, y, line, 24, INK2));
      y += 32;
    }
  }
  const foot = [
    ...wrap('Striped or dashed flow: non-cash value of free curb parking. Sources: Zillow, HUD, FHFA land prices, MTC travel model, AAA, Census, IRS, CA FTB and EDD.', 18, W - 120),
    `Full method and data: ${siteUrl}`,
  ];
  let fy = H - 40 - (foot.length - 1) * 26;
  for (const line of foot) {
    root.append(text(60, fy, line, 18, INK3));
    fy += 26;
  }
  return { root, top: y + 10, bottom: H - 40 - foot.length * 26 - 10 };
}

function placeSankey(root: SVGSVGElement, b: Budget, x: number, y: number, w: number, h: number, font: number, id: string) {
  const s = renderSankey(b, { width: w, height: h, font, idPrefix: id, literalColors: true });
  s.setAttribute('x', String(x));
  s.setAttribute('y', String(y));
  root.append(s);
}

export function singleExportSvg(item: ExportItem, h: Household, siteUrl: string): SVGSVGElement {
  const { root, top, bottom } = frame(
    `What this household spends in ${item.tract.city}`,
    [householdSummary(h), tractName(item.tract)],
    siteUrl,
  );
  placeSankey(root, item.budget, 40, top, W - 80, bottom - top, 22, `x${item.letter}`);
  return root;
}

export function comparisonExportSvg(a: ExportItem, b: ExportItem, c: Comparison, h: Household, siteUrl: string, whatIf?: string): SVGSVGElement {
  const more = c.diff >= 0;
  const [na, nb] = distinctNames(a.tract, b.tract);
  const headline = `Same household, two places: ${nb} costs ${yr(Math.abs(c.diff))}/yr ${more ? 'more' : 'less'} than ${na}`;
  const { root, top, bottom } = frame(headline, [householdSummary(h), ...(whatIf ? [whatIf] : [])], siteUrl);
  const half = (bottom - top) / 2;
  [a, b].forEach((it, i) => {
    const y = top + i * half;
    const note = it.letter === 'B' && whatIf ? ' (what-if)' : '';
    root.append(text(60, y + 26, `${it.letter}: ${tractName(it.tract)}${note}`, 22, INK, 600));
    placeSankey(root, it.budget, 40, y + 34, W - 80, half - 44, 17, `c${it.letter}`);
  });
  return root;
}

export async function downloadPng(svgEl: SVGSVGElement, filename: string): Promise<void> {
  const xml = new XMLSerializer().serializeToString(svgEl);
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    img.width = W;
    img.height = H;
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('Could not render the image'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    canvas.getContext('2d')!.drawImage(img, 0, 0, W, H);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
    if (!blob) throw new Error('Could not encode PNG');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } finally {
    URL.revokeObjectURL(url);
  }
}
