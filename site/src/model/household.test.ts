import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HOUSEHOLD_PRESETS, SANITY_TRACTS } from '../presets';
import { compare, computeBudget, mortgagePayment, withCarCount } from './household';
import type { Household, Params, Tract } from './types';

const dataDir = new URL('../../public/data/', import.meta.url);
const params: Params = JSON.parse(readFileSync(new URL('params.json', dataDir), 'utf8'));
const tracts: Record<string, Tract> = JSON.parse(readFileSync(new URL('tracts.json', dataDir), 'utf8'));
const preset = (id: string) => structuredClone(HOUSEHOLD_PRESETS.find((p) => p.id === id)!.household);
const T = tracts[SANITY_TRACTS[0][0]];

const sum = (xs: { amount: number }[]) => xs.reduce((s, x) => s + x.amount, 0);
const flow = (b: ReturnType<typeof computeBudget>, id: string) => b.outflows.find((f) => f.id === id)!.amount;

describe('household budget', () => {
  it('balances inflows and outflows for every preset and sanity tract', () => {
    for (const p of HOUSEHOLD_PRESETS) {
      for (const [g] of SANITY_TRACTS) {
        const b = computeBudget(tracts[g], params, p.household);
        if (!b.available) continue;
        expect(sum(b.inflows)).toBeCloseTo(sum(b.outflows), 6);
        for (const f of [...b.inflows, ...b.outflows]) expect(f.amount).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('shows nonzero car storage for a car-free household in a bundled-parking unit', () => {
    const b = computeBudget(T, params, preset('carfree'));
    expect(b.outflows.find((f) => f.id === 'vehicle')!.amount).toBe(0);
    expect(flow(b, 'car_storage')).toBeGreaterThan(0);
    // Carved out of rent, not added on top of it.
    expect(flow(b, 'shelter') + flow(b, 'car_storage')).toBeCloseTo(T.rent_zillow!['2'] * 12, 6);
  });

  it('uses Zillow rent by default, HUD on request, and falls back to HUD where Zillow has no data', () => {
    const h = preset('carfree');
    h.spareSpaces = 0;
    expect(flow(computeBudget(T, params, h), 'shelter')).toBeCloseTo(T.rent_zillow!['2'] * 12, 6);
    h.rentSource = 'hud';
    expect(flow(computeBudget(T, params, h), 'shelter')).toBeCloseTo(T.safmr['2'] * 12, 6);
    h.rentSource = 'zillow';
    const b = computeBudget({ ...T, rent_zillow: null }, params, h);
    expect(flow(b, 'shelter')).toBeCloseTo(T.safmr['2'] * 12, 6);
    expect(b.notes.join(' ')).toMatch(/Zillow has no rent data/);
  });

  it('shows the street-parking in-kind inflow equal to its storage outflow', () => {
    const h = preset('onecar');
    const b = computeBudget(T, params, h);
    const inkind = b.inflows.find((f) => f.id === 'curb_inkind')!;
    expect(inkind.inKind).toBe(true);
    const expected = T.land_per_sqft * 160 * 0.05;
    expect(inkind.amount).toBeCloseTo(expected, 6);
    expect(flow(b, 'car_storage')).toBeCloseTo(expected, 6);
  });

  it('discloses a curb range and defaults to the lower value', () => {
    const h = preset('onecar');
    h.privateParkingMonthly = 300;
    const b = computeBudget(T, params, h);
    const land = T.land_per_sqft * 160 * 0.05;
    expect(b.curbRange).toEqual([Math.min(land, 3600), Math.max(land, 3600)]);
    expect(b.curbInKind).toBe(Math.min(land, 3600));
  });

  it('computes owner cost from ZHVI, PMMS and assumptions', () => {
    const h = preset('twocar');
    h.tenure = 'own';
    h.cars = [];
    const b = computeBudget(T, params, h);
    const price = T.zhvi['3']!;
    const expected = mortgagePayment(price * 0.8, params.pmms.rate_30yr, 30) * 12 + price * 0.011 + 2000;
    expect(flow(b, 'shelter')).toBeCloseTo(expected, 4);
  });

  it('uses the mortgage formula correctly', () => {
    // $400,000 at 6% for 30 years: standard amortization table value.
    expect(mortgagePayment(400000, 0.06, 30)).toBeCloseTo(2398.2, 1);
  });

  it('respects assumption overrides and VMT override', () => {
    const h = preset('onecar');
    h.overrides = { 'parking.land_yield': 0.1 };
    h.vmtOverride = 5000;
    const b = computeBudget(T, params, h);
    expect(b.curbInKind).toBeCloseTo(T.land_per_sqft * 160 * 0.1, 6);
    expect(b.annualMiles).toBe(5000);
  });

  it('reports owner cost unavailable instead of guessing', () => {
    const t: Tract = { ...T, zhvi: { ...T.zhvi, '3': null } };
    const b = computeBudget(t, params, { ...preset('twocar'), tenure: 'own' });
    expect(b.available).toBe(false);
  });

  it('attributes the whole difference for identical tracts as zero', () => {
    const h: Household = preset('twocar');
    const a = computeBudget(T, params, h);
    const c = compare(a, a);
    expect(c.diff).toBe(0);
    expect(c.carDiff).toBe(0);
  });

  it('breaks the difference into cash categories that sum to the total', () => {
    const h = preset('twocar');
    const a = computeBudget(tracts[SANITY_TRACTS[0][0]], params, h);
    const b = computeBudget(tracts[SANITY_TRACTS[1][0]], params, h);
    const c = compare(a, b);
    expect(c.categories.reduce((s, x) => s + x.diff, 0)).toBeCloseTo(c.diff, 6);
    for (const x of c.categories) expect(x.a).toBeGreaterThanOrEqual(0);
    const carIds = ['car_storage', 'vehicle', 'fuel'];
    expect(c.categories.filter((x) => carIds.includes(x.id)).reduce((s, x) => s + x.diff, 0)).toBeCloseTo(c.carDiff, 6);
  });

  it('drops the curb value everywhere when it is turned off', () => {
    const h = { ...preset('onecar'), showCurbValue: false };
    const b = computeBudget(T, params, h);
    expect(b.inflows.find((f) => f.id === 'curb_inkind')).toBeUndefined();
    expect(b.curbInKind).toBe(0);
    expect(flow(b, 'car_storage')).toBe(0);
  });

  it('what-if: fewer cars in B drops their costs and scales miles', () => {
    const h = preset('twocar');
    const full = computeBudget(T, params, h);
    const one = computeBudget(T, params, withCarCount(h, 1, params));
    expect(one.annualMiles).toBeCloseTo(full.annualMiles / 2, 6);
    // The dropped car is the older one: AAA fixed costs with half depreciation and no finance.
    const a = params.aaa;
    const olderCar = a.depreciation * 0.5 + a.insurance + a.license_registration_taxes;
    expect(flow(full, 'vehicle') - flow(one, 'vehicle')).toBeCloseTo(olderCar, 6);
    expect(one.curbInKind).toBe(0); // the dropped second car was the street-parked one
    expect(withCarCount(h, 2, params)).toBe(h);
  });

  it('reports parking carved out of housing', () => {
    const b = computeBudget(T, params, preset('twocar'));
    expect(b.parkingInHousing).toBe(1700);
  });

  it('traces every flow to known sources and assumptions', () => {
    const sources = JSON.parse(readFileSync(new URL('sources.json', dataDir), 'utf8'));
    for (const p of HOUSEHOLD_PRESETS) {
      const b = computeBudget(T, params, p.household);
      for (const f of [...b.inflows, ...b.outflows]) {
        for (const s of f.sources) expect(sources[s], s).toBeDefined();
        for (const a of f.assumptions) {
          const [g, k] = a.split('.');
          expect(params.assumptions[g]?.[k], a).toBeDefined();
        }
      }
    }
  });
});
