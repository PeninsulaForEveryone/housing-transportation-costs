// Household input form. Mutates the household in place and calls onChange.

import type { Car, Household, ParkRegime, Params } from './model/types';
import { assumptionValue, constructionAnnual } from './model/household';
import { HOUSEHOLD_PRESETS } from './presets';
import { el, yr } from './format';

const PARK_LABEL: Record<ParkRegime, string> = {
  bundled: 'Garage space included in rent',
  unbundled: 'Space rented separately',
  owned: 'Own garage or driveway',
  street: 'On the street',
};
const PARK_BY_TENURE: Record<Household['tenure'], ParkRegime[]> = {
  rent: ['bundled', 'unbundled', 'street'],
  own: ['owned', 'unbundled', 'street'],
};

let uid = 0;
const id = (p: string) => `${p}-${++uid}`;

function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  const cid = control.id || id('f');
  control.id = cid;
  const wrap = el('div', { class: 'field' }, el('label', { for: cid }, label), control);
  if (hint) {
    const hid = id('h');
    control.setAttribute('aria-describedby', hid);
    wrap.append(el('div', { class: 'hint', id: hid }, hint));
  }
  return wrap;
}

function select<T extends string | number>(options: [T, string][], value: T, on: (v: T) => void): HTMLSelectElement {
  const s = el('select');
  for (const [v, l] of options) {
    const o = el('option', { value: String(v) }, l);
    if (v === value) o.selected = true;
    s.append(o);
  }
  s.addEventListener('change', () => {
    const raw = s.value;
    const match = options.find(([v]) => String(v) === raw);
    if (match) on(match[0]);
  });
  return s;
}

function numberInput(value: number | null, on: (v: number | null) => void, attrs: Record<string, string> = {}): HTMLInputElement {
  const i = el('input', { type: 'number', inputmode: 'decimal', ...attrs });
  i.value = value == null ? '' : String(value);
  i.addEventListener('change', () => {
    const t = i.value.trim();
    on(t === '' ? null : Number(t));
  });
  return i;
}

const range = (lo: number, hi: number): [number, string][] =>
  Array.from({ length: hi - lo + 1 }, (_, i) => [lo + i, String(lo + i)]);

export interface MilesContext { a: number; b: number; aName: string; bName: string }

/** Yearly cost of owning one car before fuel (AAA, with the older-car assumptions applied). */
export function carFixedCost(p: Params, h: Household, age: Car['age']): number {
  const A = (path: string) => assumptionValue(p.assumptions, h.overrides, path);
  const dep = p.aaa.depreciation * (age === 'old' ? A('vehicle.older_car_depreciation_factor') : 1);
  const fin = p.aaa.finance * (age === 'old' ? A('vehicle.older_car_finance_factor') : 1);
  return dep + fin + p.aaa.insurance + p.aaa.license_registration_taxes;
}

