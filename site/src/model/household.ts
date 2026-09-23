// Annual budget for one fixed household living in one tract. Pure: no DOM, no fetch.
// Every number comes from the tract record, params.json, or assumptions.json (with user overrides).

import { computeTaxes, type TaxResult } from './taxes';
import type { Assumptions, Classification, Household, Params, Tract } from './types';

export type FlowId =
  | 'income' | 'curb_inkind' | 'shortfall'
  | 'taxes' | 'shelter' | 'car_storage' | 'vehicle' | 'fuel' | 'transit' | 'remainder';

export interface Flow {
  id: FlowId;
  label: string;
  amount: number;              // $/yr
  classification: Classification | 'input' | 'derived';
  inKind?: boolean;            // non-cash
  carRelated?: boolean;
  sources: string[];           // ids in sources.json
  assumptions: string[];       // "group.key" in assumptions.json
}

export interface LineItem {
  flow: FlowId;
  label: string;
  amount: number;
  note?: string;
  range?: [number, number];
}

export interface Budget {
  available: boolean;
  unavailableReason?: string;
  inflows: Flow[];
  outflows: Flow[];
  items: LineItem[];
  taxes: TaxResult;
  annualMiles: number;
  milesSource: 'model' | 'override' | 'none';
  parkingInHousing: number;  // parking cost already inside the rent or home price, moved to car storage
  cashCost: number;          // housing + transport paid in cash (excludes taxes and in-kind)
  carCashCost: number;       // car storage paid in cash + vehicle + fuel
  curbInKind: number;
  curbRange: [number, number] | null;
  notes: string[];
}

export function assumptionValue(a: Assumptions, overrides: Record<string, number>, path: string): number {
  if (path in overrides && Number.isFinite(overrides[path])) return overrides[path];
  const [g, k] = path.split('.');
  const v = a[g]?.[k]?.value;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v !== 'number') throw new Error(`Unknown assumption ${path}`);
  return v;
}

export function mortgagePayment(principal: number, annualRate: number, years: number): number {
  const r = annualRate / 12;
  const n = years * 12;
  if (r === 0) return principal / n;
  return (principal * r) / (1 - Math.pow(1 + r, -n));
}

export function capitalRecovery(rate: number, years: number): number {
  return rate === 0 ? 1 / years : rate / (1 - Math.pow(1 + rate, -years));
}

/** Annual cost of one structured parking space by construction cost (alternative to the rent-premium study). */
export function constructionAnnual(p: Params, h: Household): number {
  const A = (k: string) => assumptionValue(p.assumptions, h.overrides, `parking.${k}`);
  return A('construction_cost_per_space') * (1 + A('construction_soft_cost_pct')) *
    capitalRecovery(A('construction_discount_rate'), A('construction_life_years'));
}

