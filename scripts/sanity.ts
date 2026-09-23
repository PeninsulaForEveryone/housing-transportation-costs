// Prints the per-tract inputs and the preset household budgets for contrasting tracts.
// Uses the same model code as the site. Run: npx tsx scripts/sanity.ts
import { readFileSync } from 'node:fs';
import { computeBudget } from '../site/src/model/household';
import type { Params, Tract } from '../site/src/model/types';
import { HOUSEHOLD_PRESETS, SANITY_TRACTS } from '../site/src/presets';

const dir = new URL('../site/public/data/', import.meta.url);
const params: Params = JSON.parse(readFileSync(new URL('params.json', dir), 'utf8'));
const tracts: Record<string, Tract> = JSON.parse(readFileSync(new URL('tracts.json', dir), 'utf8'));

const k = (n: number) => `$${Math.round(n / 100) * 100 >= 1000 ? (Math.round(n / 100) / 10).toFixed(1) + 'k' : Math.round(n / 100) * 100}`;
const money = (n: number | null | undefined, step = 100) => (n == null ? 'n/a' : `$${(Math.round(n / step) * step).toLocaleString('en-US')}`);
const pct = (s?: { share: number | null; moe: number | null }) =>
  s?.share == null ? 'n/a' : `${Math.round(s.share * 100)}% ±${Math.round((s.moe ?? 0) * 100)}`;

function table(headers: string[], rows: string[][]) {
  const w = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (r: string[]) => r.map((c, i) => (i === 0 ? c.padEnd(w[i]) : c.padStart(w[i]))).join('  ');
  console.log(line(headers));
  console.log(w.map((x) => '-'.repeat(x)).join('  '));
  rows.forEach((r) => console.log(line(r)));
  console.log();
}

const A = params.assumptions.parking;
console.log('\nTRACT INPUTS (precomputed by the pipeline)\n');
table(
  ['Tract', 'Zillow 2BR/mo', 'HUD 2BR/mo', 'Home 3BR', 'Land $/sqft', 'Land method', 'Curb $/yr', 'VMT/res/day', 'Med. income (ACS)', 'No-car hh', 'Transit commute'],
  SANITY_TRACTS.map(([g, label]) => {
    const t = tracts[g];
    return [
      `${label} (${t.name})`,
      t.rent_zillow ? money(t.rent_zillow['2'], 10) : 'n/a (HUD used)',
      money(t.safmr['2'], 10),
      money(t.zhvi['3'], 1000),
      `$${t.land_per_sqft.toFixed(0)}`,
      t.land_method,
      money(t.land_per_sqft * (A.curb_stall_sqft.value as number) * (A.land_yield.value as number)),
      t.vmt_per_resident_weekday.toFixed(1),
      t.acs.median_hh_income == null ? 'n/a' : `${money(t.acs.median_hh_income, 1000)} ±${money(t.acs.median_hh_income_moe, 1000)}${t.acs.median_hh_income >= 250000 ? ' (top-coded)' : ''}`,
      pct(t.acs.vehicles?.['0']),
      pct(t.acs.commute?.transit),
    ];
  }),
);

for (const p of HOUSEHOLD_PRESETS) {
  const h = p.household;
  console.log(`HOUSEHOLD: ${p.label}`);
  console.log(`  income ${money(h.income)}, ${h.adults} adult(s), ${h.children} child(ren), ${h.tenure} ${h.bedrooms}BR, ` +
    `cars: ${h.cars.map((c) => `${c.age}/${c.park}`).join(', ') || 'none'}, spare spaces ${h.spareSpaces}\n`);
  table(
    ['Tract', 'Taxes', 'Housing', 'Car storage', '(in-kind curb)', 'Vehicles', 'Fuel+wear', 'Miles/yr', 'Transit', 'Left over', 'Cash H+T', 'H+T % income'],
    SANITY_TRACTS.map(([g, label]) => {
      const b = computeBudget(tracts[g], params, h);
      if (!b.available) return [label, ...Array(11).fill('n/a')];
      const f = (id: string) => b.outflows.find((x) => x.id === id)!.amount;
      return [
        label, k(f('taxes')), k(f('shelter')), k(f('car_storage')), k(b.curbInKind), k(f('vehicle')), k(f('fuel')),
        Math.round(b.annualMiles).toLocaleString('en-US'), k(f('transit')), k(f('remainder')), k(b.cashCost),
        `${Math.round((b.cashCost / h.income) * 100)}%`,
      ];
    }),
  );
}
