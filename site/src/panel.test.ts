import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeBudget } from './model/household';
import type { Params, Tract } from './model/types';
import { budgetCaption } from './panel';
import { HOUSEHOLD_PRESETS, SANITY_TRACTS } from './presets';

const dir = new URL('../public/data/', import.meta.url);
const params: Params = JSON.parse(readFileSync(new URL('params.json', dir), 'utf8'));
const tracts: Record<string, Tract> = JSON.parse(readFileSync(new URL('tracts.json', dir), 'utf8'));

describe('budget caption', () => {
  it('states income as income and the curb value separately as non-cash', () => {
    const h = HOUSEHOLD_PRESETS.find((p) => p.id === 'twocar')!.household;
    const b = computeBudget(tracts[SANITY_TRACTS[0][0]], params, h);
    const c = budgetCaption(b, 'San Mateo');
    expect(c).toContain("household's $220,000/yr income goes");
    expect(c).toMatch(/free curb space .* not cash/);
    expect(c).not.toContain('$221,');
  });

  it('mentions a shortfall when costs exceed income', () => {
    const h = { ...HOUSEHOLD_PRESETS[0].household, income: 40000 };
    const b = computeBudget(tracts[SANITY_TRACTS[0][0]], params, h);
    expect(budgetCaption(b, 'X')).toMatch(/Costs exceed income by \$[\d,]+\/yr/);
  });
});
