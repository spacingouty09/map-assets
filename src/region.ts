// A region (now Kuala Lumpur; the raw fetch covers the Klang Valley): the rail network that joins the signature spots (KTM Komuter, LRT, MRT, KL Monorail, ERL),
// its stations and a light base map, in one local metric frame. Built by pipeline/process-region.mjs from
// regions/<id>/raw/overpass.json and regions/<id>/rules.json. DOM-free, like the rest of src/.
//   const region = await loadRegion()            -> lines, stations, base map
//   region.areaOffset(info)                      -> where an area's local frame sits in the region frame
//   findJourney(region, ['KJ17'], ['KJ10'])      -> the fewest-stops rail journey between two sets of stations
//   findJourneys(region, ['KJ15'], ['KJ10'])     -> every sensible option, best first
//   await loadRegionBasemap()                    -> the flat street map, water, green and place names (load after)
import type { AreaInfo, XY } from './data';

/** Kind of rail line (drawing order and default width). */
export type RegionLineKind = 'ktm' | 'erl' | 'lrt' | 'mrt' | 'monorail';
/** One rail line, as one path along the track (inside the region box), with its stations in order along it. */
export interface RegionLine {
  /** stable id from rules.json, e.g. 'kj' (LRT Kelana Jaya Line) */
  id: string;
  /** public line number (Rapid KL / KTM / ERL map), e.g. 5; null when the line has none */
  number: number | null;
  /** station code prefix(es) shown to riders, e.g. 'KJ' */
  code: string;
  name: string; kind: RegionLineKind;
  /** OSM colour tag of the route (falls back to rules.json) */
  color: string;
  /** the track, x east / y north (m) */
  path: XY[];
  /** cumulative length (m) along path at each vertex */
  cum: number[];
  lengthM: number;
  /** stations in order along the path: station id and position along the path (m) */
  stops: { station: string; at: number }[];
  /** OSM route relation the line was built from */
  osmRelation: number;
}
export interface RegionStation {
  /** OSM element id of the station, e.g. 'node/123' */
  id: string;
  name: string;
  /** Simplified Chinese name (OSM name:zh-Hans or name:zh), when mapped */
  nameZh?: string;
  /** public station codes (OSM ref, split on ';'), e.g. ['KJ15', 'KA01'] */
  refs: string[];
  c: XY;
  /** ids of the lines that stop here */
  lines: string[];
}
/** A walking change between two stations of different lines (rules.json pairs, or stations closer than rules.transferM). */
export interface RegionTransfer { a: string; b: string; m: number }
export interface RegionBase {
  roads: { cls: 'motorway' | 'trunk'; pts: XY[] }[];
  rivers: { name: string | null; pts: XY[] }[];
  /** Federal Territory boundaries (Kuala Lumpur, Putrajaya) */
  boundaries: { name: string; rings: XY[][] }[];
}
export interface RegionMeta {
  id: string; name: string; summary: string;
  /** origin of the local frame (the middle of bbox) */
  center: { lat: number; lon: number };
  bbox: { south: number; west: number; north: number; east: number };
  /** half width / half height of the box (m) */
  halfSizeM: [number, number];
  source: string; attribution: string; fetchedAt: string | null;
}
export interface RawRegion { meta: RegionMeta; lines: RegionLine[]; stations: RegionStation[]; transfers: RegionTransfer[]; base: RegionBase }

export interface Region extends RawRegion {
  station(id: string): RegionStation | null;
  /** the station with a public code, e.g. 'KJ17' */
  stationByRef(ref: string): RegionStation | null;
  line(id: string): RegionLine | null;
  /** local x / y (m) of a point given in degrees */
  project(lat: number, lon: number): XY;
  /** an area's centre in the region frame (its own local frame is centred there and also north-up) */
  areaOffset(info: Pick<AreaInfo, 'center'>): XY;
  /** the track between two stops of a line (in either order), from the first to the second */
  between(lineId: string, fromStation: string, toStation: string): XY[];
  /** totals for text: lines, stations, track length in the box */
  stats: { lines: number; stations: number; interchanges: number; trackKm: number };
}

