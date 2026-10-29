// Types of the processed OSM data, and an Area: one study area's data plus lookups and statistics derived from it.
// Every number shown in the UI should come from here (or a cited source). Load an area with loadArea() (areas.ts).
import climateJ from '../sources/climate.json';

export type XY = [number, number];
/** Zone ids come from the area's rules.json (Mid Valley: eco, gardens, midvalley). */
export type Zone = string;
export type HeightSource = 'osm' | 'levels' | 'estimate' | 'cited';
export interface HeightRef { value: number; unit: 'm' | 'floors'; floors: number | null; storeyHeight: number | null; publisher: string; url: string; fetched: string; note?: string; ctbuhEstimated: boolean }
/** A cited correction to OSM tags (sources/overrides.json), e.g. a building OSM still shows as under construction. */
export interface Override { reason: string; publisher: string; url: string; fetched: string }

export interface Building {
  id: string; name: string | null; type: string; part: boolean; parent: string | null;
  height: number; minHeight: number; levels: number | null; heightSource: HeightSource; heightNote?: string; heightRef?: HeightRef;
  precinct: string | null; zone: Zone | null; landmark?: string; podium?: string; podiumFor?: string; podiumName?: string; podiumNameSource?: string; station: string | null; area: number; c: XY; ring: XY[];
  override?: Override;
}
export interface Road { id: number; cls: string; name: string | null; w: number; bridge: boolean; tunnel: boolean; layer: number; pts: XY[] }
/** Rail line ids: lrt = LRT Kelana Jaya, ktm = KTM Komuter, erl = ERL (KLIA Ekspres / Transit), py = MRT Putrajaya, mr = KL Monorail. */
export type RailLineId = 'lrt' | 'ktm' | 'erl' | 'py' | 'mr' | 'other';
/** route: KTM Komuter line of a KTM track (1 = Batu Caves–Pulau Sebang, 2 = Tanjung Malim–Port Klang), from OSM route relations; null otherwise. */
export interface Rail { id: number; line: RailLineId; route?: 1 | 2 | null; routeInferred?: boolean; name: string | null; elevated: boolean; tunnel: boolean; layer: number; service: string | null; pts: XY[] }
export type Shelter = 'indoor' | 'covered-tag' | 'in-building' | 'open';
export interface Footway { id: number; kind: string; bridge: boolean; covered: boolean; indoor: boolean; layer: number; sheltered: boolean; shelter: Shelter; pts: XY[] }
export interface WaterLine { id: number; kind: string; name: string | null; width: number | null; pts: XY[] }
/** A ground polygon: water, green space or a named landuse precinct. */
export interface Polygon { id: string; name: string | null; ring: XY[]; landuse?: string }
export interface Station { id: string; ref: string | null; name: string; osmName: string; operator: string | null; layer: number; c: XY }
export type Share = 'bridge' | 'indoor' | 'covered' | 'open';
export interface RouteSegment { cls: string; layer: number; road: string | null; sheltered: boolean; shelter: Shelter; share: Share; length: number; osmWays: number[]; pts: XY[] }
export interface Route {
  id: string; from: string; to: string; fromLabel: string; toLabel: string; snapFrom: number; snapTo: number;
  length: number; minutes: number; byClass: Record<string, number>; byShare: Partial<Record<Share, number>>; shelteredM: number; shelteredPct: number; straightLine: number;
  overWaterM: number; segments: RouteSegment[]; error?: string;
  /** metres inside a named precinct, one key per rules.routeWithin entry (Mid Valley: withinEcoCityM, withinMidValleyCityM) */
  [within: `within${string}M`]: number;
}
export interface NamedOutline {
  id: string; name: string; type: string; c: XY; area: number; renderedAsParts: boolean;
  ownHeight: number | null; ownHeightSource: HeightSource | 'none'; heightRef?: HeightRef; levels: number | null;
  tallestPart: { id: string; name: string | null; height: number; heightSource: HeightSource; levels: number | null } | null;
  ring: XY[];
}
export interface Landmark {
  id: string; kind: string; name: string; nameEn: string | null; altName: string | null; religion: string | null;
  c: XY; lat: number; lon: number; inStudyArea: boolean; buildingId: string | null;
  /** absolute top (m) and base elevation (m) above ground: a landmark on a podium starts at the podium roof */
  height: number; base: number; heightSource: HeightSource;
  podium: { id: string; name: string; nameSource: string; levels: number | null; storeyM: number | null; roof: number } | null;
  polygons: { outer: XY[]; holes: XY[][] }[];
}
interface FacilityBase { id: string; name: string | null; nameEn: string | null; c: XY }
export interface Facilities {
  hotels: (FacilityBase & { kind: 'hotel' | 'apartment' | 'hostel' | 'guest_house' | 'motel'; stars: number | null; website: string | null })[];
  parking: (FacilityBase & { parking: string | null; capacity: number | null; fee: string | null; building: boolean; ring: XY[] | null })[];
  parkingEntrances: (FacilityBase & { parking: string | null })[];
  busStops: (FacilityBase & { ref: string | null; routes: string[]; shelter: boolean | null; network: string | null })[];
  stationEntrances: (FacilityBase & { ref: string | null; level: string | null; station: string | null })[];
}
export interface ZoneStat { blocks: number; footprintM2: number; namedBuildings: string[]; tallest: { name: string | null; height: number; heightSource: HeightSource } | null; centroid: XY }
export interface Meta {
  zones: Record<Zone, ZoneStat>;
  source: string; attribution: string; fetchedAt: string | null;
  center: { lat: number; lon: number }; halfSizeM: number; bbox: { south: number; west: number; north: number; east: number };
  levelHeightM: number; walkSpeedMPerMin: number;
  counts: { rawElements: number; outlines: number; parts: number; outlinesReplacedByParts: number; buildings: number; heightOsm: number; heightLevels: number; heightEstimate: number; heightCited: number; heightInherited: number; roads: number; footways: number; footbridges: number; indoorCorridors: number; stations: number };
  railLengthsM: Partial<Record<RailLineId, number>>;
  ktmRouteM?: Record<'1' | '2', number>;
  footwayLengthM: number; footbridgeLengthM: number; shelteredFootwayM: number; exposedFootwayM: number;
  heightSourcesFetched: string | null;
}
/** Drawing hints for MapModel from the area's rules.json (Mid Valley: LRT stop, KTM lines, Skypark overlay, precinct outline). */
export interface ModelRules {
  lrtStop?: string;
  ktm?: { route: 1 | 2; stop: string }[];
  skyparkOnKtmRoute?: 1 | 2;
  precinctOutlines?: string[];
  /** underground lines: stations where their trains stop, by line id */
  undergroundStops?: Partial<Record<RailLineId, string>>;
  /** green areas (OSM name) whose ground-level paths are part of the base map, drawn in every view like the roads */
  parkPaths?: string[];
  /** buildings (OSM name) drawn with a sculpted section instead of one block, e.g. a wave-shaped mall: along the long
   *  axis from the `from` end (0) to the other (1), the roof follows `top` and the underside `under` ([position, fraction of
   *  the height] points, eased between). `ribbons` facade bands sweep with the section; `oculus` marks an oval roof opening
   *  centred on the axis at `at`, `size` = [fraction of length, fraction of width]. Illustrative; heights stay as cited. */
  shapes?: { building: string; from: 'north' | 'south' | 'east' | 'west'; top: [number, number][]; under?: [number, number][]; ribbons: number; oculus?: { at: number; size: [number, number] } }[];
}
export interface AreaRules { model?: ModelRules; [key: string]: unknown }
/** One entry of the spot index (areas/index.json). */
export interface AreaInfo { id: string; name: string; kind: 'signature' | 'site'; summary: string | null; center: { lat: number; lon: number }; halfSizeM: number; bbox: Meta['bbox']; stations: string[]; lines: RailLineId[] }