export function computeBudget(t: Tract, p: Params, h: Household): Budget {
  const A = (path: string) => assumptionValue(p.assumptions, h.overrides, path);
  const items: LineItem[] = [];
  const notes: string[] = [];
  const persons = h.adults + h.children;
  const taxes = computeTaxes(p.taxes, { income: h.income, adults: h.adults, children: h.children, workers: h.workers });

  // ---- housing (before carving out parking)
  let housing: number;
  let shelterClass: Classification;
  const shelterSources: string[] = [];
  const shelterAssumptions: string[] = [];
  let rentLabel = '';
  if (h.tenure === 'rent') {
    if (h.rentSource === 'zillow' && t.rent_zillow) {
      housing = t.rent_zillow[h.bedrooms] * 12;
      shelterClass = 'modeled';
      shelterSources.push('zillow_zori', 'hud_safmr', 'acs');
      rentLabel = 'Zillow rent index, split by bedroom count';
    } else {
      housing = t.safmr[h.bedrooms] * 12;
      shelterClass = 'observed';
      shelterSources.push('hud_safmr');
      rentLabel = 'HUD Small Area Fair Market Rent';
      if (h.rentSource === 'zillow') notes.push('Zillow has no rent data covering this tract, so rent uses HUD Small Area Fair Market Rent.');
    }
  } else {
    const price = t.zhvi[h.bedrooms];
    if (price == null) {
      return unavailable(taxes, 'No Zillow home value covers this tract for this home size, so owner cost is not shown.');
    }
    const loan = price * (1 - A('owner.down_payment_pct'));
    const pi = mortgagePayment(loan, p.pmms.rate_30yr, A('owner.mortgage_term_years')) * 12;
    const ptax = price * A('owner.property_tax_rate');
    const ins = A('owner.homeowners_insurance_annual');
    housing = pi + ptax + ins;
    shelterClass = 'modeled';
    shelterSources.push('zillow_zhvi', 'freddie_pmms');
    shelterAssumptions.push('owner.down_payment_pct', 'owner.mortgage_term_years', 'owner.property_tax_rate',
      'owner.homeowners_insurance_annual');
    items.push({ flow: 'shelter', label: `Mortgage principal and interest (${(p.pmms.rate_30yr * 100).toFixed(2)}%, ${Math.round(A('owner.down_payment_pct') * 100)}% down)`, amount: pi });
    items.push({ flow: 'shelter', label: 'Property tax', amount: ptax });
    items.push({ flow: 'shelter', label: 'Homeowners insurance', amount: ins });
    if (t.zhvi_series[h.bedrooms] === 'zhvi_all_homes') notes.push('Home value uses the all-homes series; no bedroom-specific value covers this tract.');
  }

  // ---- car storage
  const landSqft = t.land_per_sqft;
  const yieldRate = A('parking.land_yield');
  const garageLand = landSqft * A('parking.garage_stall_sqft') * yieldRate;
  const curbLand = landSqft * A('parking.curb_stall_sqft') * yieldRate;
  const bundledUsed = h.bundledMethod === 'construction' ? constructionAnnual(p, h) : A('parking.bundled_garage_annual');
  const bundledSpare = h.bundledMethod === 'construction' ? constructionAnnual(p, h) : A('parking.bundled_carless_annual');
  const unbundledFee = (h.unbundledMonthly ?? A('parking.unbundled_monthly_default')) * 12;
  const privateAnnual = h.privateParkingMonthly != null && h.privateParkingMonthly > 0 ? h.privateParkingMonthly * 12 : null;

  let carveOut = 0;         // parking cost already inside the rent or home price
  let storageFees = 0;      // parking paid separately
  let curbInKind = 0;
  let curbHigh = 0;
  const storageSources = new Set<string>();
  const storageAssumptions = new Set<string>();
  const bundledRef = () => {
    if (h.bundledMethod === 'construction') {
      storageSources.add('wgi_2026');
      ['construction_cost_per_space', 'construction_soft_cost_pct', 'construction_discount_rate', 'construction_life_years']
        .forEach((k) => storageAssumptions.add(`parking.${k}`));
    } else {
      storageSources.add('gabbe_pierce_2017');
    }
  };
  const landRef = (stall: 'garage_stall_sqft' | 'curb_stall_sqft') => {
    storageSources.add('fhfa_land');
    storageAssumptions.add(`parking.${stall}`);
    storageAssumptions.add('parking.land_yield');
  };

  h.cars.forEach((car, i) => {
    const n = h.cars.length > 1 ? ` (car ${i + 1})` : '';
    if (car.park === 'bundled') {
      carveOut += bundledUsed;
      bundledRef();
      if (h.bundledMethod === 'study') storageAssumptions.add('parking.bundled_garage_annual');
      items.push({ flow: 'car_storage', label: `Garage space included in rent${n}`, amount: bundledUsed });
    } else if (car.park === 'unbundled') {
      storageFees += unbundledFee;
      storageAssumptions.add('parking.unbundled_monthly_default');
      items.push({ flow: 'car_storage', label: `Parking space rented separately${n}`, amount: unbundledFee,
        note: h.unbundledMonthly == null ? 'Default fee; enter your own.' : 'Your fee.' });
    } else if (car.park === 'owned') {
      carveOut += garageLand;
      landRef('garage_stall_sqft');
      items.push({ flow: 'car_storage', label: `Land under your garage or driveway space${n}`, amount: garageLand });
    } else if (!h.showCurbValue) {
      items.push({ flow: 'car_storage', label: `Curb space provided by the city${n}`, amount: 0,
        note: 'Value not shown (turned off in Cars).' });
    } else {
      const lo = privateAnnual != null ? Math.min(curbLand, privateAnnual) : curbLand;
      const hi = privateAnnual != null ? Math.max(curbLand, privateAnnual) : curbLand;
      curbInKind += lo;
      curbHigh += hi;
      landRef('curb_stall_sqft');
      items.push({ flow: 'car_storage', label: `Curb space provided by the city${n}`, amount: lo, range: [lo, hi],
        note: privateAnnual != null
          ? 'Lower of the land-value estimate and your nearby private parking rent.'
          : 'Land-value estimate. Enter a nearby private parking rent to see a range.' });
    }
  });
  for (let i = 0; i < h.spareSpaces; i++) {
    if (h.tenure === 'rent') {
      carveOut += bundledSpare;
      bundledRef();
      if (h.bundledMethod === 'study') storageAssumptions.add('parking.bundled_carless_annual');
      items.push({ flow: 'car_storage', label: 'Unused garage space included in rent', amount: bundledSpare,
        note: 'You pay for it in the rent whether or not you have a car.' });
    } else {
      carveOut += garageLand;
      landRef('garage_stall_sqft');
      items.push({ flow: 'car_storage', label: 'Land under an unused garage or driveway space', amount: garageLand });
    }
  }
  if (carveOut > housing) {
    notes.push('Parking included in the housing cost was capped at the full housing cost.');
    carveOut = housing;
  }
  const shelter = housing - carveOut;
  const carStorage = carveOut + storageFees + curbInKind;
  if (h.tenure === 'rent') {
    items.unshift({ flow: 'shelter', label: `Rent, ${h.bedrooms === '0' ? 'studio' : h.bedrooms + ' bedroom'} (${rentLabel})`, amount: housing });
  }
  if (carveOut > 0) items.push({ flow: 'shelter', label: 'Less parking included in housing cost (moved to car storage)', amount: -carveOut });

  // ---- vehicles
  const aaa = p.aaa;
  let vehicle = 0;
  const vehicleAssumptions: string[] = [];
  h.cars.forEach((car, i) => {
    const n = h.cars.length > 1 ? ` (car ${i + 1})` : '';
    const dep = aaa.depreciation * (car.age === 'old' ? A('vehicle.older_car_depreciation_factor') : 1);
    const fin = aaa.finance * (car.age === 'old' ? A('vehicle.older_car_finance_factor') : 1);
    if (car.age === 'old') vehicleAssumptions.push('vehicle.older_car_depreciation_factor', 'vehicle.older_car_finance_factor');
    const total = dep + fin + aaa.insurance + aaa.license_registration_taxes;
    vehicle += total;
    items.push({ flow: 'vehicle', label: `${car.age === 'old' ? 'Older' : 'New'} car${n}: depreciation, finance, insurance, registration`, amount: total });
  });

  // ---- miles and fuel
  let miles = 0;
  let milesSource: Budget['milesSource'] = 'none';
  if (h.cars.length > 0) {
    if (h.vmtOverride != null && h.vmtOverride >= 0) {
      miles = h.vmtOverride;
      milesSource = 'override';
    } else {
      miles = t.vmt_per_resident_weekday * persons * A('vmt.days_per_year');
      milesSource = 'model';
    }
    miles *= h.milesFactor ?? 1;
  }
  const scaleFuel = A('vehicle.scale_fuel_to_ca_price') === 1;
  const fuelPerMile = aaa.fuel_per_mile * (scaleFuel ? p.ca_gas.avg_52wk / aaa.gas_price_basis : 1);
  const perMile = fuelPerMile + aaa.maintenance_per_mile;
  const fuel = miles * perMile;
  if (miles > 0) {
    items.push({ flow: 'fuel', label: `${Math.round(miles).toLocaleString('en-US')} miles/yr at ${(perMile * 100).toFixed(1)}¢/mi (fuel ${(fuelPerMile * 100).toFixed(1)}¢, maintenance ${(aaa.maintenance_per_mile * 100).toFixed(1)}¢)`, amount: fuel });
  }

  // ---- transit
  const zones = String(Math.min(6, Math.max(1, Math.round(h.caltrainZones))));
  const caltrain = h.caltrainPasses * p.transit.caltrain.monthly_by_zones[zones] * 12;
  const coveredByCaltrain = Number(zones) >= 2 ? h.caltrainPasses : 0;
  const samtransNeeded = Math.max(0, h.samtransPasses - coveredByCaltrain);
  const samtrans = samtransNeeded * p.transit.samtrans.monthly_adult * 12;
  if (h.caltrainPasses > 0) items.push({ flow: 'transit', label: `${h.caltrainPasses} Caltrain monthly pass${h.caltrainPasses > 1 ? 'es' : ''}, ${zones} zone${zones === '1' ? '' : 's'}`, amount: caltrain });
  if (h.samtransPasses > 0) {
    items.push({ flow: 'transit', label: `${h.samtransPasses} SamTrans monthly pass${h.samtransPasses > 1 ? 'es' : ''}`, amount: samtrans,
      note: samtransNeeded < h.samtransPasses ? 'Caltrain passes of 2+ zones include SamTrans local rides.' : undefined });
  }
  const transit = caltrain + samtrans;

  // ---- tax detail
  items.push({ flow: 'taxes', label: 'Federal income tax (after child tax credit)', amount: taxes.federalIncome });
  items.push({ flow: 'taxes', label: `California income tax (${p.taxes.ca.tax_year} schedule)`, amount: taxes.stateIncome });
  items.push({ flow: 'taxes', label: 'Social Security and Medicare', amount: taxes.socialSecurity + taxes.medicare });
  items.push({ flow: 'taxes', label: 'California SDI', amount: taxes.sdi });

  const taxTotal = Math.max(0, taxes.total);
  if (taxes.total < 0) notes.push('Refundable credits exceed taxes; shown as zero taxes.');

  const inflowTotal = h.income + curbInKind;
  const spent = taxTotal + shelter + carStorage + vehicle + fuel + transit;
  const remainder = inflowTotal - spent;

  const inflows: Flow[] = [
    { id: 'income', label: 'Gross income', amount: h.income, classification: 'input', sources: [], assumptions: [] },
  ];
  if (curbInKind > 0) {
    inflows.push({ id: 'curb_inkind', label: 'Free curb space (non-cash)', amount: curbInKind,
      classification: 'modeled', inKind: true, carRelated: true, sources: ['fhfa_land'],
      assumptions: ['parking.curb_stall_sqft', 'parking.land_yield'] });
  }
  if (remainder < 0) {
    inflows.push({ id: 'shortfall', label: 'Shortfall', amount: -remainder, classification: 'derived', sources: [], assumptions: [] });
  }
  const outflows: Flow[] = [
    { id: 'taxes', label: 'Taxes', amount: taxTotal, classification: 'modeled',
      sources: ['irs_rp_2025_32', 'irs_sch8812', 'irs_pub15_2026', 'irs_amt_qa', 'ftb_2025_schedules', 'ftb_2025_booklet', 'edd_2026_methb', 'edd_sdi_2026'], assumptions: [] },
    { id: 'shelter', label: 'Housing', amount: shelter, classification: shelterClass, sources: shelterSources, assumptions: shelterAssumptions },
    { id: 'car_storage', label: 'Car storage', amount: carStorage, classification: 'modeled', carRelated: true,
      sources: [...storageSources], assumptions: [...storageAssumptions] },
    { id: 'vehicle', label: 'Vehicle ownership', amount: vehicle, classification: h.cars.some((c) => c.age === 'old') ? 'modeled' : 'observed',
      carRelated: true, sources: ['aaa_2025'], assumptions: [...new Set(vehicleAssumptions)] },
    { id: 'fuel', label: 'Fuel and wear', amount: fuel, classification: 'modeled', carRelated: true,
      sources: ['aaa_2025', ...(scaleFuel ? ['eia_ca_gas'] : []), ...(milesSource === 'model' ? ['mtc_vmt'] : [])],
      assumptions: ['vehicle.scale_fuel_to_ca_price', ...(milesSource === 'model' ? ['vmt.days_per_year'] : [])] },
    { id: 'transit', label: 'Transit fares', amount: transit, classification: 'observed', sources: ['caltrain_fares', 'samtrans_fares'], assumptions: [] },
    { id: 'remainder', label: 'Left after taxes, housing, and transportation', amount: Math.max(0, remainder), classification: 'derived', sources: [], assumptions: [] },
  ];

  return {
    available: true,
    inflows,
    outflows,
    items,
    taxes,
    annualMiles: miles,
    milesSource,
    parkingInHousing: carveOut,
    cashCost: shelter + carveOut + storageFees + vehicle + fuel + transit,
    carCashCost: carveOut + storageFees + vehicle + fuel,
    curbInKind,
    curbRange: curbInKind > 0 ? [curbInKind, curbHigh] : null,
    notes,
  };
}

