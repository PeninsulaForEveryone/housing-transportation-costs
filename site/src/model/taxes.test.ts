import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bracketTax, computeTaxes, filingStatus } from './taxes';
import type { Params } from './types';

const params: Params = JSON.parse(readFileSync(new URL('../../public/data/params.json', import.meta.url), 'utf8'));
const T = params.taxes;

// Expected values worked by hand from Rev. Proc. 2025-32 tables and the FTB 2025 Schedules X/Y.
describe('taxes', () => {
  it('derives filing status', () => {
    expect(filingStatus(1, 0)).toBe('single');
    expect(filingStatus(1, 2)).toBe('hoh');
    expect(filingStatus(2, 0)).toBe('mfj');
  });

  it('matches the FTB schedule base amounts', () => {
    // Schedule Y: over 115,084 -> 3,974.82 + 8% of excess
    expect(bracketTax(138588 - 0, T.ca.brackets.mfj)).toBeCloseTo(3974.82 + 0.08 * (138588 - 115084), 1);
    // Rev. Proc. Table 1: over 512,450 -> 116,896 + 35% of excess
    expect(bracketTax(567800, T.federal.brackets.mfj)).toBeCloseTo(116896 + 0.35 * (567800 - 512450), 1);
  });

  it('single, $100k, one worker', () => {
    const r = computeTaxes(T, { income: 100000, adults: 1, children: 0, workers: 1 });
    expect(r.federalIncome).toBeCloseTo(13170, 0);
    expect(r.stateIncome).toBeCloseTo(5207.98 - 153, 1);
    expect(r.socialSecurity).toBeCloseTo(6200, 2);
    expect(r.medicare).toBeCloseTo(1450, 2);
    expect(r.sdi).toBeCloseTo(1300, 2);
    expect(r.total).toBeCloseTo(27174.98, 1);
  });

  it('married, $150k, two workers, one child', () => {
    const r = computeTaxes(T, { income: 150000, adults: 2, children: 1, workers: 2 });
    expect(r.federalIncome).toBeCloseTo(15340 - 2200, 0);
    expect(r.stateIncome).toBeCloseTo(5855.14 - (2 * 153 + 475), 1);
    expect(r.total).toBeCloseTo(31639.14, 1);
  });

  it('phases out credits and applies wage base and Additional Medicare at $600k', () => {
    const r = computeTaxes(T, { income: 600000, adults: 2, children: 2, workers: 2 });
    expect(r.childTaxCredit).toBe(0);
    expect(r.federalIncome).toBeCloseTo(136268.5, 1);
    expect(r.socialSecurity).toBeCloseTo(2 * 184500 * 0.062, 2);
    expect(r.medicare).toBeCloseTo(600000 * 0.0145 + 350000 * 0.009, 2);
    // CA: excess 95,589 -> 39 steps x $6 = $234 cut; personal credits gone, dependents 2 x 241.
    const taxable = 600000 - 11412;
    expect(r.stateIncome).toBeCloseTo(bracketTax(taxable, T.ca.brackets.mfj) - 2 * 241, 1);
  });

  it('pays the refundable child credit at low income', () => {
    const r = computeTaxes(T, { income: 30000, adults: 1, children: 2, workers: 1 });
    // Tax before credits 585; refundable part capped at 2 x $1,700.
    expect(r.federalBeforeCredits).toBeCloseTo(585, 2);
    expect(r.federalIncome).toBeCloseTo(-3400, 2);
  });

  it('has no payroll tax without workers', () => {
    const r = computeTaxes(T, { income: 60000, adults: 1, children: 0, workers: 0 });
    expect(r.socialSecurity + r.medicare + r.sdi).toBe(0);
  });
});