/** An area's files as loaded (generated loaders in areas.gen.ts). */
export interface RawArea {
  meta: Meta; buildings: Building[]; lines: { roads: Road[]; rails: Rail[]; footways: Footway[]; waterLines: WaterLine[] };
  areas: { waterAreas: Polygon[]; green: Polygon[]; precincts: Polygon[] }; stations: Station[];
  routes: { routes: Route[]; walks: Route[]; anchors: Record<string, { label: string; pt: XY }> };
  namedOutlines: NamedOutline[]; landmarks: Landmark[]; facilities: Facilities; rules: AreaRules;
  /** cited facts for text (sources/facts.json): values plus publisher and url, keyed by topic */
  facts: Record<string, Fact>;
  /** when the facts were fetched (sources/facts.json), or null without facts */
  factsFetched: string | null;
}
/** A cited fact: published values plus where they come from. */
export type Fact = Record<string, string | number | boolean> & { publisher: string; url: string };
export type Place = { name: string; c: XY; height: number; heightSource: HeightSource | 'none'; levels: number | null; building?: Building };

/** One study area, ready to draw and to quote figures from. */
export interface Area {
  id: string; info: AreaInfo; rules: AreaRules; meta: Meta;
  buildings: Building[]; lines: RawArea['lines']; areas: RawArea['areas']; stations: Station[];
  routes: Route[]; walks: Route[]; anchors: RawArea['routes']['anchors'];
  namedOutlines: NamedOutline[]; landmarks: Landmark[]; facilities: Facilities; facts: Record<string, Fact>; factsFetched: string | null;
  /** zone ids in display order (meta.zones) */
  zones: Zone[];
  station(ref: string): Station | null;
  findPlace(name: string): Place | null;
  /** straight-line distance (m) between two stations by ref, or null */
  stationDistance(refA: string, refB: string): number | null;
  stats: ReturnType<typeof deriveStats>;
}

