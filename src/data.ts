// Typed access to the processed OSM data plus statistics derived from it.
// Every number shown in the UI should come from here (or a cited source).
import metaJ from './data/meta.json';
import buildingsJ from './data/buildings.json';
import linesJ from './data/lines.json';
import areasJ from './data/areas.json';
import stationsJ from './data/stations.json';
import routesJ from './data/routes.json';
import namedJ from './data/named-outlines.json';
import landmarksJ from './data/landmarks.json';

export type XY = [number, number];
export type Zone = 'eco' | 'gardens' | 'midvalley';
export const ZONES: Zone[] = ['eco', 'gardens', 'midvalley'];
export type HeightSource = 'osm' | 'levels' | 'estimate' | 'cited';
export interface HeightRef { value: number; unit: 'm' | 'floors'; floors: number | null; storeyHeight: number | null; publisher: string; url: string; fetched: string; note?: string; ctbuhEstimated: boolean }

export interface Building {
  id: string; name: string | null; type: string; part: boolean; parent: string | null;
  height: number; minHeight: number; levels: number | null; heightSource: HeightSource; heightNote?: string; heightRef?: HeightRef;
  precinct: string | null; zone: Zone | null; landmark?: 'mosque'; podium?: string; podiumFor?: string; podiumName?: string; podiumNameSource?: string; station: string | null; area: number; c: XY; ring: XY[];
}
export interface Road { id: number; cls: string; name: string | null; w: number; bridge: boolean; tunnel: boolean; layer: number; pts: XY[] }
/** route: KTM Komuter line of a KTM track (1 = Batu Caves–Pulau Sebang, 2 = Tanjung Malim–Port Klang), from OSM route relations; null otherwise. */
export interface Rail { id: number; line: 'lrt' | 'ktm' | 'erl' | 'other'; route?: 1 | 2 | null; routeInferred?: boolean; name: string | null; elevated: boolean; tunnel: boolean; layer: number; service: string | null; pts: XY[] }
export type Shelter = 'indoor' | 'covered-tag' | 'in-building' | 'open';
export interface Footway { id: number; kind: string; bridge: boolean; covered: boolean; indoor: boolean; layer: number; sheltered: boolean; shelter: Shelter; pts: XY[] }
export interface WaterLine { id: number; kind: string; name: string | null; width: number | null; pts: XY[] }
export interface Area { id: string; name: string | null; ring: XY[]; landuse?: string }
export interface Station { id: string; ref: string | null; name: string; osmName: string; operator: string | null; layer: number; c: XY }
export type Share = 'bridge' | 'indoor' | 'covered' | 'open';
export interface RouteSegment { cls: string; layer: number; road: string | null; sheltered: boolean; shelter: Shelter; share: Share; length: number; osmWays: number[]; pts: XY[] }
export interface Route {
  id: string; from: string; to: string; fromLabel: string; toLabel: string; snapFrom: number; snapTo: number;
  length: number; minutes: number; byClass: Record<string, number>; byShare: Partial<Record<Share, number>>; shelteredM: number; shelteredPct: number; straightLine: number;
  withinEcoCityM: number; withinMidValleyCityM: number; overWaterM: number; segments: RouteSegment[]; error?: string;
}
export interface NamedOutline {
  id: string; name: string; type: string; c: XY; area: number; renderedAsParts: boolean;
  ownHeight: number | null; ownHeightSource: HeightSource | 'none'; heightRef?: HeightRef; levels: number | null;
  tallestPart: { id: string; name: string | null; height: number; heightSource: HeightSource; levels: number | null } | null;
  ring: XY[];
}

export interface Landmark {
  id: string; kind: 'mosque'; name: string; nameEn: string | null; altName: string | null; religion: string | null;
  c: XY; lat: number; lon: number; inStudyArea: boolean; buildingId: string | null;
  /** absolute top (m) and base elevation (m) above ground: a landmark on a podium starts at the podium roof */
  height: number; base: number; heightSource: HeightSource;
  podium: { id: string; name: string; nameSource: string; levels: number | null; storeyM: number | null; roof: number } | null;
  polygons: { outer: XY[]; holes: XY[][] }[];
}
export const landmarks = landmarksJ as unknown as Landmark[];
export const meta = metaJ;
export const buildings = buildingsJ as unknown as Building[];
export const lines = linesJ as unknown as { roads: Road[]; rails: Rail[]; footways: Footway[]; waterLines: WaterLine[] };
export const areas = areasJ as unknown as { waterAreas: Area[]; green: Area[]; precincts: Area[] };
const RJ = routesJ as unknown as { routes: Route[]; walks: Route[]; anchors: Record<string, { label: string; pt: XY }> };
export const routes = RJ.routes.filter((r) => !r.error);
export const walks = RJ.walks.filter((r) => !r.error);
export const anchors = RJ.anchors;
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
const citedSorted = buildings.filter((b) => b.heightSource === 'cited' && b.name).sort((a, b) => b.height - a.height);
const citedTallest = citedSorted.filter((b) => b.height === citedSorted[0]?.height);
const lenOf = (pts: XY[]) => pts.reduce((s, p, i) => (i ? s + dist(p, pts[i - 1]) : 0), 0);
const shelteredFootM = lines.footways.filter((f) => f.sheltered).reduce((s, f) => s + lenOf(f.pts), 0);
const allFootM = lines.footways.reduce((s, f) => s + lenOf(f.pts), 0);
const totalRoute = routes.reduce((s, r) => s + r.length, 0);
const classTotals: Record<string, number> = {};
for (const r of routes) for (const [k, v] of Object.entries(r.byClass)) classTotals[k] = (classTotals[k] || 0) + v;
const bridgeM = (classTotals['bridge'] || 0) + (classTotals['bridge-enclosed'] || 0);
const kj17 = station('KJ17'); const kb01 = station('KB01');

export const stats = {
  buildingCount: buildings.length,
  heightOsm: bySource('osm'), heightLevels: bySource('levels'), heightEstimate: bySource('estimate'), heightCited: bySource('cited'),
  citedNamed: new Set([...citedSorted.map((b) => b.name), ...namedOutlines.filter((o) => o.ownHeightSource === 'cited').map((o) => o.name)]).size,
  osmTallest, citedTallest,
  footwayM: Math.round(allFootM), shelteredFootM: Math.round(shelteredFootM), shelteredFootPct: allFootM ? Math.round((shelteredFootM / allFootM) * 100) : 0,
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

