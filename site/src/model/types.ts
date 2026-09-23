// Shapes of the data files emitted by the pipeline (site/public/data) and of the household.

export type Classification = 'observed' | 'modeled' | 'assumption';
export type Bedrooms = '0' | '1' | '2' | '3' | '4';
export type FilingStatus = 'single' | 'hoh' | 'mfj';

export interface Share { share: number | null; moe: number | null }

export interface Tract {
  name: string;
  city: string;
  label: string | null;      // e.g. "Linda Mar, Pacifica" or "San Mateo, near San Mateo Caltrain"
  neighborhoods: string[];
  stations: string[];
  county: string;
  housing_units_2020: number;
  population_2020: number;
  zips: Record<string, number>;
  safmr: Record<Bedrooms, number>;
  rent_zillow: Record<Bedrooms, number> | null;
  zori: number | null;
  zori_coverage: number;
  zhvi: Record<Bedrooms, number | null>;
  zhvi_series: Record<Bedrooms, string>;
  land_per_acre: number;
  land_per_sqft: number;
  land_method: string;
  vmt_per_resident_weekday: number;
  acs: {
    median_hh_income?: number | null;
    median_hh_income_moe?: number | null;
    households?: number;
    vehicles?: Record<'0' | '1' | '2' | '3+', Share>;
    workers?: number;
    commute?: Record<string, Share>;
  };
  flags: string[];
}

export interface Assumption<T = number | boolean> {
  value: T; unit: string; classification: Classification; note: string; source?: string; label?: string;
}
export type Assumptions = Record<string, Record<string, Assumption>>;

type Brackets = Record<FilingStatus, [number, number][]>;
export interface TaxTables {
  federal: {
    standard_deduction: Record<FilingStatus, number>;
    brackets: Brackets;
    ctc_per_child: number;
    ctc_refundable_max: number;
    ctc_phaseout_start: Record<FilingStatus, number>;
    ctc_phaseout_rate: number;
    actc_earned_income_floor: number;
    actc_rate: number;
  };
  fica: {
    ss_rate: number; ss_wage_base: number; medicare_rate: number;
    addl_medicare_rate: number; addl_medicare_threshold: Record<FilingStatus, number>;
  };
  ca: {
    tax_year: number;
    standard_deduction: Record<FilingStatus, number>;
    brackets: Brackets;
    personal_credit: number; dependent_credit: number;
    personal_credit_count: Record<FilingStatus, number>;
    credit_phaseout_start: Record<FilingStatus, number>;
    credit_phaseout_per_2500: number;
    bhst_threshold: number; bhst_rate: number;
    sdi_rate: number; sdi_year: number;
  };
}

export interface Params {
  aaa: {
    depreciation: number; finance: number; insurance: number; license_registration_taxes: number;
    fuel_per_mile: number; maintenance_per_mile: number; gas_price_basis: number; total_at_15k: number;
  };
  ca_gas: { avg_52wk: number; latest: number; from: string; to: string };
  pmms: { rate_30yr: number; week_of: string };
  transit: {
    caltrain: { monthly_by_zones: Record<string, number>; samtrans_note: string };
    samtrans: { monthly_adult: number; single_clipper: number };
  };
  taxes: TaxTables;
  assumptions: Assumptions;
  meta: {
    counties: Record<string, string>;
    housing: { zori_month: string; zhvi_month: string; safmr_fy: number };
    land: { year: number; methods: Record<string, number>; county_per_sqft: Record<string, number> };
    built: string;
  };
}

export interface SourceInfo {
  title: string; url: string; landing?: string; vintage: string; classification: Classification;
  notes: string; retrieved: string;
}

// ---------------------------------------------------------------- household

export type ParkRegime = 'bundled' | 'unbundled' | 'owned' | 'street';
export type CarAge = 'new' | 'old';
export type BundledMethod = 'study' | 'construction';
export type RentSource = 'zillow' | 'hud';

export interface Car { age: CarAge; park: ParkRegime }

export interface Household {
  income: number;
  adults: number;          // 1 or 2; 2 adults file jointly
  children: number;
  workers: number;         // earners among the adults; income is split evenly across them
  tenure: 'rent' | 'own';
  rentSource: RentSource;  // Zillow (default) or HUD Small Area FMR; Zillow falls back to HUD where it has no data
  bedrooms: Bedrooms;
  cars: Car[];
  spareSpaces: number;     // parking that comes with the home but no car uses (bundled for renters, garage for owners)
  caltrainPasses: number;
  caltrainZones: number;
  samtransPasses: number;
  vmtOverride: number | null;          // annual household miles
  unbundledMonthly: number | null;     // monthly fee per unbundled space
  privateParkingMonthly: number | null; // nearby private parking rent, for the curb cross-check
  bundledMethod: BundledMethod;
  showCurbValue: boolean;              // show free street parking as non-cash value (inflow and car storage)
  overrides: Record<string, number>;   // "group.key" -> value, overriding assumptions.json
  milesFactor?: number;                // set by withCarCount for what-if car counts; not stored in the URL
}
