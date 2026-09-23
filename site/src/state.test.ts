import { describe, expect, it } from 'vitest';
import { HOUSEHOLD_PRESETS, TRACT_PAIRS } from './presets';
import { decode, defaultState, encode, type AppState } from './state';

const valid = () => true;

describe('URL state', () => {
  it('round-trips every preset household and both tracts', () => {
    for (const p of HOUSEHOLD_PRESETS) {
      const s: AppState = { household: structuredClone(p.household), a: TRACT_PAIRS[1].a, b: TRACT_PAIRS[1].b, metric: 'car_cost', bCars: null };
      expect(decode(`?${encode(s)}`, valid)).toEqual(s);
    }
  });

  it('round-trips the default example, including its car-count what-if', () => {
    const s = defaultState();
    expect(s.bCars).toBe(TRACT_PAIRS[0].bCars);
    expect(decode(`?${encode(s)}`, valid)).toEqual(s);
  });

  it('round-trips overrides and optional inputs', () => {
    const s = defaultState();
    s.household.cars = [{ age: 'old', park: 'street' }, { age: 'new', park: 'unbundled' }];
    s.household.overrides = { 'parking.land_yield': 0.04, 'owner.down_payment_pct': 0.1 };
    s.household.vmtOverride = 9000;
    s.household.unbundledMonthly = 175;
    s.household.privateParkingMonthly = 250;
    s.household.bundledMethod = 'construction';
    s.household.rentSource = 'hud';
    s.household.showCurbValue = false;
    s.metric = 'vmt';
    s.bCars = 1;
    expect(decode(`?${encode(s)}`, valid)).toEqual(s);
  });

  it('falls back to defaults for invalid tracts and values', () => {
    const s = decode('?a=999&b=06081613702&ad=7&br=9&cars=zz.os', (g) => g === '06081613702');
    const d = defaultState();
    expect(s.a).toBe(d.a);
    expect(s.b).toBe('06081613702');
    expect(s.household.adults).toBe(2);
    expect(s.household.bedrooms).toBe(d.household.bedrooms);
    expect(s.household.cars).toEqual([{ age: 'old', park: 'street' }]);
  });
});