const dist = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const lenOf = (pts: XY[]) => pts.reduce((s, p, i) => (i ? s + dist(p, pts[i - 1]) : 0), 0);

function deriveStats(a: Pick<Area, 'buildings' | 'namedOutlines' | 'lines' | 'routes' | 'meta' | 'stations'>) {
  const { buildings, namedOutlines, lines, routes, meta, stations } = a;
  const bySource = (s: HeightSource) => buildings.filter((b) => b.heightSource === s).length;
  const osmTallest = buildings.filter((b) => b.heightSource === 'osm').sort((x, y) => y.height - x.height)[0];
  const citedSorted = buildings.filter((b) => b.heightSource === 'cited' && b.name).sort((x, y) => y.height - x.height);
  const citedTallest = citedSorted.filter((b) => b.height === citedSorted[0]?.height);
  const shelteredFootM = lines.footways.filter((f) => f.sheltered).reduce((s, f) => s + lenOf(f.pts), 0);
  const allFootM = lines.footways.reduce((s, f) => s + lenOf(f.pts), 0);
  const totalRoute = routes.reduce((s, r) => s + r.length, 0);
  const classTotals: Record<string, number> = {};
  for (const r of routes) for (const [k, v] of Object.entries(r.byClass)) classTotals[k] = (classTotals[k] || 0) + v;
  const bridgeM = (classTotals['bridge'] || 0) + (classTotals['bridge-enclosed'] || 0);
  return {
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
    stationCount: stations.length,
    railCorridors: new Set(lines.rails.map((r) => r.line).filter((l) => l !== 'other')).size,
    fetchedDate: (meta.fetchedAt || '').slice(0, 10),
  };
}

/** Build an Area from its loaded files (used by loadArea). */
export function buildArea(info: AreaInfo, raw: RawArea): Area {
  const stations = raw.stations.map((s) => ({
    ...s,
    ref: s.ref ?? (s.osmName.match(/^([A-Z]{2}\d+[A-Z]?)\s/)?.[1] || null),
    name: s.name || s.osmName,
  }));
  const station = (ref: string) => stations.find((s) => s.ref === ref) || null;
  const findPlace = (name: string): Place | null => {
    const b = raw.buildings.find((x) => x.name === name);
    if (b) return { name, c: b.c, height: b.height, heightSource: b.heightSource, levels: b.levels, building: b };
    const o = raw.namedOutlines.find((x) => x.name === name);
    if (o) {
      const h = o.ownHeight ?? o.tallestPart?.height ?? 10;
      return { name, c: o.c, height: h, heightSource: o.ownHeight != null ? (o.ownHeightSource as HeightSource) : 'none', levels: o.levels };
    }
    return null;
  };
  const base = {
    id: info.id, info, rules: raw.rules, meta: raw.meta,
    buildings: raw.buildings, lines: raw.lines, areas: raw.areas, stations,
    routes: raw.routes.routes.filter((r) => !r.error), walks: raw.routes.walks.filter((r) => !r.error), anchors: raw.routes.anchors,
    namedOutlines: raw.namedOutlines, landmarks: raw.landmarks, facilities: raw.facilities, facts: raw.facts ?? {}, factsFetched: raw.factsFetched ?? null,
    zones: Object.keys(raw.meta.zones),
    station, findPlace,
    stationDistance: (a: string, b: string) => { const sa = station(a), sb = station(b); return sa && sb ? Math.round(dist(sa.c, sb.c)) : null; },
  };
  return { ...base, stats: deriveStats(base) };
}

/** Cited monthly climate normals for Kuala Lumpur, shared by every area (sources/climate.json; publisher and URL inside). */
export const climate = climateJ;