const R = 6378137, K = Math.PI / 180;
export function buildRegion(raw: RawRegion): Region {
  const { center } = raw.meta;
  const project = (lat: number, lon: number): XY => [(lon - center.lon) * K * R * Math.cos(center.lat * K), (lat - center.lat) * K * R];
  const byId = new Map(raw.stations.map((s) => [s.id, s]));
  const byRef = new Map(raw.stations.flatMap((s) => s.refs.map((r) => [r, s] as const)));
  const lineById = new Map(raw.lines.map((l) => [l.id, l]));
  const between = (lineId: string, a: string, b: string): XY[] => {
    const l = lineById.get(lineId); if (!l) return [];
    const sa = l.stops.find((s) => s.station === a), sb = l.stops.find((s) => s.station === b); if (!sa || !sb) return [];
    const out = slice(l, Math.min(sa.at, sb.at), Math.max(sa.at, sb.at));
    return sa.at <= sb.at ? out : out.reverse();
  };
  return {
    ...raw, project,
    station: (id) => byId.get(id) ?? null,
    stationByRef: (ref) => byRef.get(ref) ?? null,
    line: (id) => lineById.get(id) ?? null,
    areaOffset: (info) => project(info.center.lat, info.center.lon),
    between,
    stats: {
      lines: raw.lines.length, stations: raw.stations.length,
      interchanges: raw.stations.filter((s) => s.lines.length > 1).length + raw.transfers.length,
      trackKm: Math.round(raw.lines.reduce((s, l) => s + l.lengthM, 0) / 100) / 10,
    },
  };
}

/** The part of a line's path between two positions along it (m). */
export function slice(l: Pick<RegionLine, 'path' | 'cum'>, a: number, b: number): XY[] {
  const at = (d: number): XY => {
    let i = l.cum.findIndex((c) => c >= d); if (i <= 0) return l.path[Math.max(0, i)] ?? l.path[l.path.length - 1];
    const t = (d - l.cum[i - 1]) / Math.max(1e-9, l.cum[i] - l.cum[i - 1]); const p = l.path[i - 1], q = l.path[i];
    return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  };
  const out: XY[] = [at(a)];
  for (let i = 0; i < l.path.length; i++) if (l.cum[i] > a && l.cum[i] < b) out.push(l.path[i]);
  out.push(at(b));
  return out;
}

// ---------- journeys ----------
/** One ride: a line from one station to another, with every stop on the way. */
export interface JourneyLeg {
  line: string; from: string; to: string; stops: string[]; lengthM: number; pts: XY[];
  /** other lines that make the same ride, stop for stop (e.g. the Ampang and Sri Petaling Lines, Hang Tuah → Chan Sow Lin) */
  also?: string[];
}
export interface Journey {
  from: string; to: string;
  /** rides and the walking changes between them, in order */
  steps: ({ kind: 'ride' } & JourneyLeg | { kind: 'walk'; from: string; to: string; m: number })[];
  /** stations passed or stopped at after boarding (the stop count riders see), changes and rail distance */
  stops: number; changes: number; railM: number; walkM: number;
}
/** Cost of a change of line, in stops: a change is worth this many extra stops (plus 1 per 100 m walked). */
const CHANGE_COST = 4;
/** Tie-break per metre of track (0.01 stop per km): never outweighs a stop inside the region box. */
const TIE_PER_M = 1e-5;

type Ride = Extract<Journey['steps'][number], { kind: 'ride' }>;
/** The rail graph: node = station + line ('' = on foot at the station, before boarding / after alighting). Built once
 *  per region; each edge carries the line it belongs to ('' for a walking change) so a search can be limited to some lines. */
