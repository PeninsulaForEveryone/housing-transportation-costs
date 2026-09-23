import type { Household } from './model/types';

const base: Omit<Household, 'income' | 'adults' | 'children' | 'workers' | 'tenure' | 'bedrooms' | 'cars'> = {
  rentSource: 'zillow',
  spareSpaces: 0,
  caltrainPasses: 0,
  caltrainZones: 2,
  samtransPasses: 0,
  vmtOverride: null,
  unbundledMonthly: null,
  privateParkingMonthly: null,
  bundledMethod: 'study',
  showCurbValue: true,
  overrides: {},
};

export interface HouseholdPreset { id: string; label: string; household: Household }

export const HOUSEHOLD_PRESETS: HouseholdPreset[] = [
  {
    id: 'twocar',
    label: 'Family of four with two cars, renting a 3-bedroom',
    household: {
      ...base, income: 220000, adults: 2, children: 2, workers: 2, tenure: 'rent', bedrooms: '3',
      cars: [{ age: 'new', park: 'bundled' }, { age: 'old', park: 'street' }],
    },
  },
  {
    id: 'onecar',
    label: 'Single renter, one older car parked on the street',
    household: {
      ...base, income: 95000, adults: 1, children: 0, workers: 1, tenure: 'rent', bedrooms: '1',
      cars: [{ age: 'old', park: 'street' }],
    },
  },
  {
    id: 'carfree',
    label: 'Couple with an infant, no car, one Caltrain commuter',
    household: {
      ...base, income: 150000, adults: 2, children: 1, workers: 2, tenure: 'rent', bedrooms: '2',
      cars: [], spareSpaces: 1, caltrainPasses: 1, caltrainZones: 2, samtransPasses: 1,
    },
  },
];

/** bCars: cars the household keeps in B (the what-if), when the example is about owning fewer. */
export interface TractPair { id: string; label: string; a: string; b: string; bCars?: number }

export const TRACT_PAIRS: TractPair[] = [
  // Same rent market (ZIP 94402), so the gap is driving and the second car, not rent.
  // ACS: 81% of Highlands households have 2+ cars vs. 41% downtown.
  { id: 'highlands-sm', label: 'Highlands, 2 cars vs. downtown San Mateo, 1 car', a: '06081606900', b: '06081606300', bCars: 1 },
  { id: 'mb-pac', label: 'Millbrae near BART/Caltrain vs. Pacifica', a: '06081604400', b: '06081603300' },
];

/** Contrasting tracts for the build-time sanity table. */
export const SANITY_TRACTS: [string, string][] = [
  ['06081606300', 'Downtown San Mateo, near Caltrain'],
  ['06081606900', 'San Mateo Highlands'],
  ['06081613702', 'Half Moon Bay'],
  ['06081605600', 'Hillsborough'],
  ['06081612002', 'East Palo Alto'],
  ['06081600701', 'Daly City, near BART'],
  ['06081603300', 'Pacifica (Linda Mar)'],
];