export function renderControls(root: HTMLElement, h: Household, p: Params, onChange: () => void, presetId: string | null, miles: MilesContext): void {
  const changed = () => onChange();
  // Ids are regenerated in the same order on every render, so focus can be restored after a re-render.
  const active = root.contains(document.activeElement) ? document.activeElement?.id : undefined;
  const advOpen = (root.querySelector('details.advanced') as HTMLDetailsElement | null)?.open ?? false;
  uid = 0;
  root.replaceChildren();

  // Presets
  const presetSel = select<string>(
    [['', 'Custom household'], ...HOUSEHOLD_PRESETS.map((x) => [x.id, x.label] as [string, string])],
    presetId ?? '',
    (v) => {
      const pr = HOUSEHOLD_PRESETS.find((x) => x.id === v);
      if (!pr) return;
      Object.assign(h, structuredClone(pr.household));
      changed();
    },
  );
  root.append(field('Start from an example', presetSel));

  // People and income
  const people = el('fieldset', {}, el('legend', {}, 'Household'));
  people.append(
    field('Gross annual income', numberInput(h.income, (v) => { h.income = Math.max(0, v ?? 0); changed(); }, { min: '0', step: '1000' }),
      'Before taxes. Treated as wages split evenly across workers.'),
    el('div', { class: 'row' },
      field('Adults', select(range(1, 2), h.adults, (v) => { h.adults = v; h.workers = Math.min(h.workers, v); changed(); })),
      field('Children', select(range(0, 6), h.children, (v) => { h.children = v; changed(); })),
      field('Workers', select(range(0, h.adults), h.workers, (v) => { h.workers = v; changed(); })),
    ),
  );
  root.append(people);

  // Home
  const home = el('fieldset', {}, el('legend', {}, 'Home'));
  const tenure = select<Household['tenure']>([['rent', 'Rent'], ['own', 'Own (buying now)']], h.tenure, (v) => {
    h.tenure = v;
    h.cars = h.cars.map((c): Car => ({ ...c, park: PARK_BY_TENURE[v].includes(c.park) ? c.park : v === 'own' ? 'owned' : 'bundled' }));
    changed();
  });
  const bedrooms = select<Household['bedrooms']>([['0', 'Studio'], ['1', '1 bedroom'], ['2', '2 bedrooms'], ['3', '3 bedrooms'], ['4', '4 bedrooms']],
    h.bedrooms, (v) => { h.bedrooms = v; changed(); });
  home.append(el('div', { class: 'row' }, field('Tenure', tenure), field('Size', bedrooms)));
  if (h.tenure === 'rent') {
    home.append(field('Rent data', select<Household['rentSource']>(
      [['zillow', 'Zillow rent index (market asking rents)'], ['hud', 'HUD Small Area Fair Market Rent']],
      h.rentSource, (v) => { h.rentSource = v; changed(); }),
    'Zillow is split by bedroom count using HUD ratios. Where Zillow has no data, HUD is used.'));
  }
  const spareOpts: [number, string][] = [[0, 'No'], [1, 'Yes, 1 space'], [2, 'Yes, 2 spaces'], [3, 'Yes, 3 spaces']];
  home.append(field(
    h.tenure === 'rent' ? "Does your rent include garage parking you don't use?" : 'Does your home have a garage or driveway space no car uses?',
    select(spareOpts, h.spareSpaces, (v) => { h.spareSpaces = v; changed(); }),
    h.tenure === 'rent' ? 'Many buildings include parking in the rent whether or not you have a car.' : undefined,
  ));
  root.append(home);

  // Cars
  const cars = el('fieldset', {}, el('legend', {}, 'Cars'));
  h.cars.forEach((car, i) => {
    const row = el('div', { class: 'car-row', role: 'group', 'aria-label': `Car ${i + 1}` });
    const rm = el('button', { type: 'button', class: 'link-button', id: id('rm'), 'aria-label': `Remove car ${i + 1}` }, 'Remove');
    rm.addEventListener('click', () => { h.cars.splice(i, 1); changed(); });
    row.append(
      el('div', { class: 'car-head' }, el('span', {}, `Car ${i + 1}`), rm),
      field('Age', select<Car['age']>([
        ['old', `Older, paid off (about ${yr(carFixedCost(p, h, 'old'))}/yr)`],
        ['new', `Newer, financed (about ${yr(carFixedCost(p, h, 'new'))}/yr)`],
      ], car.age, (v) => { car.age = v; changed(); })),
      field('Parked', select<ParkRegime>(PARK_BY_TENURE[h.tenure].map((k) => [k, PARK_LABEL[k]]), car.park, (v) => { car.park = v; changed(); })),
    );
    cars.append(row);
  });
  if (h.cars.length) {
    cars.append(el('p', { class: 'hint' }, 'Yearly cost per car covers depreciation, loan interest, insurance, and registration (AAA national averages), before fuel.'));
  }
  if (h.cars.length === 0) cars.append(el('p', { class: 'hint' }, 'No cars.'));
  if (h.cars.length < 4) {
    const add = el('button', { type: 'button', class: 'button-secondary', id: 'add-car' }, 'Add a car');
    add.addEventListener('click', () => {
      h.cars.push({ age: 'old', park: h.tenure === 'rent' ? 'bundled' : 'owned' });
      changed();
    });
    cars.append(add);
  }
  if (h.cars.some((c) => c.park === 'street')) {
    const cb = el('input', { type: 'checkbox', id: 'show-curb' });
    cb.checked = h.showCurbValue;
    cb.addEventListener('change', () => { h.showCurbValue = cb.checked; changed(); });
    cars.append(el('div', { class: 'field checkbox-field' },
      el('label', { for: 'show-curb' }, cb, ' Show the value of free street parking'),
      el('div', { class: 'hint' }, 'The curb space a parked car uses has a rental value. The city provides it free, so the charts can show it as non-cash value. Your cash budget is the same either way.')));
  }
  if (h.cars.length) {
    const round = (n: number) => Math.round(n / 100) * 100;
    cars.append(field('About how many miles a year does your household drive?',
      numberInput(h.vmtOverride, (v) => { h.vmtOverride = v; changed(); }, { min: '0', step: '500', placeholder: 'Typical for each place' }),
      `Leave blank to use typical driving for each place: about ${round(miles.a).toLocaleString('en-US')} miles/yr in ${miles.aName} (A) and ${round(miles.b).toLocaleString('en-US')} in ${miles.bName} (B), from the regional travel model. That model counts only trips to and from home, so it tends to run low; your own number is better if you know it.`));
  }
  root.append(cars);

  // Transit
  const zones = p.transit.caltrain.monthly_by_zones;
  const transit = el('fieldset', {}, el('legend', {}, 'Transit passes'));
  transit.append(
    el('div', { class: 'row' },
      field('Caltrain monthly', select(range(0, 4), h.caltrainPasses, (v) => { h.caltrainPasses = v; changed(); })),
      field('Zones', select(range(1, 6).map(([z]) => [z, `${z} (${yr(zones[String(z)] * 12)}/yr)`] as [number, string]),
        h.caltrainZones, (v) => { h.caltrainZones = v; changed(); })),
    ),
    field('SamTrans monthly', select(range(0, 4), h.samtransPasses, (v) => { h.samtransPasses = v; changed(); }),
      'Caltrain passes of 2 or more zones include SamTrans local rides.'),
  );
  root.append(transit);

  // Advanced
  const adv = el('details', { class: 'advanced' }, el('summary', {}, 'Adjust estimates and assumptions'));
  const A = (path: string) => assumptionValue(p.assumptions, {}, path);
  const override = (path: string, label: string, scale = 1, step = 'any', hint?: string) => {
    const cur = h.overrides[path];
    const input = numberInput(cur == null ? null : +(cur * scale).toFixed(4), (v) => {
      if (v == null) delete h.overrides[path];
      else h.overrides[path] = v / scale;
      changed();
    }, { step, placeholder: String(+(A(path) * scale).toFixed(4)) });
    return field(label, input, hint ?? `Default ${+(A(path) * scale).toFixed(4)}. Leave blank for the default.`);
  };
  adv.append(
    field('Separately rented parking, $/month per space', numberInput(h.unbundledMonthly, (v) => { h.unbundledMonthly = v; changed(); },
      { min: '0', step: '10', placeholder: String(A('parking.unbundled_monthly_default')) })),
    field('Nearby private parking rent, $/month', numberInput(h.privateParkingMonthly, (v) => { h.privateParkingMonthly = v; changed(); }, { min: '0', step: '10' }),
      'Optional. Used as a market check on the value of a curb space; the lower of the two is shown.'),
    field('Cost of a garage space included in rent', select<Household['bundledMethod']>([
      ['study', `Rent premium from a national study (${yr(A('parking.bundled_garage_annual'))}/yr)`],
      ['construction', `Construction cost, annualized (${yr(constructionAnnual(p, h))}/yr)`],
    ], h.bundledMethod, (v) => { h.bundledMethod = v; changed(); })),
    override('parking.land_yield', 'Land yield, % per year', 100, '0.5'),
    override('parking.curb_stall_sqft', 'Curb space size, sq ft', 1, '10'),
    override('parking.garage_stall_sqft', 'Garage or driveway space size, sq ft', 1, '10'),
    override('parking.construction_cost_per_space', 'Construction cost per structured space, $', 1, '1000'),
    override('vmt.days_per_year', 'Days per year applied to weekday miles', 1, '1'),
    override('owner.down_payment_pct', 'Down payment, %', 100, '1'),
    override('owner.property_tax_rate', 'Property tax, % of price', 100, '0.05'),
    override('owner.homeowners_insurance_annual', 'Homeowners insurance, $/yr', 1, '100'),
  );
  const reset = el('button', { type: 'button', class: 'button-secondary' }, 'Reset all to defaults');
  reset.addEventListener('click', () => {
    h.overrides = {};
    h.unbundledMonthly = null;
    h.privateParkingMonthly = null;
    h.bundledMethod = 'study';
    changed();
  });
  adv.append(reset);
  if (advOpen || Object.keys(h.overrides).length || h.bundledMethod !== 'study') adv.open = true;
  root.append(adv);
  root.append(el('p', { class: 'hint' }, 'Monthly figures round to the nearest $10, yearly figures to the nearest $100.'));
  if (active) (root.querySelector(`#${CSS.escape(active)}`) as HTMLElement | null)?.focus();
}