interface Graph { edges: Map<string, { to: string; cost: number; line: string }[]> }
const graphs = new WeakMap<RawRegion, Graph>();
function graphOf(region: Region): Graph {
  let g = graphs.get(region); if (g) return g;
  const edges: Graph['edges'] = new Map();
  const add = (a: string, b: string, cost: number, line: string) => { let e = edges.get(a); if (!e) edges.set(a, (e = [])); e.push({ to: b, cost, line }); };
  for (const l of region.lines) {
    for (let i = 0; i < l.stops.length; i++) {
      const s = l.stops[i].station; add(`${s}|`, `${s}|${l.id}`, CHANGE_COST / 2, l.id); add(`${s}|${l.id}`, `${s}|`, CHANGE_COST / 2, l.id);
      // a stop costs 1, plus a tie-break of 0.01 per km of track, so equal-stop journeys take the shorter way in both directions
      if (i > 0) { const p = l.stops[i - 1].station; const c = 1 + (l.stops[i].at - l.stops[i - 1].at) * TIE_PER_M; add(`${p}|${l.id}`, `${s}|${l.id}`, c, l.id); add(`${s}|${l.id}`, `${p}|${l.id}`, c, l.id); }
    }
  }
  for (const t of region.transfers) { add(`${t.a}|`, `${t.b}|`, t.m / 100, ''); add(`${t.b}|`, `${t.a}|`, t.m / 100, ''); }
  graphs.set(region, (g = { edges })); return g;
}
const stationIds = (region: Region, xs: string[]) => [...new Set(xs.map((x) => region.station(x)?.id ?? region.stationByRef(x)?.id).filter((x): x is string => !!x))];

/** The cheapest journey from any of `src` to any of `dst` (station ids), riding only `lines` when given. */
function search(region: Region, src: string[], dst: Set<string>, lines: Set<string> | null): { journey: Journey; cost: number } | null {
  const { edges } = graphOf(region);
  // Dijkstra (a few hundred nodes; a linear scan is fine)
  const dist = new Map<string, number>(); const prev = new Map<string, string>(); const open = new Set<string>();
  for (const s of src) { dist.set(`${s}|`, 0); open.add(`${s}|`); }
  let end: string | null = null; let cost = 0;
  while (open.size) {
    let u = ''; let best = Infinity;
    for (const n of open) { const d = dist.get(n)!; if (d < best) { best = d; u = n; } }
    open.delete(u);
    const [st, ln] = u.split('|'); if (ln === '' && dst.has(st)) { end = u; cost = best; break; }
    for (const e of edges.get(u) ?? []) {
      if (lines && e.line && !lines.has(e.line)) continue;
      const d = best + e.cost; if (d < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, d); prev.set(e.to, u); open.add(e.to); }
    }
  }
  if (!end) return null;
  const chain: string[] = [end]; while (prev.has(chain[0])) chain.unshift(prev.get(chain[0])!);
  // fold the node chain into rides and walks
  const steps: Journey['steps'] = []; let ride: { line: string; stops: string[] } | null = null;
  const close = () => {
    if (!ride || ride.stops.length < 2) { ride = null; return; }
    const pts = region.between(ride.line, ride.stops[0], ride.stops[ride.stops.length - 1]);
    const lengthM = pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
    steps.push({ kind: 'ride', line: ride.line, from: ride.stops[0], to: ride.stops[ride.stops.length - 1], stops: ride.stops, lengthM: Math.round(lengthM), pts });
    ride = null;
  };
  for (let i = 1; i < chain.length; i++) {
    const [s0, l0] = chain[i - 1].split('|'); const [s1, l1] = chain[i].split('|');
    if (l0 && l1 && l0 === l1) { ride ??= { line: l1, stops: [s0] }; ride.stops.push(s1); }
    else if (!l0 && !l1 && s0 !== s1) { close(); const t = region.transfers.find((x) => (x.a === s0 && x.b === s1) || (x.a === s1 && x.b === s0)); steps.push({ kind: 'walk', from: s0, to: s1, m: t?.m ?? 0 }); }
    else if (!l1) close();
  }
  close();
  const rides = steps.filter((s): s is Ride => s.kind === 'ride');
  return {
    cost,
    journey: {
      from: chain[0].split('|')[0], to: end.split('|')[0], steps,
      stops: rides.reduce((s, r) => s + r.stops.length - 1, 0), changes: Math.max(0, rides.length - 1),
      railM: rides.reduce((s, r) => s + r.lengthM, 0),
      walkM: steps.reduce((s, x) => s + (x.kind === 'walk' ? x.m : 0), 0),
    },
  };
}

