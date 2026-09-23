// MapLibre map: tract choropleth for a selectable metric, click to choose tract A or B.

import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, MapGeoJSONFeature, MapLayerMouseEvent } from 'maplibre-gl';
import type * as GeoJSON from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre 6 loads its web worker from a separate module; bundle it and point MapLibre at the result.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

maplibregl.setWorkerUrl(workerUrl);

// OpenFreeMap: free vector basemap, no API key.
const STYLE = 'https://tiles.openfreemap.org/styles/positron';
// Sequential blue ramp (light to dark), steps 150..650 of the reference palette.
export const RAMP = ['#b7d3f6', '#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#184f95', '#104281'];

type Geo = GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, { geoid: string; v?: number | null }>;

export interface MapHandle {
  setValues(values: Record<string, number | null>, format: (v: number) => string, title: string): void;
  setSelection(a: string, b: string): void;
  focus(geoid: string): void;
}

export interface MapOptions {
  /** Heading and one-line value for a tract's popup. */
  describe: (geoid: string) => { title: string; detail: string } | null;
  /** Called when the user chooses "Set as A" or "Set as B" in a popup. */
  onSet: (letter: 'a' | 'b', geoid: string) => void;
}

function ringCentroid(ring: number[][]): [number, number, number] {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += f;
    cx += (ring[j][0] + ring[i][0]) * f;
    cy += (ring[j][1] + ring[i][1]) * f;
  }
  a /= 2;
  return a === 0 ? [ring[0][0], ring[0][1], 0] : [cx / (6 * a), cy / (6 * a), Math.abs(a)];
}

function labelPoint(g: GeoJSON.Polygon | GeoJSON.MultiPolygon): [number, number] {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  let best: [number, number, number] = [0, 0, -1];
  for (const p of polys) {
    const c = ringCentroid(p[0]);
    if (c[2] > best[2]) best = c;
  }
  return [best[0], best[1]];
}

/** Equal-width classes from the lowest to the highest value, so color steps mean equal differences. */
function breaks(values: number[], n: number): number[] {
  const lo = Math.min(...values), hi = Math.max(...values);
  return Array.from({ length: n - 1 }, (_, i) => lo + ((i + 1) * (hi - lo)) / n);
}

