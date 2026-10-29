// The 3D model of one study area: block massing, ground layers, rail and trains, footways, walking routes, landmarks
// and the sun light. DOM-free: colours come from a Palette, time and motion flags from update(). A site loads an area
// (loadArea), builds `new MapModel(area)`, adds `model.group` to its own scene and owns the renderer, camera and controls.
import * as THREE from 'three';
import type { Area, XY, Building, HeightSource, Route, Zone, Rail, RailLineId, ModelRules } from '../data';
import { chainWays, chainWaysAnyDir, orientLeftHand, buildTrack, Trains, TRAIN, KTM_TRAIN, MRT_TRAIN, type Track } from './trains';
import { sunVector } from '../sun';
import { v3, ribbon, merge, flatShape, routeY } from './geometry';
import { LIGHT_PALETTE, type Palette } from './palette';

export type RailState = 'highlight' | 'context' | 'hidden';
type RailGroupId = 'lrt' | 'ktm' | 'erl' | 'py' | 'mr';
export interface SceneMode {
  rails: Record<RailGroupId, RailState>;
  footways: 'hidden' | 'faint' | 'show' | 'rain';
  routeSet: 'none' | 'legs' | 'walks';
  routeFocus: number | null; // legs: index of the focused leg
  walkFocus: string | null; // walks: id of the shown walk (null = all)
  routeStyle: 'plain' | 'rain';
  sun: { altitude: number; azimuth: number } | null; // null = fixed presentation light
  shadeDots: boolean;
  muteWater: boolean;
  xray: boolean;
  buildingStyle: 'default' | 'source' | 'threshold' | 'zone';
  threshold: number;
  precincts: boolean;
  landmarks: boolean; // highlight the landmark mosques (chapter 01 Landmarks)
  airport: boolean; // 02: ERL tracks in the KLIA Transit colour + the suspended Skypark Line as a dashed overlay on the Line 2 tracks
  /** underground view: tunnels (rail, road, pedestrian), underground stations and their trains below a see-through ground */
  underground: boolean;
  /** facility markers (facilities.json): hotels, car parks (footprint + entrances), bus stops, station entrances */
  facilities: { hotels: boolean; parking: boolean; bus: boolean; entrances: boolean };
  /** a facility to emphasise (id from facilities.json), or null */
  facilityFocus: string | null;
}
export const DEFAULT_MODE: SceneMode = {
  rails: { lrt: 'context', ktm: 'context', erl: 'context', py: 'context', mr: 'context' },
  footways: 'hidden', routeSet: 'none', routeFocus: null, walkFocus: null, routeStyle: 'plain', sun: null, shadeDots: false, muteWater: false, xray: false,
  buildingStyle: 'default', threshold: 60, precincts: false, landmarks: false, airport: false, underground: false,
  facilities: { hotels: false, parking: false, bus: false, entrances: false }, facilityFocus: null,
};
/** A change to the mode: any fields, and only the rail lines / facility types that change. */
export type ModePatch = Partial<Omit<SceneMode, 'rails' | 'facilities'>> & { rails?: Partial<SceneMode['rails']>; facilities?: Partial<SceneMode['facilities']> };

/** Estimated depth (m) below ground of a way on OSM layer `layer`: 4.5 m per layer step (a tunnel on layer 0 counts as -1).
 *  OSM gives the order of levels, not depths, so this is schematic. */
export const undergroundDepth = (layer: number) => 4.5 * Math.max(1, -Math.min(0, layer));

export interface ModelOptions { palette?: Palette }
export interface UpdateOptions {
  /** prefers-reduced-motion: trains stand still at their stations, routes are drawn at once */
  reducedMotion?: boolean;
  /** e.g. document.hidden: the train clock does not advance */
  paused?: boolean;
}

const col = (c: string) => new THREE.Color(c || '#ff00ff');
const inRing = (px: number, pn: number, ring: XY[]) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > pn) !== (yj > pn) && px < ((xj - xi) * (pn - yi)) / (yj - yi) + xi) c = !c; } return c; };
const extrude = (ring: XY[], base: number, h: number) => { const g = new THREE.ExtrudeGeometry(new THREE.Shape(ring.map(([x, n]) => new THREE.Vector2(x, n))), { depth: h, bevelEnabled: false }); g.rotateX(-Math.PI / 2); g.translate(0, base, 0); return g; };
type Profile = [number, number][];
/** A profile at `s` (0…1): smoothstep between its [s, value] points, so it eases in and out of each one. */
const profileAt = (pr: Profile, s: number) => {
  if (s <= pr[0][0]) return pr[0][1];
  for (let i = 1; i < pr.length; i++) if (s <= pr[i][0]) { const [s0, v0] = pr[i - 1], [s1, v1] = pr[i]; const u = (s - s0) / (s1 - s0 || 1); return v0 + (v1 - v0) * u * u * (3 - 2 * u); }
  return pr[pr.length - 1][1];
};
/** A footprint with a sculpted section (rules.model.shapes): along its long (principal) axis, from the `from` end (s = 0)
 *  to the other (s = 1), the roof follows `top` and the underside `under` (fractions of the height above the base), cut
 *  into thin strips so the curves read smoothly. `ribbons` facade bands run between underside and roof, so they sweep with
 *  the roofline; `oculus` draws an oval on the roof, centred on the axis at s = at, sized as fractions of length and width. */