/** The rail journey with the fewest stops (a change counts as CHANGE_COST stops) from any station in `from` to any in
 *  `to`, given as station ids or public codes. Null when they are not connected. */
export function findJourney(region: Region, from: string[], to: string[]): Journey | null {
  const src = stationIds(region, from), dst = new Set(stationIds(region, to)); if (!src.length || !dst.size) return null;
  return search(region, src, dst, null)?.journey ?? null;
}

export interface JourneyOptions {
  /** at most this many options (default 5) */
  max?: number;
  /** at most this many changes of line (default 2) */
  maxChanges?: number;
  /** leave out options that cost more than best × slack + extra, in stops (default 1.5 and 8) */
  slack?: number; extra?: number;
  /** leave out options with more track than the best one's × detour + 3 km (default 2) */
  detour?: number;
}
/** Every sensible rail journey between two sets of stations, best first (the first is findJourney's). One option per
 *  way through the network: for each set of up to maxChanges + 1 lines, the best journey riding only those lines. So an
 *  option that adds a line to a better one without gaining anything (KL Sentral → Masjid Jamek on the monorail, then
 *  the Kelana Jaya Line, when the Kelana Jaya Line stops at KL Sentral) never shows. Then:
 *  - lines that make the same ride stop for stop are one option (the leg lists the others in `also`);
 *  - of two options that differ only in their first (or last) ride, e.g. boarding KTM at Mid Valley or at Abdullah
 *    Hukum for the same change at KL Sentral, the better one stays;
 *  - options far costlier than the best (slack, extra) or with far more track (detour) are left out. */
export function findJourneys(region: Region, from: string[], to: string[], opts: JourneyOptions = {}): Journey[] {
  const { max = 5, maxChanges = 2, slack = 1.5, extra = 8, detour = 2 } = opts;
  const src = stationIds(region, from), dst = new Set(stationIds(region, to)); if (!src.length || !dst.size) return [];
  const best = search(region, src, dst, null); if (!best) return [];
  const stepKey = (s: Journey['steps'][number], loose = false) => (s.kind === 'ride' ? (loose ? `r:${s.stops.join(',')}` : `${s.line}:${s.from}>${s.to}`) : `w:${s.from}>${s.to}`);
  const key = (steps: Journey['steps'], loose = false) => steps.map((s) => stepKey(s, loose)).join(' ');
  const found = new Map<string, { journey: Journey; cost: number }>([[key(best.journey.steps), best]]);
  const ids = region.lines.map((l) => l.id);
  const pick = (start: number, set: string[]) => {
    if (set.length) {
      const r = search(region, src, dst, new Set(set));
      if (r && r.journey.changes <= maxChanges && r.cost <= best.cost * slack + extra && r.journey.railM <= best.journey.railM * detour + 3000) {
        const k = key(r.journey.steps); if (!found.has(k)) found.set(k, r);
      }
    }
    if (set.length > maxChanges) return;
    for (let i = start; i < ids.length; i++) pick(i + 1, [...set, ids[i]]);
  };
  pick(0, []);
  const out: Journey[] = [];
  for (const { journey: j } of [...found.values()].sort((a, b) => a.cost - b.cost || a.journey.railM - b.journey.railM)) {
    // the same ride on another line: one option
    const twin = out.find((o) => key(o.steps, true) === key(j.steps, true));
    if (twin) {
      twin.steps.forEach((s, i) => { const t = j.steps[i]; if (s.kind === 'ride' && t.kind === 'ride' && t.line !== s.line && !s.also?.includes(t.line)) s.also = [...(s.also ?? []), t.line]; });
      continue;
    }
    // only the first or the last ride differs from a better option
    const rides = j.steps.filter((s) => s.kind === 'ride').length;
    if (rides > 1 && out.some((o) => o.steps.length === j.steps.length && (key(o.steps.slice(1)) === key(j.steps.slice(1)) || key(o.steps.slice(0, -1)) === key(j.steps.slice(0, -1))))) continue;
    out.push({ ...j, steps: j.steps.map((s) => ({ ...s })) });
  }
  return out.slice(0, max);
}

