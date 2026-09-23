// App state <-> URL query string. Every input and both selected tracts live in the URL,
// so any view can be shared by copying the address.

import type { Bedrooms, Car, Household } from './model/types';
import { HOUSEHOLD_PRESETS, TRACT_PAIRS } from './presets';

export type Metric = 'ht_share' | 'car_cost' | 'car_storage' | 'vmt' | 'curb';

export interface AppState {
  household: Household;
  a: string;
  b: string;
  metric: Metric;
  bCars: number | null; // what-if: number of cars the household keeps in tract B (null = same as A)
}

const AGE: Record<string, Car['age']> = { n: 'new', o: 'old' };
const PARK: Record<string, Car['park']> = { b: 'bundled', u: 'unbundled', o: 'owned', s: 'street' };
const inv = (m: Record<string, string>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [v, k]));
const AGE_CODE = inv(AGE);
const PARK_CODE = inv(PARK);
const METRICS: Metric[] = ['ht_share', 'car_cost', 'car_storage', 'vmt', 'curb'];

export function defaultState(): AppState {
  const pair = TRACT_PAIRS[0];
  return { household: structuredClone(HOUSEHOLD_PRESETS[0].household), a: pair.a, b: pair.b, metric: 'ht_share', bCars: pair.bCars ?? null };
}

export function encode(s: AppState): string {
  const h = s.household;
  const q = new URLSearchParams();
  q.set('inc', String(Math.round(h.income)));
  q.set('ad', String(h.adults));
  q.set('ch', String(h.children));
  q.set('wk', String(h.workers));
  q.set('ten', h.tenure);
  q.set('rs', h.rentSource);
  q.set('br', h.bedrooms);
  q.set('cars', h.cars.map((c) => AGE_CODE[c.age] + PARK_CODE[c.park]).join('.'));
  q.set('sp', String(h.spareSpaces));
  q.set('ct', String(h.caltrainPasses));
  q.set('cz', String(h.caltrainZones));
  q.set('st', String(h.samtransPasses));
  q.set('bm', h.bundledMethod);
  if (!h.showCurbValue) q.set('cv', '0');
  if (h.vmtOverride != null) q.set('vmt', String(h.vmtOverride));
  if (h.unbundledMonthly != null) q.set('ub', String(h.unbundledMonthly));
  if (h.privateParkingMonthly != null) q.set('pp', String(h.privateParkingMonthly));
  for (const [k, v] of Object.entries(h.overrides)) q.set(`o.${k}`, String(v));
  q.set('a', s.a);
  q.set('b', s.b);
  q.set('m', s.metric);
  if (s.bCars != null && s.bCars < h.cars.length) q.set('bc', String(s.bCars));
  return q.toString();
}

function num(q: URLSearchParams, k: string, lo: number, hi: number): number | undefined {
  const v = q.get(k);
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : undefined;
}

export function decode(search: string, validTract: (g: string) => boolean): AppState {
  const s = defaultState();
  const q = new URLSearchParams(search);
  if ([...q.keys()].length === 0) return s;
  const h = s.household;
  h.income = num(q, 'inc', 0, 5_000_000) ?? h.income;
  h.adults = Math.round(num(q, 'ad', 1, 2) ?? h.adults);
  h.children = Math.round(num(q, 'ch', 0, 6) ?? h.children);
  h.workers = Math.round(num(q, 'wk', 0, h.adults) ?? Math.min(h.workers, h.adults));
  const ten = q.get('ten');
  if (ten === 'rent' || ten === 'own') h.tenure = ten;
  const rs = q.get('rs');
  if (rs === 'zillow' || rs === 'hud') h.rentSource = rs;
  const br = q.get('br');
  if (br && ['0', '1', '2', '3', '4'].includes(br)) h.bedrooms = br as Bedrooms;
  if (q.has('cars')) {
    h.cars = (q.get('cars') || '').split('.').filter(Boolean).slice(0, 4)
      .filter((c) => AGE[c[0]] && PARK[c[1]])
      .map((c) => ({ age: AGE[c[0]], park: PARK[c[1]] }));
  }
  h.spareSpaces = Math.round(num(q, 'sp', 0, 4) ?? h.spareSpaces);
  h.caltrainPasses = Math.round(num(q, 'ct', 0, 4) ?? h.caltrainPasses);
  h.caltrainZones = Math.round(num(q, 'cz', 1, 6) ?? h.caltrainZones);
  h.samtransPasses = Math.round(num(q, 'st', 0, 4) ?? h.samtransPasses);
  const bm = q.get('bm');
  if (bm === 'study' || bm === 'construction') h.bundledMethod = bm;
  h.showCurbValue = q.get('cv') !== '0';
  h.vmtOverride = num(q, 'vmt', 0, 200_000) ?? null;
  h.unbundledMonthly = num(q, 'ub', 0, 5000) ?? null;
  h.privateParkingMonthly = num(q, 'pp', 0, 5000) ?? null;
  h.overrides = {};
  for (const [k, v] of q.entries()) {
    if (k.startsWith('o.') && Number.isFinite(Number(v))) h.overrides[k.slice(2)] = Number(v);
  }
  const a = q.get('a');
  const b = q.get('b');
  if (a && validTract(a)) s.a = a;
  if (b && validTract(b)) s.b = b;
  const m = q.get('m') as Metric;
  if (METRICS.includes(m)) s.metric = m;
  const bc = num(q, 'bc', 0, 4);
  s.bCars = bc != null && Math.round(bc) < h.cars.length ? Math.round(bc) : null;
  return s;
}