function shapedBlock(ring: XY[], base: number, h: number, sh: NonNullable<ModelRules['shapes']>[number]) {
  if (ring.reduce((a, p, i) => { const q = ring[(i + 1) % ring.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0) < 0) ring = ring.slice().reverse(); // CCW: faces out
  const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length, cn = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  let sxx = 0, snn = 0, sxn = 0; for (const [x, n] of ring) { sxx += (x - cx) ** 2; snn += (n - cn) ** 2; sxn += (x - cx) * (n - cn); }
  const a = 0.5 * Math.atan2(2 * sxn, sxx - snn); const want = { north: [0, 1], south: [0, -1], east: [1, 0], west: [-1, 0] }[sh.from];
  const sg = Math.cos(a) * want[0] + Math.sin(a) * want[1] < 0 ? -1 : 1; const ax = sg * Math.cos(a), an = sg * Math.sin(a); // points to the `from` end
  const t = (p: XY) => (p[0] - cx) * ax + (p[1] - cn) * an; const ts = ring.map(t); const t0 = Math.max(...ts), t1 = Math.min(...ts);
  const s = (p: XY) => (t(p) - t0) / (t1 - t0);
  const w = (p: XY) => -(p[0] - cx) * an + (p[1] - cn) * ax; const ws = ring.map(w); const wMid = (Math.max(...ws) + Math.min(...ws)) / 2, wHalf = (Math.max(...ws) - Math.min(...ws)) / 2;
  const top = (p: XY) => base + h * profileAt(sh.top, s(p)), bot = (p: XY) => base + h * profileAt(sh.under ?? [[0, 0]], s(p));
  const clip = (poly: XY[], f: (p: XY) => number) => { // keep where f >= 0
    const out: XY[] = [];
    poly.forEach((p, i) => { const q = poly[(i + 1) % poly.length], fp = f(p), fq = f(q); if (fp >= 0) out.push(p); if ((fp >= 0) !== (fq >= 0)) { const k = fp / (fp - fq); out.push([p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k]); } });
    return out;
  };
  const pos: number[] = [], lines: number[] = [];
  const tri = (a: number[], b: number[], c: number[]) => pos.push(...a, ...b, ...c);
  const P = (p: XY, y: number) => [p[0], y, -p[1]];
  const N = 48;
  for (let i = 0; i < N; i++) {
    const sa = i / N, sb = (i + 1) / N;
    const poly = clip(clip(ring, (p) => s(p) - sa), (p) => sb - s(p)); if (poly.length < 3) continue;
    for (const [i0, i1, i2] of THREE.ShapeUtils.triangulateShape(poly.map(([x, n]) => new THREE.Vector2(x, n)), [])) {
      const [p0, p1, p2] = [poly[i0], poly[i1], poly[i2]];
      tri(P(p0, top(p0)), P(p1, top(p1)), P(p2, top(p2))); // roof (ring is CCW: faces up)
      tri(P(p0, bot(p0)), P(p2, bot(p2)), P(p1, bot(p1))); // underside
    }
    poly.forEach((p, j) => {
      const q = poly[(j + 1) % poly.length], ps = s(p), qs = s(q);
      if ((Math.abs(ps - sa) < 1e-6 && Math.abs(qs - sa) < 1e-6) || (Math.abs(ps - sb) < 1e-6 && Math.abs(qs - sb) < 1e-6)) return; // cut between strips
      const pb = P(p, bot(p)), qb = P(q, bot(q)), qt = P(q, top(q)), pt = P(p, top(p));
      tri(pb, qb, qt); tri(pb, qt, pt);
      lines.push(...pt, ...qt, ...pb, ...qb);
      // facade ribbons: evenly spaced between underside and roof, so they rise and fall with the section
      for (let k = 1; k < sh.ribbons; k++) { const f = k / sh.ribbons; lines.push(p[0], pb[1] + (pt[1] - pb[1]) * f, -p[1], q[0], qb[1] + (qt[1] - qb[1]) * f, -q[1]); }
    });
  }
  if (sh.oculus) {
    const tc = t0 + (t1 - t0) * sh.oculus.at, ra = (sh.oculus.size[0] * (t0 - t1)) / 2, rw = sh.oculus.size[1] * wHalf;
    const pt = (k: number): XY => { const th = (k / 48) * Math.PI * 2, u = tc + ra * Math.cos(th), v = wMid + rw * Math.sin(th); return [cx + u * ax - v * an, cn + u * an + v * ax]; };
    for (let k = 0; k < 48; k++) { const a0 = pt(k), a1 = pt(k + 1); lines.push(...P(a0, top(a0) + 0.3), ...P(a1, top(a1) + 0.3)); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
  const e = new THREE.BufferGeometry(); e.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  return { g, edges: e };
}

interface BMesh { data: Building; mesh: THREE.Mesh; edges: THREE.LineSegments; key: boolean }

export class MapModel {
  /** Root of the model (lights included); add it to your scene. */
  readonly group = new THREE.Group();
  /** The area this model draws. */
  readonly area: Area;
  mode: SceneMode = structuredClone(DEFAULT_MODE);
  palette: Palette;

  private hemi = new THREE.HemisphereLight(0xffffff, 0xbdbdb8, 2.4);
  private sun = new THREE.DirectionalLight(0xffffff, 1.5);
  private bmeshes: BMesh[] = [];
  private mats = {
    ground: new THREE.MeshLambertMaterial(),
    road: new THREE.MeshBasicMaterial(), roadMajor: new THREE.MeshBasicMaterial(),
    water: new THREE.MeshBasicMaterial(), green: new THREE.MeshBasicMaterial(),
    build: new THREE.MeshLambertMaterial(), context: new THREE.MeshLambertMaterial(),
    fade: new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.35 }),
    xray: new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.16, depthWrite: false }),
    src: { osm: new THREE.MeshLambertMaterial(), levels: new THREE.MeshLambertMaterial(), estimate: new THREE.MeshLambertMaterial(), cited: new THREE.MeshLambertMaterial() } as Record<HeightSource, THREE.MeshLambertMaterial>,
    rainCovered: new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true }), rainOpen: new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true }),
    walker: new THREE.MeshBasicMaterial(), dots: new THREE.MeshBasicMaterial(),
    zone: { eco: new THREE.MeshLambertMaterial(), gardens: new THREE.MeshLambertMaterial(), midvalley: new THREE.MeshLambertMaterial() } as Record<Zone, THREE.MeshLambertMaterial>,
    edgeKey: new THREE.LineBasicMaterial({ transparent: true }), edgeContext: new THREE.LineBasicMaterial({ transparent: true }),
    edgeFade: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.08 }),
    // polygon offset: the deck sits exactly on top of the KJ17 roof block (both 10.5 m); keep it on top without z-fighting
    rail: { lrt: new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }), ktm: new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide }), ktm2: new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide }), erl: new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide }), py: new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide }), mr: new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide }) },
    pier: new THREE.MeshLambertMaterial(),
    foot: new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide }), footBridge: new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide }),
    parkPath: new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    route: new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true }),
    routeDim: new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, opacity: 0.3 }),
    precinct: new THREE.LineDashedMaterial({ dashSize: 8, gapSize: 6, transparent: true, opacity: 0.7 }),
    frame: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.35 }),
    landmark: new THREE.MeshLambertMaterial(),
    podium: new THREE.MeshLambertMaterial(), // block a landmark stands on (Overview)
  };
  private railGroups: Record<RailGroupId, THREE.Group> = { lrt: new THREE.Group(), ktm: new THREE.Group(), erl: new THREE.Group(), py: new THREE.Group(), mr: new THREE.Group() };
  private footGroup = new THREE.Group();
  private routeMeshes: THREE.Mesh[] = []; // legs (chapter 05)
  private walkMeshes = new Map<string, THREE.Mesh>(); // walking routes (chapter 06)
  private rainGroups = new Map<string, THREE.Group>(); // per route: covered / open-air ribbons
  private footRain = new THREE.Group();
  private walker = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 3, 24), this.mats.walker);
  private dots: THREE.InstancedMesh | null = null;
  private routeDrawStart = 0;
  private walkDrawStart = 0;
  private hemiBase = 2.4; private sunBase = 1.5;
  private precinctGroup = new THREE.Group();
  /** LRT tracks (one chain per direction) and the animated trainsets on them (null when the area has no above-ground LRT). */
  lrtTracks: Track[] = [];
  trains: Trains | null = null;
  /** KTM Komuter tracks (two per line, oriented for left-hand running), their line (1 / 2), and the trainsets on them. */
  ktmTracks: Track[] = []; ktmTrackLine: (1 | 2)[] = [];
  ktmTrains: Trains | null = null;
  /** 02: suspended KL Sentral–Terminal Skypark Line (10), a thin dashed ribbon offset beside the Line 2 track; no trains. */
  private skypark: THREE.Mesh | null = null;
  private erlColors = { base: new THREE.Color(), klia: new THREE.Color() };
  private trainsOn = true;
  private landmarkGroup = new THREE.Group(); // landmark blocks outside the study square (shown with mode.landmarks)
  /** underground view: tunnels, underground stations, section walls (built only where the area has them) */
  private underGroup = new THREE.Group();
  private underMats: { rail: Map<RailLineId, THREE.MeshBasicMaterial>; road: THREE.MeshBasicMaterial; foot: THREE.MeshBasicMaterial; station: THREE.MeshBasicMaterial; wall: THREE.MeshBasicMaterial } | null = null;
  /** trains in the tunnels (underground view), one set per line in rules.model.undergroundStops */
  underTrains: { line: RailLineId; tracks: Track[]; trains: Trains }[] = [];
  /** facility markers by type (built only for types the area has) */
  private facGroups: Partial<Record<keyof SceneMode['facilities'], THREE.Group>> = {};
  private facMats: { hotel: THREE.MeshLambertMaterial; parking: THREE.MeshLambertMaterial; parkingArea: THREE.MeshBasicMaterial; bus: THREE.MeshLambertMaterial; entrance: THREE.MeshLambertMaterial; focus: THREE.MeshBasicMaterial } | null = null;
  private facFocus: THREE.Mesh | null = null;
  /** facility id -> marker top position (world), for focusing and labels */
  facilityAt = new Map<string, THREE.Vector3>();

  constructor(area: Area, opts: ModelOptions = {}) {
    this.area = area;
    this.palette = opts.palette ?? LIGHT_PALETTE;
    this.group.add(this.hemi, this.sun, this.sun.target);
    this.sun.position.set(-420, 900, -380);
    this.sun.castShadow = true;
    Object.assign(this.sun.shadow.camera, { left: -760, right: 760, top: 760, bottom: -760, near: 50, far: 3200 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.6; this.sun.shadow.radius = 3;

    this.build();
    this.setPalette(this.palette);
    this.setMode({});
  }

  // ---------- construction ----------
  private build() {
    const { buildings, lines, areas, routes, walks, landmarks, station } = this.area;
    const H = this.area.meta.halfSizeM;
    const rules = this.area.rules.model ?? {};
    for (const z of this.area.zones) if (!this.mats.zone[z]) this.mats.zone[z] = new THREE.MeshLambertMaterial(); // zones beyond the default three
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), this.mats.ground);
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; this.group.add(ground);

    // study-area frame
    const frame = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([v3(-H, -H, 0.3), v3(H, -H, 0.3), v3(H, H, 0.3), v3(-H, H, 0.3)]), this.mats.frame);
    this.group.add(frame);

    this.group.add(new THREE.Mesh(merge(areas.green.map((a) => flatShape(a.ring, 0.04))), this.mats.green));
    const water = merge([
      ...areas.waterAreas.map((a) => flatShape(a.ring, 0.1)),
      ...lines.waterLines.map((w) => ribbon(w.pts.map(([x, n]) => v3(x, n, 0.09)), w.width ?? (w.kind === 'river' ? 20 : 4))),
    ]);
    this.group.add(new THREE.Mesh(water, this.mats.water));
    // paths in the parks named in rules.parkPaths (ground level, mostly inside the park): part of the base map, in every view
    const parks = areas.green.filter((a) => rules.parkPaths?.includes(a.name ?? ''));
    const inPark = (pts: XY[]) => parks.some((a) => pts.filter(([x, n]) => inRing(x, n, a.ring)).length * 2 >= pts.length);
    const parkPaths = lines.footways.filter((f) => f.layer === 0 && !f.bridge && !f.indoor && inPark(f.pts));
    if (parkPaths.length) this.group.add(new THREE.Mesh(merge(parkPaths.map((f) => ribbon(f.pts.map(([x, n]) => v3(x, n, 0.12)), 2))), this.mats.parkPath));

    const major = new Set(['motorway', 'trunk', 'primary', 'secondary']);
    const roadG = (sel: boolean, y: number) => merge(lines.roads.filter((r) => major.has(r.cls) === sel && !r.tunnel).map((r) => ribbon(r.pts.map(([x, n]) => v3(x, n, y)), r.w)));
    this.group.add(new THREE.Mesh(roadG(false, 0.06), this.mats.road));
    this.group.add(new THREE.Mesh(roadG(true, 0.08), this.mats.roadMajor));

    // KTM: per Komuter line, the OSM main-track ways chained into one continuous track per direction (left-hand
    // running), at the drawn deck height with 4 % approach ramps to the bridges (schematic); tunnel stretches carry trains but are not drawn.
    const ktmDeck = (r: Rail) => (r.elevated ? 6 + Math.max(0, r.layer - 1) * 3 : 0.35);
    const ktmChained = new Set<Rail>();
    for (const { route: line, stop } of rules.ktm ?? []) {
      const st = station(stop);
      const chains = chainWaysAnyDir(lines.rails.filter((r) => r.line === 'ktm' && r.route === line));
      for (const c of chains) for (const w of c.src) ktmChained.add(w);
      for (const ch of orientLeftHand(chains.map((c) => c.chain))) { this.ktmTracks.push(buildTrack(ch, ktmDeck, st ? st.c : null, { smoothY: 8, maxGrade: 0.04, hidden: (r) => r.tunnel })); this.ktmTrackLine.push(line); }
    }
    // Station structures over the at-grade KTM tracks would hide the trains standing at the platforms: OSM
    // building=roof (an open-sided canopy) is drawn as a roof slab, and any other block over the track is drawn
    // from a 5 m clearance up (schematic, like the deck heights). Heights shown in the UI are unchanged.
    const coversKtm = (b: Building) => {
      const xs = b.ring.map((p) => p[0]), ns = b.ring.map((p) => p[1]); const x0 = Math.min(...xs), x1 = Math.max(...xs), n0 = Math.min(...ns), n1 = Math.max(...ns);
      return this.ktmTracks.some((t) => { for (let i = t.inStart; i <= t.inEnd; i += 2) { const x = t.x[i], n = -t.z[i]; if (!t.hide[i] && x >= x0 && x <= x1 && n >= n0 && n <= n1 && inRing(x, n, b.ring)) return true; } return false; });
    };
    const KTM_CLEAR = 5, SLAB = 0.6;
    // buildings (rules.shapes: sculpted section)
    const shapes = new Map((rules.shapes ?? []).map((s) => [s.building, s]));
    for (const b of buildings) {
      let base = b.minHeight;
      if (b.minHeight < KTM_CLEAR && b.height > 4.6 && coversKtm(b)) base = Math.max(b.minHeight, b.type === 'roof' ? b.height - SLAB : Math.min(KTM_CLEAR, b.height - SLAB));
      const h = Math.max(1, b.height - base);
      const sh = b.name ? shapes.get(b.name) : undefined;
      const shaped = sh ? shapedBlock(b.ring, base, h, sh) : null;
      const g = shaped ? shaped.g : extrude(b.ring, base, h);
      const mesh = new THREE.Mesh(g, this.mats.build); mesh.castShadow = true; mesh.receiveShadow = true;
      const edges = new THREE.LineSegments(shaped ? shaped.edges : new THREE.EdgesGeometry(g, 25), this.mats.edgeKey);
      const key = !!b.precinct || !!b.station || b.height >= 45;
      this.bmeshes.push({ data: b, mesh, edges, key });
      this.group.add(mesh, edges);
    }

    // rail
    // LRT: the OSM track ways are chained into one continuous track per direction (smoothed deck height,
    // no steps at way joins); the same tracks carry the trains.
    const lrtDeck = (r: Rail) => (r.elevated ? 9 + Math.max(0, r.layer - 2) * 1.5 : 0.35);
    const kj17 = rules.lrtStop ? station(rules.lrtStop) : null;
    const lrtWays = lines.rails.filter((r) => r.line === 'lrt' && !r.tunnel);
    this.lrtTracks = chainWays(lrtWays).map((ch) => buildTrack(ch, lrtDeck, kj17 ? kj17.c : null));
    const trackPts = (tr: Track, every: number) => { const out: THREE.Vector3[] = []; for (let i = tr.inStart; i <= tr.inEnd; i += every) out.push(new THREE.Vector3(tr.x[i], tr.y[i], tr.z[i])); const e = tr.inEnd; if ((e - tr.inStart) % every) out.push(new THREE.Vector3(tr.x[e], tr.y[e], tr.z[e])); return out; };
    const pierGeo = new THREE.BoxGeometry(2.2, 1, 2.2);
    const extraLines = (['py', 'mr'] as const).filter((l) => lines.rails.some((r) => r.line === l && !r.tunnel)); // above-ground MRT / monorail track, if any
    for (const line of ['lrt', 'ktm', 'erl', ...extraLines] as const) {
      const grp = this.railGroups[line];
      const rs = lines.rails.filter((r) => r.line === line && !r.tunnel);
      const deckY = (r: (typeof rs)[number]) => (line === 'lrt' ? lrtDeck(r) : r.elevated ? 6 + Math.max(0, r.layer - 1) * 3 : 0.35);
      const chained = line === 'lrt' ? new Set(chainWays(rs).flat()) : line === 'ktm' ? ktmChained : new Set<Rail>();
      // KTM: one mesh per Komuter line (route 2 = Tanjung Malim–Port Klang gets its own colour)
      const isK2 = (r: Rail) => line === 'ktm' && r.route === 2;
      const ribbons = rs.filter((r) => !chained.has(r) && !isK2(r)).map((r) => ribbon(r.pts.map(([x, n]) => v3(x, n, deckY(r))), line === 'lrt' ? 3.2 : 2.6));
      if (line === 'lrt') for (const tr of this.lrtTracks) ribbons.push(ribbon(trackPts(tr, 2).map((p) => p.setY(p.y + 0.15)), 3.2)); // 15 cm above the roof tops it crosses (KJ17)
      grp.add(new THREE.Mesh(merge(ribbons), this.mats.rail[line]));
      // KTM chained tracks: drawn from the track itself (the trains run on it), split where it is in a tunnel
      const ktmRuns = (want: 1 | 2) => this.ktmTracks.flatMap((tr, k) => {
        if (this.ktmTrackLine[k] !== want) return [];
        const out: (THREE.BufferGeometry | null)[] = []; let run: THREE.Vector3[] = [];
        const flush = () => { if (run.length > 1) out.push(ribbon(run, 2.6)); run = []; };
        for (let i = tr.inStart; i <= tr.inEnd; i++) { if (tr.hide[i]) { flush(); continue; } if ((i - tr.inStart) % 2 === 0 || i === tr.inEnd || tr.hide[i + 1]) run.push(new THREE.Vector3(tr.x[i], tr.y[i], tr.z[i])); }
        flush(); return out;
      });
      if (line === 'ktm') {
        const k1 = ktmRuns(1); if (k1.length) grp.add(new THREE.Mesh(merge(k1), this.mats.rail.ktm));
        const k2 = [...rs.filter((r) => isK2(r) && !chained.has(r)).map((r) => ribbon(r.pts.map(([x, n]) => v3(x, n, deckY(r))), 2.6)), ...ktmRuns(2)]; if (k2.length) grp.add(new THREE.Mesh(merge(k2), this.mats.rail.ktm2));
        // Skypark (Line 10) used the Line 2 tracks (OSM relations 9985660 / 8391024): dashes 10 m on / 6 m off, ~1 m wide, 3.5 m to the outer side
        const sk = rules.skyparkOnKtmRoute; const k2i = sk ? this.ktmTrackLine.indexOf(sk) : -1, k2j = sk ? this.ktmTrackLine.lastIndexOf(sk) : -1;
        if (k2i >= 0) {
          const tr = this.ktmTracks[k2i], other = k2j !== k2i ? this.ktmTracks[k2j] : null;
          const mid = (tr.inStart + tr.inEnd) >> 1; let side = 1;
          if (other) {
            let best = Infinity, bx = 0, bz = 0; for (let i = other.inStart; i <= other.inEnd; i++) { const d = (other.x[i] - tr.x[mid]) ** 2 + (other.z[i] - tr.z[mid]) ** 2; if (d < best) { best = d; bx = other.x[i]; bz = other.z[i]; } }
            const dx = tr.x[mid + 1] - tr.x[mid - 1], dz = tr.z[mid + 1] - tr.z[mid - 1]; side = (-dz * (bx - tr.x[mid]) + dx * (bz - tr.z[mid])) > 0 ? -1 : 1;
          }
          const dashes: (THREE.BufferGeometry | null)[] = []; let run: THREE.Vector3[] = []; let dist = 0;
          for (let i = tr.inStart; i <= tr.inEnd; i++) {
            if (i > tr.inStart) dist += Math.hypot(tr.x[i] - tr.x[i - 1], tr.z[i] - tr.z[i - 1]);
            const a = Math.max(tr.inStart, i - 1), b = Math.min(tr.inEnd, i + 1); const dx = tr.x[b] - tr.x[a], dz = tr.z[b] - tr.z[a], l = Math.hypot(dx, dz) || 1;
            const on = !tr.hide[i] && dist % 16 < 10;
            if (on) run.push(new THREE.Vector3(tr.x[i] + (side * -dz / l) * 3.5, tr.y[i] + 0.12, tr.z[i] + (side * dx / l) * 3.5));
            else if (run.length) { if (run.length > 1) dashes.push(ribbon(run, 1.1)); run = []; }
          }
          if (run.length > 1) dashes.push(ribbon(run, 1.1));
          const geo = dashes.filter((g): g is THREE.BufferGeometry => !!g);
          if (geo.length) { const mat = (this.mats.rail.ktm2 as THREE.Material).clone() as THREE.MeshBasicMaterial; mat.color = col(this.palette.rail.skypark); this.skypark = new THREE.Mesh(merge(geo), mat); this.skypark.visible = false; grp.add(this.skypark); }
        }
      }
      // piers under elevated track every ~32 m
      const piers: THREE.Vector3[] = [];
      if (line === 'lrt') for (const tr of this.lrtTracks) for (const p of trackPts(tr, 32)) piers.push(p);
      if (line === 'ktm') for (const tr of this.ktmTracks) for (let i = tr.inStart; i <= tr.inEnd; i += 32) if (!tr.hide[i] && tr.y[i] > 1.5) piers.push(new THREE.Vector3(tr.x[i], tr.y[i], tr.z[i]));
      for (const r of rs.filter((r) => r.elevated && !chained.has(r) && r.service !== 'crossover')) {
        let acc = 0;
        for (let i = 1; i < r.pts.length; i++) {
          const a = r.pts[i - 1], b = r.pts[i]; const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
          while (acc < d) { const t = acc / d; piers.push(v3(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, deckY(r))); acc += 32; }
          acc -= d;
        }
      }
      if (piers.length) {
        const inst = new THREE.InstancedMesh(pierGeo, this.mats.pier, piers.length); const m = new THREE.Matrix4();
        piers.forEach((p, i) => { m.compose(new THREE.Vector3(p.x, p.y / 2, p.z), new THREE.Quaternion(), new THREE.Vector3(1, p.y, 1)); inst.setMatrixAt(i, m); });
        inst.castShadow = true; grp.add(inst);
      }
      this.group.add(grp);
    }
    // trains: LRT on the viaduct; KTM Komuter on both lines (one instanced set, livery stripe per line)
    if (this.lrtTracks.length) { this.trains = new Trains(this.lrtTracks, H); this.group.add(this.trains.group); }
    if (this.ktmTracks.length) { this.ktmTrains = new Trains(this.ktmTracks, H, KTM_TRAIN); this.group.add(this.ktmTrains.group); }

    // landmark blocks whose footprint centroid lies outside the study square (full OSM outline, not clipped)
    for (const l of landmarks.filter((l) => !l.buildingId && !l.inStudyArea)) {
      for (const poly of l.polygons) {
        const shape = new THREE.Shape(poly.outer.map(([x, n]) => new THREE.Vector2(x, n)));
        for (const hole of poly.holes) shape.holes.push(new THREE.Path(hole.map(([x, n]) => new THREE.Vector2(x, n))));
        const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(1, l.height - (l.base || 0)), bevelEnabled: false }); g.rotateX(-Math.PI / 2); g.translate(0, l.base || 0, 0);
        const mesh = new THREE.Mesh(g, this.mats.landmark); mesh.castShadow = true; mesh.receiveShadow = true;
        this.landmarkGroup.add(mesh, new THREE.LineSegments(new THREE.EdgesGeometry(g, 25), this.mats.edgeKey));
      }
    }
    this.group.add(this.landmarkGroup);

    // footways
    const fy = (f: { bridge: boolean; layer: number; indoor: boolean }) => (f.bridge ? 5 + Math.max(0, f.layer - 1) * 3 : f.layer > 0 ? 5 + (f.layer - 1) * 3 : 0.22);
    this.footGroup.add(new THREE.Mesh(merge(lines.footways.filter((f) => !f.bridge).map((f) => ribbon(f.pts.map(([x, n]) => v3(x, n, fy(f))), 1.4))), this.mats.foot));
    this.footGroup.add(new THREE.Mesh(merge(lines.footways.filter((f) => f.bridge).map((f) => ribbon(f.pts.map(([x, n]) => v3(x, n, fy(f))), 2.4))), this.mats.footBridge));
    this.group.add(this.footGroup);
    // footways coloured by shelter (chapter 08)
    this.footRain.add(new THREE.Mesh(merge(lines.footways.filter((f) => f.sheltered).map((f) => ribbon(f.pts.map(([x, n]) => v3(x, n, fy(f) + 0.05)), f.bridge ? 2.6 : 2))), this.mats.rainCovered));
    this.footRain.add(new THREE.Mesh(merge(lines.footways.filter((f) => !f.sheltered).map((f) => ribbon(f.pts.map(([x, n]) => v3(x, n, fy(f) + 0.05)), f.bridge ? 2.6 : 2))), this.mats.rainOpen));
    this.group.add(this.footRain);

    // routes: one mesh per route; vertices ordered along the path for draw-on
    const pathOf = (r: Route) => {
      const pts: THREE.Vector3[] = [];
      for (const s of r.segments) for (const [x, n] of s.pts) { const p = v3(x, n, routeY(s.layer)); const last = pts[pts.length - 1]; if (!last || last.distanceToSquared(p) > 0.01) pts.push(p); }
      return pts;
    };
    const routeMesh = (r: Route, width: number) => {
      const pts = pathOf(r); const g = ribbon(pts, width) || new THREE.BufferGeometry();
      const m = new THREE.Mesh(g, this.mats.route); m.renderOrder = 10; m.userData.count = g.index ? g.index.count : 0;
      const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
      m.userData.pts = pts; m.userData.cum = cum; m.userData.length = cum[cum.length - 1];
      this.group.add(m); return m;
    };
    for (const r of routes) this.routeMeshes.push(routeMesh(r, 5));
    for (const r of [...routes, ...walks]) {
      if (!this.walkMeshes.has(r.id) && walks.includes(r)) this.walkMeshes.set(r.id, routeMesh(r, 5.5));
      const grp = new THREE.Group();
      for (const [cov, mat] of [[true, this.mats.rainCovered], [false, this.mats.rainOpen]] as const) {
        const m = new THREE.Mesh(merge(r.segments.filter((sg) => sg.sheltered === cov).map((sg) => ribbon(sg.pts.map(([x, n]) => v3(x, n, routeY(sg.layer) + 0.1)), 6))), mat);
        m.renderOrder = 11; grp.add(m);
      }
      this.rainGroups.set(r.id, grp); this.group.add(grp);
    }
    this.walker.renderOrder = 12; this.group.add(this.walker);

    // precinct outline (KL Eco City; the Mid Valley City polygon is not drawn: the Mid Valley precinct is the Megamall itself)
    for (const p of areas.precincts.filter((p) => rules.precinctOutlines?.includes(p.name ?? ''))) {
      const l = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(p.ring.map(([x, n]) => v3(x, n, 0.5))), this.mats.precinct);
      l.computeLineDistances(); this.precinctGroup.add(l);
    }
    this.group.add(this.precinctGroup);
    this.buildUnderground();
    this.buildFacilities();
  }

  // ---------- facilities ----------
  /** Markers at facility points: a tall pin for hotels (on top of the building they are in), car-park footprints and
   *  entrances, bus-stop posts and station entrances. Built only for the types the area has; shown with mode.facilities. */
  private buildFacilities() {
    const f = this.area.facilities; if (!f) return;
    const any = f.hotels.length + f.parking.length + f.parkingEntrances.length + f.busStops.length + f.stationEntrances.length;
    if (!any) return;
    const lam = () => new THREE.MeshLambertMaterial();
    const fm = this.facMats = { hotel: lam(), parking: lam(), parkingArea: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }), bus: lam(), entrance: lam(), focus: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9 }) };
    const inside = (p: XY, ring: XY[]) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c; } return c; };
    const roofAt = (c: XY) => Math.max(0, ...this.area.buildings.filter((b) => Math.abs(b.c[0] - c[0]) < 120 && Math.abs(b.c[1] - c[1]) < 120 && inside(c, b.ring)).map((b) => b.height));
    const pins = (items: { id: string; c: XY }[], geo: THREE.BufferGeometry, m: THREE.Material, top: (c: XY) => number, scaleY: (c: XY) => number) => {
      const inst = new THREE.InstancedMesh(geo, m, Math.max(1, items.length)); const mx = new THREE.Matrix4();
      items.forEach((it, i) => { const y = top(it.c); const sy = scaleY(it.c); mx.compose(v3(it.c[0], it.c[1], y + sy / 2), new THREE.Quaternion(), new THREE.Vector3(1, sy, 1)); inst.setMatrixAt(i, mx); this.facilityAt.set(it.id, v3(it.c[0], it.c[1], y + sy)); });
      inst.count = items.length; inst.castShadow = false; inst.renderOrder = 8; return inst;
    };
    const unitBox = (w: number) => new THREE.BoxGeometry(w, 1, w);
    if (f.hotels.length) { const g = new THREE.Group(); g.add(pins(f.hotels, unitBox(5), fm.hotel, (c) => roofAt(c), () => 16)); this.facGroups.hotels = g; }
    if (f.parking.length || f.parkingEntrances.length) {
      const g = new THREE.Group();
      const rings = f.parking.filter((p) => p.ring && p.ring.length >= 3 && !p.building);
      if (rings.length) { const mesh = new THREE.Mesh(merge(rings.map((p) => flatShape(p.ring!, 0.3))), fm.parkingArea); mesh.renderOrder = 3; g.add(mesh); }
      for (const p of f.parking) this.facilityAt.set(p.id, v3(p.c[0], p.c[1], (p.building ? roofAt(p.c) : 0) + 4));
      if (f.parkingEntrances.length) g.add(pins(f.parkingEntrances, unitBox(3), fm.parking, () => 0, () => 4));
      this.facGroups.parking = g;
    }
    if (f.busStops.length) { const g = new THREE.Group(); g.add(pins(f.busStops, new THREE.CylinderGeometry(1.6, 1.6, 1, 12), fm.bus, () => 0, () => 7)); this.facGroups.bus = g; }
    if (f.stationEntrances.length) { const g = new THREE.Group(); g.add(pins(f.stationEntrances, unitBox(3.2), fm.entrance, () => 0, () => 5)); this.facGroups.entrances = g; }
    for (const g of Object.values(this.facGroups)) { g.visible = false; this.group.add(g); }
    this.facFocus = new THREE.Mesh(new THREE.SphereGeometry(5, 16, 12), fm.focus); this.facFocus.visible = false; this.facFocus.renderOrder = 13; this.group.add(this.facFocus);
  }

  // ---------- underground view ----------
  /** Tunnels at their estimated depth (undergroundDepth), underground stations, section walls along the study-square
   *  edge and the trains in the tunnels. Built only for what the area has; shown with mode.underground. */
  private buildUnderground() {
    const { lines, stations, station } = this.area;
    const H = this.area.meta.halfSizeM;
    const rules = this.area.rules.model ?? {};
    const tunnelRails = lines.rails.filter((r) => (r.tunnel || r.layer < 0) && r.line !== 'other');
    const tunnelRoads = lines.roads.filter((r) => r.tunnel || r.layer < 0);
    const tunnelFoot = lines.footways.filter((f) => f.layer < 0);
    const stops = Object.values(rules.undergroundStops ?? {}).filter((x): x is string => !!x);
    const underStations = stations.filter((st) => st.layer < 0 || (st.ref && stops.includes(st.ref)));
    if (!tunnelRails.length && !tunnelRoads.length && !tunnelFoot.length) return;
    const mat = () => new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, opacity: 0.95 });
    const um = this.underMats = { rail: new Map<RailLineId, THREE.MeshBasicMaterial>(), road: mat(), foot: mat(), station: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5, depthWrite: false }), wall: new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, opacity: 0.18, depthWrite: false }) };
    let deepest = 0;
    const at = (pts: XY[], layer: number) => { const d = undergroundDepth(layer); deepest = Math.max(deepest, d); return pts.map(([x, n]) => v3(x, n, -d)); };
    // rail tunnels, one mesh per line in the line colour
    for (const line of [...new Set(tunnelRails.map((r) => r.line))]) {
      const m = mat(); um.rail.set(line, m);
      const mesh = new THREE.Mesh(merge(tunnelRails.filter((r) => r.line === line).map((r) => ribbon(at(r.pts, r.layer), 5))), m); mesh.renderOrder = 6;
      this.underGroup.add(mesh);
    }
    if (tunnelRoads.length) { const mesh = new THREE.Mesh(merge(tunnelRoads.map((r) => ribbon(at(r.pts, r.layer), r.w))), um.road); mesh.renderOrder = 5; this.underGroup.add(mesh); }
    if (tunnelFoot.length) { const mesh = new THREE.Mesh(merge(tunnelFoot.map((f) => ribbon(at(f.pts, f.layer), 3))), um.foot); mesh.renderOrder = 5; this.underGroup.add(mesh); }
    // underground stations: a box at the depth of the nearest tunnel track, and a shaft up to the street
    for (const st of underStations) {
      let best = Infinity, d = undergroundDepth(st.layer);
      for (const r of tunnelRails) for (const [x, n] of r.pts) { const k = Math.hypot(x - st.c[0], n - st.c[1]); if (k < best) { best = k; d = undergroundDepth(r.layer); } }
      const box = new THREE.Mesh(new THREE.BoxGeometry(18, 7, 18), um.station); box.position.copy(v3(st.c[0], st.c[1], -d + 2)); box.renderOrder = 7;
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(2, d, 2), um.station); shaft.position.copy(v3(st.c[0], st.c[1], -d / 2));
      this.underGroup.add(box, shaft);
    }
    // section walls along the study-square edge, down to just below the deepest way
    const D = deepest + 4;
    for (const [x0, n0, x1, n1] of [[-H, -H, H, -H], [H, -H, H, H], [H, H, -H, H], [-H, H, -H, -H]]) {
      const g = new THREE.PlaneGeometry(Math.hypot(x1 - x0, n1 - n0), D); const wall = new THREE.Mesh(g, um.wall);
      wall.position.copy(v3((x0 + x1) / 2, (n0 + n1) / 2, -D / 2)); wall.rotation.y = Math.atan2(-(n1 - n0), x1 - x0) * -1; wall.renderOrder = 4;
      this.underGroup.add(wall);
    }
    // trains in the tunnels: per line, the tunnel ways chained per direction, stopping at the line's station
    for (const [line, ref] of Object.entries(rules.undergroundStops ?? {}) as [RailLineId, string][]) {
      const ways = tunnelRails.filter((r) => r.line === line);
      const chains = orientLeftHand(chainWaysAnyDir(ways).map((c) => c.chain));
      const st = station(ref);
      const tracks = chains.map((ch) => buildTrack(ch, (r) => -undergroundDepth(r.layer), st ? st.c : null, { smoothY: 8 }));
      if (!tracks.length) continue;
      const trains = new Trains(tracks, H, line === 'py' ? MRT_TRAIN : TRAIN);
      this.underTrains.push({ line, tracks, trains }); this.underGroup.add(trains.group);
    }
    this.underGroup.visible = false;
    this.group.add(this.underGroup);
  }

  // ---------- shade sampling (chapter 07) ----------
  /** Show sample points as small squares (colours set by setShadeResult). */
  setShadeSamples(pts: THREE.Vector3[]) {
    if (this.dots) { this.group.remove(this.dots); this.dots.dispose(); }
    const g = new THREE.PlaneGeometry(2.6, 2.6); g.rotateX(-Math.PI / 2);
    this.dots = new THREE.InstancedMesh(g, this.mats.dots, Math.max(1, pts.length)); const m = new THREE.Matrix4();
    pts.forEach((p, i) => { m.makeTranslation(p.x, p.y - 1.3, p.z); this.dots!.setMatrixAt(i, m); this.dots!.setColorAt(i, new THREE.Color(1, 1, 1)); });
    this.dots.count = pts.length; this.dots.renderOrder = 9; this.dots.visible = this.mode.shadeDots; this.group.add(this.dots);
  }
  /** For each sample, true when a building blocks the ray towards the sun. */
  shadeTest(pts: THREE.Vector3[], altitude: number, azimuth: number): boolean[] {
    if (altitude <= 0) return pts.map(() => true);
    const dir = new THREE.Vector3(...sunVector(altitude, azimuth)); const rc = new THREE.Raycaster(); rc.far = 2500;
    const meshes = this.bmeshes.map((b) => b.mesh);
    return pts.map((p) => { rc.set(p, dir); return rc.intersectObjects(meshes, false).length > 0; });
  }
  setShadeResult(shaded: boolean[]) {
    if (!this.dots) return; const lit = col(this.palette.sunlit), sh = col(this.palette.shaded);
    shaded.forEach((s, i) => this.dots!.setColorAt(i, s ? sh : lit)); if (this.dots.instanceColor) this.dots.instanceColor.needsUpdate = true;
  }
  /** Restart the draw-on animation of the visible walking route. */
  replayWalk() { this.walkDrawStart = performance.now(); }

  // ---------- palette ----------
  setPalette(p: Palette) {
    this.palette = p;
    const m = this.mats;
    m.ground.color = col(p.ground);
    m.road.color = col(p.road); m.roadMajor.color = col(p.roadMajor);
    m.water.color = col(p.water); m.green.color = col(p.green);
    m.build.color = col(p.building); m.context.color = col(p.buildingContext);
    m.fade.color = col(p.buildingContext); m.xray.color = col(p.building);
    m.pier.color = col(p.buildingContext);
    m.src.osm.color = col(p.heightSource.osm); m.src.levels.color = col(p.heightSource.levels); m.src.estimate.color = col(p.heightSource.estimate); m.src.cited.color = col(p.heightSource.cited);
    for (const [z, zm] of Object.entries(m.zone)) zm.color = col(p.zone[z] ?? p.buildingContext);
    m.rainCovered.color = col(p.covered); m.rainOpen.color = col(p.open); m.walker.color = col(p.route); m.dots.color = new THREE.Color(1, 1, 1);
    const edge = col(p.edge);
    for (const e of [m.edgeKey, m.edgeContext, m.edgeFade, m.precinct, m.frame]) e.color = edge;
    m.edgeKey.opacity = p.edgeOpacity;
    m.edgeContext.opacity = p.edgeContextOpacity;
    m.rail.py.color = col(p.rail.py); m.rail.mr.color = col(p.rail.mr);
    m.rail.lrt.color = col(p.rail.lrt); m.rail.ktm.color = col(p.rail.ktm1); m.rail.ktm2.color = col(p.rail.ktm2); m.rail.erl.color = col(p.rail.erl); this.erlColors.base.copy(col(p.rail.erl)); this.erlColors.klia.copy(col(p.rail.kliaTransit)); if (this.mode) m.rail.erl.color.copy(this.mode.airport ? this.erlColors.klia : this.erlColors.base); if (this.skypark) (this.skypark.material as THREE.MeshBasicMaterial).color = col(p.rail.skypark);
    m.foot.color = col(p.footway); m.footBridge.color = col(p.footbridge); m.parkPath.color = col(p.footway);
    m.landmark.color = col(p.landmark); m.podium.color = col(p.podium);
    this.trains?.setColors(col(p.train.body), col(p.train.window), col(p.train.accent), edge, p.edgeOpacity * 0.85);
    this.ktmTrains?.setTrackColors(this.ktmTrackLine.map((l) => col(l === 1 ? p.rail.ktm1 : p.rail.ktm2)));
    this.ktmTrains?.setColors(col(p.train.body), col(p.train.window), col(p.train.accent), edge, p.edgeOpacity * 0.85);
    m.route.color = col(p.route); m.routeDim.color = col(p.route);
    if (this.underMats) {
      const um = this.underMats; const lineCol: Partial<Record<RailLineId, string>> = { lrt: p.rail.lrt, ktm: p.rail.ktm1, erl: p.rail.erl, py: p.rail.py, mr: p.rail.mr };
      for (const [line, lm] of um.rail) lm.color = col(lineCol[line] ?? p.edge);
      um.road.color = col(p.roadMajor); um.foot.color = col(p.footbridge); um.station.color = col(p.edge); um.wall.color = col(p.underground);
      for (const ut of this.underTrains) ut.trains.setColors(col(p.train.body), col(p.train.window), col(lineCol[ut.line] ?? p.train.accent), edge, p.edgeOpacity * 0.85);
    }
    if (this.facMats) {
      const fm = this.facMats; fm.hotel.color = col(p.facility.hotel); fm.parking.color = col(p.facility.parking); fm.parkingArea.color = col(p.facility.parking);
      fm.bus.color = col(p.facility.bus); fm.entrance.color = col(p.facility.entrance); fm.focus.color = col(p.route);
    }
    this.hemiBase = p.light.hemi; this.hemi.groundColor = col(p.light.hemiGround);
    this.sunBase = p.light.sun;
    this.setMode({});
  }

  // ---------- modes ----------
  setMode(patch: ModePatch) {
    const prev = this.mode;
    this.mode = { ...this.mode, ...patch, rails: { ...this.mode.rails, ...(patch.rails || {}) }, facilities: { ...this.mode.facilities, ...(patch.facilities || {}) } };
    const md = this.mode; const m = this.mats;
    for (const b of this.bmeshes) {
      let mat: THREE.Material = b.key ? m.build : m.context; let em: THREE.LineBasicMaterial = b.key ? m.edgeKey : m.edgeContext;
      if (md.buildingStyle === 'source') { mat = m.src[b.data.heightSource]; em = m.edgeKey; }
      else if (md.buildingStyle === 'zone') { mat = b.data.zone ? m.zone[b.data.zone] ?? m.context : m.context; em = b.data.zone ? m.edgeKey : m.edgeContext; }
      else if (md.buildingStyle === 'threshold') { const on = b.data.height >= md.threshold; mat = on ? m.build : m.fade; em = on ? m.edgeKey : m.edgeFade; }
      if (md.landmarks && b.data.landmark) { mat = m.landmark; em = m.edgeKey; }
      if (md.landmarks && b.data.podiumFor) { mat = m.podium; em = m.edgeKey; }
      if (md.xray) { mat = m.xray; em = b.key ? m.edgeContext : m.edgeFade; }
      b.mesh.material = mat; b.edges.material = em;
      b.mesh.castShadow = !md.xray;
    }
    for (const line of ['lrt', 'ktm', 'erl', 'py', 'mr'] as const) {
      const st = md.rails[line]; const grp = this.railGroups[line];
      grp.visible = st !== 'hidden';
      m.rail[line].opacity = st === 'highlight' ? 1 : 0.35;
      if (line === 'ktm') m.rail.ktm2.opacity = m.rail.ktm.opacity;
    }
    m.rail.erl.color.copy(md.airport ? this.erlColors.klia : this.erlColors.base);
    if (this.skypark) { this.skypark.visible = md.airport; (this.skypark.material as THREE.MeshBasicMaterial).opacity = m.rail.ktm.opacity; }
    this.footGroup.visible = md.footways === 'faint' || md.footways === 'show';
    this.footRain.visible = md.footways === 'rain';
    m.rainCovered.opacity = 0.95; m.rainOpen.opacity = 0.9;
    m.foot.opacity = md.footways === 'show' ? 0.85 : 0.35; m.footBridge.opacity = md.footways === 'show' ? 0.95 : 0.4;
    const plain = md.routeStyle === 'plain';
    this.routeMeshes.forEach((r, i) => { r.visible = plain && md.routeSet === 'legs'; r.material = md.routeFocus == null || md.routeFocus === i ? m.route : m.routeDim; });
    for (const [id, r] of this.walkMeshes) r.visible = plain && md.routeSet === 'walks' && (md.walkFocus == null || md.walkFocus === id);
    const { walks, routes } = this.area;
    for (const [id, g] of this.rainGroups) g.visible = !plain && md.routeSet !== 'none' && (md.routeSet === 'walks' ? walks.some((w) => w.id === id) && (md.walkFocus == null || md.walkFocus === id) : routes.some((w) => w.id === id));
    this.walker.visible = plain && md.routeSet === 'walks' && md.walkFocus != null;
    if (md.routeSet === 'legs' && prev.routeSet !== 'legs') this.routeDrawStart = performance.now();
    if (md.routeSet === 'walks' && (prev.routeSet !== 'walks' || prev.walkFocus !== md.walkFocus)) this.walkDrawStart = performance.now();
    if (this.dots) this.dots.visible = md.shadeDots;
    // light: fixed presentation sun, or the computed sun position (chapter 07)
    if (md.sun) {
      const [x, y, z] = sunVector(md.sun.altitude, md.sun.azimuth); const up = md.sun.altitude > 0;
      this.sun.position.set(x * 1500, y * 1500, z * 1500); this.sun.target.position.set(0, 0, 0);
      this.sun.intensity = up ? this.sunBase * (0.55 + 0.6 * Math.sin((md.sun.altitude * Math.PI) / 180)) : 0;
      this.hemi.intensity = this.hemiBase * (up ? 0.62 : 0.45);
      this.sun.castShadow = up;
    } else {
      this.sun.position.set(-420, 900, -380); this.sun.target.position.set(0, 0, 0);
      this.sun.intensity = this.sunBase; this.hemi.intensity = this.hemiBase; this.sun.castShadow = true;
    }
    m.water.color = col(md.muteWater ? this.palette.waterMuted : this.palette.water);
    this.precinctGroup.visible = md.precincts;
    this.landmarkGroup.visible = md.landmarks;
    if (this.trains) this.trains.group.visible = this.trainsOn && md.rails.lrt !== 'hidden';
    if (this.ktmTrains) this.ktmTrains.group.visible = this.trainsOn && md.rails.ktm !== 'hidden';
    // underground view: ground layers turn see-through so the tunnels show beneath
    const ug = md.underground;
    for (const mt of [m.ground, m.road, m.roadMajor, m.water, m.green]) {
      if (mt.transparent !== ug) { mt.transparent = ug; mt.depthWrite = !ug; mt.needsUpdate = true; }
      mt.opacity = ug ? (mt === m.ground ? 0.22 : 0.4) : 1;
    }
    m.parkPath.opacity = ug ? 0.3 : 0.8;
    this.underGroup.visible = ug;
    for (const [k, g] of Object.entries(this.facGroups) as [keyof SceneMode['facilities'], THREE.Group][]) g.visible = md.facilities[k];
    if (this.facFocus) { const at = md.facilityFocus ? this.facilityAt.get(md.facilityFocus) : null; this.facFocus.visible = !!at; if (at) this.facFocus.position.copy(at).add(new THREE.Vector3(0, 6, 0)); }
    for (const ut of this.underTrains) ut.trains.group.visible = ug && this.trainsOn && md.rails[ut.line as RailGroupId] !== 'hidden';
  }

  // ---------- trains ----------
  /** Show or hide the animated LRT and KTM trainsets (scene life; user toggle). */
  setTrains(on: boolean) { this.trainsOn = on; this.setMode({}); }
  get trainsVisible() { return this.trainsOn; }

  // ---------- per frame ----------
  /** Advance the trains and the route draw-on. `now` in ms (requestAnimationFrame time), `dt` in seconds. */
  update(now: number, dt: number, opts: UpdateOptions = {}) {
    // trains: run on a clamped clock that only advances while not paused;
    // with reduced motion they are shown static (one train standing at KJ17, one at each KTM station)
    const reduced = !!opts.reducedMotion;
    for (const tr of [this.trains, this.ktmTrains, ...this.underTrains.map((u) => u.trains)]) {
      if (!tr) continue;
      if (reduced) tr.freeze(tr.reducedMotionClock());
      else if (!opts.paused) tr.step(dt);
      tr.update();
    }
    // route draw-on
    const k = reduced ? 1 : Math.min(1, (now - this.routeDrawStart) / 2600);
    const total = this.routeMeshes.length;
    this.routeMeshes.forEach((r, i) => {
      const local = THREE.MathUtils.clamp(k * total - i, 0, 1); const count = r.userData.count as number;
      r.geometry.setDrawRange(0, Math.floor((count * local) / 6) * 6);
    });
    for (const r of this.walkMeshes.values()) {
      if (!r.visible) continue;
      const L = r.userData.length as number; const dur = Math.max(1400, (L / 650) * 3600);
      const kw = reduced ? 1 : Math.min(1, (now - this.walkDrawStart) / dur);
      const count = r.userData.count as number; r.geometry.setDrawRange(0, Math.floor((count * kw) / 6) * 6);
      // walker marker at the head of the line
      const pts = r.userData.pts as THREE.Vector3[]; const cum = r.userData.cum as number[]; const d = kw * L;
      let i = cum.findIndex((c) => c >= d); if (i <= 0) i = 1;
      const t = (d - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
      if (pts.length > 1) this.walker.position.lerpVectors(pts[i - 1], pts[i], THREE.MathUtils.clamp(t, 0, 1)).add(new THREE.Vector3(0, 1.6, 0));
    }
  }
}