// ---------- flat base map ----------
/** Road classes of a region's base map, from wide to thin ('minor' = residential, unclassified, living street). */
export type BasemapRoadClass = 'motorway' | 'trunk' | 'primary' | 'secondary' | 'tertiary' | 'minor';
export const BASEMAP_ROAD_CLASSES: readonly BasemapRoadClass[] = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor'];
/** A named place (OSM place node): where a district or neighbourhood name sits; OSM maps no boundaries for most. */
export interface RegionPlace {
  name: string;
  /** Simplified Chinese name (OSM name:zh-Hans or name:zh), when mapped */
  nameZh?: string;
  kind: 'town' | 'suburb' | 'quarter' | 'neighbourhood';
  c: XY;
}
/** A region's flat street map (regions/<id>/data/basemap.json), in the region's frame, cut to its box. Loaded on its own
 *  (loadRegionBasemap), after the rail network, since it is far bigger. */
export interface RegionBasemap {
  meta: { id: string; bbox: RegionMeta['bbox']; center: RegionMeta['center']; fetchedAt: string | null; source: string; attribution: string };
  /** per road class, polylines as flat lists x0, y0, x1, y1, … (m, whole metres) */
  roads: Record<BasemapRoadClass, number[][]>;
  /** areas: each polygon is its outer ring then its holes, each ring a flat list x0, y0, x1, y1, … (m) */
  water: number[][][]; green: number[][][];
  /** named places, the bigger kinds first (town, suburb, quarter, neighbourhood) */
  places: RegionPlace[];
}
const BASEMAP_LOADERS: Record<string, () => Promise<RegionBasemap>> = {
  'kuala-lumpur': () => import('../regions/kuala-lumpur/data/basemap.json').then((m) => m.default as unknown as RegionBasemap),
};
const basemapCache = new Map<string, Promise<RegionBasemap>>();
/** A region's flat street map (its own chunk, fetched on first use and cached). Rejects for a region without one. */
export function loadRegionBasemap(id = 'kuala-lumpur'): Promise<RegionBasemap> {
  const load = BASEMAP_LOADERS[id]; if (!load) return Promise.reject(new Error(`region "${id}" has no base map (known: ${Object.keys(BASEMAP_LOADERS).join(', ')})`));
  let p = basemapCache.get(id); if (!p) { p = load(); basemapCache.set(id, p); }
  return p;
}

const LOADERS: Record<string, () => Promise<RawRegion>> = {
  'kuala-lumpur': () => import('../regions/kuala-lumpur/data/region.json').then((m) => m.default as unknown as RawRegion),
};
const cache = new Map<string, Promise<Region>>();
/** The region's data (its own chunk, fetched on first use and cached). Rejects for an unknown id. */
export function loadRegion(id = 'kuala-lumpur'): Promise<Region> {
  const load = LOADERS[id]; if (!load) return Promise.reject(new Error(`unknown region "${id}" (known: ${Object.keys(LOADERS).join(', ')})`));
  let p = cache.get(id); if (!p) { p = load().then(buildRegion); cache.set(id, p); }
  return p;
}