function unavailable(taxes: TaxResult, reason: string): Budget {
  return {
    available: false, unavailableReason: reason, inflows: [], outflows: [], items: [], taxes,
    annualMiles: 0, milesSource: 'none', parkingInHousing: 0, cashCost: 0, carCashCost: 0, curbInKind: 0, curbRange: null, notes: [],
  };
}

/**
 * The same household with only its first `n` cars (a what-if for tract B). Parking for dropped cars is dropped too.
 * If vmt.scale_miles_with_car_count is on, miles shrink in proportion to the number of cars.
 */
export function withCarCount(h: Household, n: number, p: Params): Household {
  const total = h.cars.length;
  if (n >= total) return h;
  const scale = assumptionValue(p.assumptions, h.overrides, 'vmt.scale_miles_with_car_count') === 1;
  return { ...h, cars: h.cars.slice(0, n), milesFactor: scale && total > 0 ? n / total : 1 };
}

export interface CategoryDiff {
  id: 'shelter' | 'car_storage' | 'vehicle' | 'fuel' | 'transit';
  label: string;
  a: number;
  b: number;
  diff: number;
}

export interface Comparison {
  diff: number;        // B cash cost minus A cash cost, $/yr
  carDiff: number;     // portion from car storage (cash), vehicles, and fuel
  inKindDiff: number;  // difference in free curb storage received
  categories: CategoryDiff[]; // cash costs by category; diffs sum to diff
}