export function createMap(container: HTMLElement, legend: HTMLElement, geo: Geo, opts: MapOptions): MapHandle {
  const map = new maplibregl.Map({
    container,
    style: STYLE,
    bounds: [[-122.53, 37.1], [-122.08, 37.72]],
    fitBoundsOptions: { padding: 10 },
    attributionControl: { compact: true },
    cooperativeGestures: true,
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

  const points = new Map<string, [number, number]>(geo.features.map((f) => [f.properties.geoid, labelPoint(f.geometry)]));
  const markers: Record<'A' | 'B', maplibregl.Marker> = {
    A: new maplibregl.Marker({ element: markerEl('A') }),
    B: new maplibregl.Marker({ element: markerEl('B') }),
  };
  let selection: [string, string] = ['', ''];
  const popup = new maplibregl.Popup({ closeButton: true, maxWidth: '280px' });
  let pending: (() => void) | null = null;
  let ready = false;

  map.on('load', () => {
    map.addSource('tracts', { type: 'geojson', data: geo });
    map.addLayer({
      id: 'tract-fill', type: 'fill', source: 'tracts',
      paint: { 'fill-color': ['coalesce', ['get', 'c'], '#e1e0d9'], 'fill-opacity': 0.72 },
    });
    map.addLayer({ id: 'tract-line', type: 'line', source: 'tracts', paint: { 'line-color': '#ffffff', 'line-width': 0.6 } });
    map.addLayer({
      id: 'tract-selected', type: 'line', source: 'tracts',
      paint: { 'line-color': '#111b17', 'line-width': 2.5 },
      filter: ['in', ['get', 'geoid'], ['literal', []]],
    });
    map.on('click', 'tract-fill', (e: MapLayerMouseEvent) => {
      const f = e.features?.[0] as MapGeoJSONFeature | undefined;
      if (!f) return;
      const geoid = String(f.properties.geoid);
      const d = opts.describe(geoid);
      if (!d) return;
      popup.setLngLat(e.lngLat).setDOMContent(popupContent(geoid, d)).addTo(map);
    });
    map.on('mouseenter', 'tract-fill', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'tract-fill', () => (map.getCanvas().style.cursor = ''));
    ready = true;
    pending?.();
    applySelection();
  });

  function popupContent(geoid: string, d: { title: string; detail: string }) {
    const box = document.createElement('div');
    box.className = 'map-popup';
    const h = document.createElement('strong');
    h.textContent = d.title;
    const p = document.createElement('div');
    p.textContent = d.detail;
    const row = document.createElement('div');
    row.className = 'map-popup-actions';
    for (const letter of ['a', 'b'] as const) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'button-secondary';
      btn.textContent = `Set as ${letter.toUpperCase()}`;
      btn.disabled = selection[letter === 'a' ? 0 : 1] === geoid; // already there; the other button swaps
      btn.addEventListener('click', () => { popup.remove(); opts.onSet(letter, geoid); });
      row.append(btn);
    }
    box.append(h, p, row);
    return box;
  }

  function markerEl(letter: string) {
    const d = document.createElement('div');
    d.className = `map-marker map-marker-${letter.toLowerCase()}`;
    d.textContent = letter;
    d.setAttribute('aria-hidden', 'true');
    return d;
  }

  function applySelection() {
    if (!ready) return;
    map.setFilter('tract-selected', ['in', ['get', 'geoid'], ['literal', selection.filter(Boolean)]]);
    (['A', 'B'] as const).forEach((k, i) => {
      const p = points.get(selection[i]);
      if (p) markers[k].setLngLat(p).addTo(map);
      else markers[k].remove();
    });
  }

  return {
    setValues(values, format, title) {
      const nums = Object.values(values).filter((v): v is number => v != null && Number.isFinite(v));
      const br = nums.length ? breaks(nums, RAMP.length) : [];
      const classOf = (v: number) => { let i = 0; while (i < br.length && v >= br[i]) i++; return i; };
      for (const f of geo.features) {
        const v = values[f.properties.geoid];
        f.properties.v = v ?? null;
        (f.properties as Record<string, unknown>).c = v == null ? null : RAMP[classOf(v)];
      }
      const apply = () => (map.getSource('tracts') as GeoJSONSource).setData(geo);
      if (ready) apply(); else pending = apply;

      legend.replaceChildren();
      const h = document.createElement('div');
      h.className = 'legend-title';
      h.textContent = title;
      legend.append(h);
      if (!nums.length) return;
      const min = Math.min(...nums), max = Math.max(...nums);
      const edges = [min, ...br, max];
      const row = document.createElement('div');
      row.className = 'legend-row';
      RAMP.forEach((c, i) => {
        const cell = document.createElement('div');
        cell.className = 'legend-cell';
        const sw = document.createElement('span');
        sw.className = 'legend-swatch';
        sw.style.background = c;
        const lab = document.createElement('span');
        lab.className = 'legend-label';
        lab.textContent = i === 0 ? format(edges[0]) : i === RAMP.length - 1 ? `${format(edges[i])}+` : format(edges[i]);
        cell.append(sw, lab);
        row.append(cell);
      });
      legend.append(row);
      const note = document.createElement('div');
      note.className = 'legend-note';
      note.textContent = 'Shades are equal steps from the lowest to the highest tract. Gray: not available. Select a tract to compare it.';
      legend.append(note);
    },
    setSelection(a, b) {
      selection = [a, b];
      applySelection();
    },
    focus(geoid) {
      const pt = points.get(geoid);
      if (pt) map.flyTo({ center: pt, zoom: Math.max(map.getZoom(), 12) });
    },
  };
}
