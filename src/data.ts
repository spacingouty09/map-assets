// Typed access to the processed OSM data plus statistics derived from it.
// Every number shown in the UI should come from here (or a cited source).
import metaJ from './data/meta.json';
import buildingsJ from './data/buildings.json';
import linesJ from './data/lines.json';
import areasJ from './data/areas.json';
import stationsJ from './data/stations.json';
import routesJ from './data/routes.json';
import namedJ from './data/named-outlines.json';

export type XY = [number, number];
export type HeightSource = 'osm' | 'levels' | 'estimate';

export interface Building {
  id: string; name: string | null; type: string; part: boolean; parent: string | null;
  height: number; minHeight: number; levels: number | null; heightSource: HeightSource; heightNote?: string;
  precinct: string | null; station: string | null; area: number; c: XY; ring: XY[];
}
export interface Road { id: number; cls: string; name: string | null; w: number; bridge: boolean; tunnel: boolean; layer: number; pts: XY[] }
export interface Rail { id: number; line: 'lrt' | 'ktm' | 'erl' | 'other'; name: string | null; elevated: boolean; tunnel: boolean; layer: number; service: string | null; pts: XY[] }
export interface Footway { id: number; kind: string; bridge: boolean; covered: boolean; indoor: boolean; layer: number; pts: XY[] }
export interface WaterLine { id: number; kind: string; name: string | null; width: number | null; pts: XY[] }
export interface Area { id: string; name: string | null; ring: XY[]; landuse?: string }
export interface Station { id: string; ref: string | null; name: string; osmName: string; operator: string | null; layer: number; c: XY }
export interface RouteSegment { cls: string; layer: number; road: string | null; length: number; osmWays: number[]; pts: XY[] }
export interface Route {
  from: string; to: string; fromLabel: string; toLabel: string; snapFrom: number; snapTo: number;
  length: number; minutes: number; byClass: Record<string, number>; straightLine: number;
  withinEcoCityM: number; withinMidValleyCityM: number; overWaterM: number; segments: RouteSegment[]; error?: string;
}
export interface NamedOutline {
  id: string; name: string; type: string; c: XY; area: number; renderedAsParts: boolean;
  ownHeight: number | null; ownHeightSource: HeightSource | 'none'; levels: number | null;
  tallestPart: { id: string; name: string | null; height: number; heightSource: HeightSource; levels: number | null } | null;
  ring: XY[];
}

export const meta = metaJ;
export const buildings = buildingsJ as unknown as Building[];
export const lines = linesJ as unknown as { roads: Road[]; rails: Rail[]; footways: Footway[]; waterLines: WaterLine[] };
export const areas = areasJ as unknown as { waterAreas: Area[]; green: Area[]; precincts: Area[] };
export const routes = (routesJ as unknown as { routes: Route[] }).routes.filter((r) => !r.error);
export const namedOutlines = namedJ as unknown as NamedOutline[];
export const stations = (stationsJ as unknown as Station[]).map((s) => ({
  ...s,
  ref: s.ref ?? (s.osmName.match(/^(K[A-Z]\d+)/)?.[1] || null),
  name: s.name || s.osmName,
}));

// ---------- lookups ----------
export function findPlace(name: string): { name: string; c: XY; height: number; heightSource: HeightSource | 'none'; levels: number | null; building?: Building } | null {
  const b = buildings.find((x) => x.name === name);
  if (b) return { name, c: b.c, height: b.height, heightSource: b.heightSource, levels: b.levels, building: b };
  const o = namedOutlines.find((x) => x.name === name);
  if (o) {
    const h = o.ownHeight ?? o.tallestPart?.height ?? 10;
    return { name, c: o.c, height: h, heightSource: o.ownHeight != null ? (o.ownHeightSource as HeightSource) : 'none', levels: o.levels };
  }
  return null;
}
export const station = (ref: string) => stations.find((s) => s.ref === ref) || null;

// ---------- derived stats ----------
const dist = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const bySource = (s: HeightSource) => buildings.filter((b) => b.heightSource === s).length;
const osmTallest = buildings.filter((b) => b.heightSource === 'osm').sort((a, b) => b.height - a.height)[0];
const totalRoute = routes.reduce((s, r) => s + r.length, 0);
const classTotals: Record<string, number> = {};
for (const r of routes) for (const [k, v] of Object.entries(r.byClass)) classTotals[k] = (classTotals[k] || 0) + v;
const bridgeM = (classTotals['bridge'] || 0) + (classTotals['bridge-enclosed'] || 0);
const kj17 = station('KJ17'); const kb01 = station('KB01');

export const stats = {
  buildingCount: buildings.length,
  heightOsm: bySource('osm'), heightLevels: bySource('levels'), heightEstimate: bySource('estimate'),
  osmTallest,
  routeTotalM: totalRoute,
  routeMinutes: totalRoute / meta.walkSpeedMPerMin,
  routeBridgeM: Math.round(bridgeM),
  routeBridgeShare: totalRoute ? Math.round((bridgeM / totalRoute) * 100) : 0,
  routeIndoorM: Math.round(classTotals['indoor'] || 0),
  classTotals,
  straightKJ17toKB01: kj17 && kb01 ? Math.round(dist(kj17.c, kb01.c)) : null,
  stationCount: stations.length,
  railCorridors: new Set(lines.rails.map((r) => r.line).filter((l) => l !== 'other')).size,
  fetchedDate: (meta.fetchedAt || '').slice(0, 10),
};

export const fmt = (n: number, d = 0) => n.toLocaleString('en-GB', { maximumFractionDigits: d, minimumFractionDigits: d });
export const heightLabel = (h: number, src: HeightSource | 'none', levels: number | null) =>
  src === 'osm' ? `${fmt(h)} m · OSM height` : src === 'levels' ? `≈${fmt(h)} m · ${levels} lv × 3.5` : src === 'estimate' ? `~${fmt(h)} m · estimate` : '';