/** Cash spent on each housing and transportation category. Car storage excludes the non-cash curb value. */
export function cashByCategory(b: Budget): Record<CategoryDiff['id'], number> {
  const f = (id: FlowId) => b.outflows.find((x) => x.id === id)?.amount ?? 0;
  return {
    shelter: f('shelter'),
    car_storage: f('car_storage') - b.curbInKind,
    vehicle: f('vehicle'),
    fuel: f('fuel'),
    transit: f('transit'),
  };
}

const CATEGORY_LABEL: Record<CategoryDiff['id'], string> = {
  shelter: 'Housing',
  car_storage: 'Parking included in rent or paid separately',
  vehicle: 'Owning the cars',
  fuel: 'Fuel and wear',
  transit: 'Transit fares',
};

export function compare(a: Budget, b: Budget): Comparison {
  const ca = cashByCategory(a), cb = cashByCategory(b);
  const categories = (Object.keys(CATEGORY_LABEL) as CategoryDiff['id'][]).map((id) => ({
    id, label: CATEGORY_LABEL[id], a: ca[id], b: cb[id], diff: cb[id] - ca[id],
  }));
  return {
    diff: b.cashCost - a.cashCost,
    carDiff: b.carCashCost - a.carCashCost,
    inKindDiff: b.curbInKind - a.curbInKind,
    categories,
  };
}
