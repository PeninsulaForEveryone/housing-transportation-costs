// Household taxes: federal income tax (2026), California income tax (2025 schedule, latest published),
// FICA (2026), and CA SDI (2026). Pure functions; all tables come from params.json.
// Simplifications: all income is wages, split evenly across workers; standard deduction only;
// every child is a qualifying child under 17 with an SSN; no EITC, renter's credit, or other credits.

import type { FilingStatus, TaxTables } from './types';

export interface TaxInput {
  income: number;
  adults: number;
  children: number;
  workers: number;
}

export interface TaxResult {
  status: FilingStatus;
  federalIncome: number;   // after child tax credit, can be negative (refundable credit)
  federalBeforeCredits: number;
  childTaxCredit: number;  // nonrefundable + refundable parts actually used
  stateIncome: number;
  socialSecurity: number;
  medicare: number;
  sdi: number;
  total: number;
}

export function filingStatus(adults: number, children: number): FilingStatus {
  if (adults >= 2) return 'mfj';
  return children > 0 ? 'hoh' : 'single';
}

export function bracketTax(taxable: number, brackets: [number, number][]): number {
  let tax = 0;
  for (let i = 0; i < brackets.length; i++) {
    const [lo, rate] = brackets[i];
    const hi = i + 1 < brackets.length ? brackets[i + 1][0] : Infinity;
    if (taxable <= lo) break;
    tax += (Math.min(taxable, hi) - lo) * rate;
  }
  return tax;
}

export function federalTax(t: TaxTables, x: TaxInput, status: FilingStatus) {
  const f = t.federal;
  const taxable = Math.max(0, x.income - f.standard_deduction[status]);
  const before = bracketTax(taxable, f.brackets[status]);
  // Child tax credit (Schedule 8812): phase-out on excess AGI rounded up to the next $1,000.
  const excess = Math.max(0, x.income - f.ctc_phaseout_start[status]);
  const reduction = Math.ceil(excess / 1000) * 1000 * f.ctc_phaseout_rate;
  const credit = Math.max(0, x.children * f.ctc_per_child - reduction);
  const nonrefundable = Math.min(credit, before);
  const earned = x.workers > 0 ? x.income : 0;
  const refundable = Math.min(
    credit - nonrefundable,
    x.children * f.ctc_refundable_max,
    Math.max(0, earned - f.actc_earned_income_floor) * f.actc_rate,
  );
  return { before, credit: nonrefundable + refundable, net: before - nonrefundable - refundable };
}

export function stateTax(t: TaxTables, x: TaxInput, status: FilingStatus): number {
  const c = t.ca;
  const taxable = Math.max(0, x.income - c.standard_deduction[status]);
  let tax = bracketTax(taxable, c.brackets[status]);
  // Exemption credits, each reduced by $6 per $2,500 (or part) of AGI over the threshold (Form 540 line 32 worksheet).
  const over = Math.max(0, x.income - c.credit_phaseout_start[status]);
  const cut = Math.ceil(over / 2500) * c.credit_phaseout_per_2500;
  const personal = c.personal_credit_count[status] * Math.max(0, c.personal_credit - cut);
  const dependents = x.children * Math.max(0, c.dependent_credit - cut);
  tax = Math.max(0, tax - personal - dependents);
  // Behavioral Health Services Tax: 1% of taxable income over $1,000,000.
  tax += Math.max(0, taxable - c.bhst_threshold) * c.bhst_rate;
  return tax;
}

export function payrollTax(t: TaxTables, x: TaxInput, status: FilingStatus) {
  if (x.workers <= 0) return { ss: 0, medicare: 0, sdi: 0 };
  const perWorker = x.income / x.workers;
  const ss = x.workers * Math.min(perWorker, t.fica.ss_wage_base) * t.fica.ss_rate;
  const medicare = x.income * t.fica.medicare_rate +
    Math.max(0, x.income - t.fica.addl_medicare_threshold[status]) * t.fica.addl_medicare_rate;
  const sdi = x.income * t.ca.sdi_rate;
  return { ss, medicare, sdi };
}

export function computeTaxes(t: TaxTables, x: TaxInput): TaxResult {
  const status = filingStatus(x.adults, x.children);
  const fed = federalTax(t, x, status);
  const state = stateTax(t, x, status);
  const p = payrollTax(t, x, status);
  return {
    status,
    federalIncome: fed.net,
    federalBeforeCredits: fed.before,
    childTaxCredit: fed.credit,
    stateIncome: state,
    socialSecurity: p.ss,
    medicare: p.medicare,
    sdi: p.sdi,
    total: fed.net + state + p.ss + p.medicare + p.sdi,
  };
}
