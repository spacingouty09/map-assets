// The 3D model of the study area: block massing, ground layers, rail and trains, footways, walking routes, landmark
// mosques and the sun light. DOM-free: colours come from a Palette, time and motion flags from update(). A site adds
// `model.group` to its own scene and owns the renderer, camera and controls.
import * as THREE from 'three';
import { buildings, lines, areas, routes, walks, meta, landmarks, station, type XY, type Building, type HeightSource, type Route, type Zone, type Rail } from '../data';
import { chainWays, chainWaysAnyDir, orientLeftHand, buildTrack, Trains, KTM_TRAIN, type Track } from './trains';
import { sunVector } from '../sun';
import { v3, ribbon, merge, flatShape, routeY } from './geometry';
import { LIGHT_PALETTE, type Palette } from './palette';

export type RailState = 'highlight' | 'context' | 'hidden';
export interface SceneMode {
  rails: { lrt: RailState; ktm: RailState; erl: RailState };
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
}
export const DEFAULT_MODE: SceneMode = {
  rails: { lrt: 'context', ktm: 'context', erl: 'context' },
  footways: 'hidden', routeSet: 'none', routeFocus: null, walkFocus: null, routeStyle: 'plain', sun: null, shadeDots: false, muteWater: false, xray: false,
  buildingStyle: 'default', threshold: 60, precincts: false, landmarks: false, airport: false,
};

export interface ModelOptions { palette?: Palette }
export interface UpdateOptions {
  /** prefers-reduced-motion: trains stand still at their stations, routes are drawn at once */
  reducedMotion?: boolean;
  /** e.g. document.hidden: the train clock does not advance */
  paused?: boolean;
}

const H = meta.halfSizeM;
const col = (c: string) => new THREE.Color(c || '#ff00ff');

interface BMesh { data: Building; mesh: THREE.Mesh; edges: THREE.LineSegments; key: boolean }

export class MapModel {
  /** Root of the model (lights included); add it to your scene. */
  readonly group = new THREE.Group();
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
    rail: { lrt: new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }), ktm: new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide }), ktm2: new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide }), erl: new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide }) },
    pier: new THREE.MeshLambertMaterial(),
    foot: new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide }), footBridge: new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide }),
    route: new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true }),
    routeDim: new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, opacity: 0.3 }),
    precinct: new THREE.LineDashedMaterial({ dashSize: 8, gapSize: 6, transparent: true, opacity: 0.7 }),
    frame: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.35 }),
    landmark: new THREE.MeshLambertMaterial(),
    podium: new THREE.MeshLambertMaterial(), // block a landmark stands on (Overview)
  };
  private railGroups: Record<'lrt' | 'ktm' | 'erl', THREE.Group> = { lrt: new THREE.Group(), ktm: new THREE.Group(), erl: new THREE.Group() };
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
  /** LRT tracks (one chain per direction) and the animated trainsets on them. */
  lrtTracks: Track[] = [];
  trains!: Trains;
  /** KTM Komuter tracks (two per line, oriented for left-hand running), their line (1 / 2), and the trainsets on them. */
  ktmTracks: Track[] = []; ktmTrackLine: (1 | 2)[] = [];
  ktmTrains!: Trains;
  /** 02: suspended KL Sentral–Terminal Skypark Line (10), a thin dashed ribbon offset beside the Line 2 track; no trains. */
  private skypark: THREE.Mesh | null = null;
  private erlColors = { base: new THREE.Color(), klia: new THREE.Color() };
  private trainsOn = true;
  private landmarkGroup = new THREE.Group(); // landmark blocks outside the study square (shown with mode.landmarks)

  constructor(opts: ModelOptions = {}) {
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

    const major = new Set(['motorway', 'trunk', 'primary', 'secondary']);
    const roadG = (sel: boolean, y: number) => merge(lines.roads.filter((r) => major.has(r.cls) === sel && !r.tunnel).map((r) => ribbon(r.pts.map(([x, n]) => v3(x, n, y)), r.w)));
    this.group.add(new THREE.Mesh(roadG(false, 0.06), this.mats.road));
    this.group.add(new THREE.Mesh(roadG(true, 0.08), this.mats.roadMajor));

    // KTM: per Komuter line, the OSM main-track ways chained into one continuous track per direction (left-hand
    // running), at the drawn deck height with 4 % approach ramps to the bridges (schematic); tunnel stretches carry trains but are not drawn.
    const ktmDeck = (r: Rail) => (r.elevated ? 6 + Math.max(0, r.layer - 1) * 3 : 0.35);
    const ktmChained = new Set<Rail>();
    for (const line of [1, 2] as const) {
      const st = station(line === 1 ? 'KB01' : 'KD01');
      const chains = chainWaysAnyDir(lines.rails.filter((r) => r.line === 'ktm' && r.route === line));
      for (const c of chains) for (const w of c.src) ktmChained.add(w);
      for (const ch of orientLeftHand(chains.map((c) => c.chain))) { this.ktmTracks.push(buildTrack(ch, ktmDeck, st ? st.c : null, { smoothY: 8, maxGrade: 0.04, hidden: (r) => r.tunnel })); this.ktmTrackLine.push(line); }
    }
    // Station structures over the at-grade KTM tracks would hide the trains standing at the platforms: OSM
    // building=roof (an open-sided canopy) is drawn as a roof slab, and any other block over the track is drawn
    // from a 5 m clearance up (schematic, like the deck heights). Heights shown in the UI are unchanged.
    const inRing = (px: number, pn: number, ring: XY[]) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > pn) !== (yj > pn) && px < ((xj - xi) * (pn - yi)) / (yj - yi) + xi) c = !c; } return c; };
    const coversKtm = (b: Building) => {
      const xs = b.ring.map((p) => p[0]), ns = b.ring.map((p) => p[1]); const x0 = Math.min(...xs), x1 = Math.max(...xs), n0 = Math.min(...ns), n1 = Math.max(...ns);
      return this.ktmTracks.some((t) => { for (let i = t.inStart; i <= t.inEnd; i += 2) { const x = t.x[i], n = -t.z[i]; if (!t.hide[i] && x >= x0 && x <= x1 && n >= n0 && n <= n1 && inRing(x, n, b.ring)) return true; } return false; });
    };
    const KTM_CLEAR = 5, SLAB = 0.6;
    // buildings
    for (const b of buildings) {
      let base = b.minHeight;
      if (b.minHeight < KTM_CLEAR && b.height > 4.6 && coversKtm(b)) base = Math.max(b.minHeight, b.type === 'roof' ? b.height - SLAB : Math.min(KTM_CLEAR, b.height - SLAB));
      const h = Math.max(1, b.height - base);
      const shape = new THREE.Shape(b.ring.map(([x, n]) => new THREE.Vector2(x, n)));
      const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
      g.rotateX(-Math.PI / 2); g.translate(0, base, 0);
      const mesh = new THREE.Mesh(g, this.mats.build); mesh.castShadow = true; mesh.receiveShadow = true;
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g, 25), this.mats.edgeKey);
      const key = !!b.precinct || !!b.station || b.height >= 45;
      this.bmeshes.push({ data: b, mesh, edges, key });
      this.group.add(mesh, edges);
    }

    // rail
    // LRT: the OSM track ways are chained into one continuous track per direction (smoothed deck height,
    // no steps at way joins); the same tracks carry the trains.
    const lrtDeck = (r: Rail) => (r.elevated ? 9 + Math.max(0, r.layer - 2) * 1.5 : 0.35);
    const kj17 = station('KJ17');
    const lrtWays = lines.rails.filter((r) => r.line === 'lrt' && !r.tunnel);
    this.lrtTracks = chainWays(lrtWays).map((ch) => buildTrack(ch, lrtDeck, kj17 ? kj17.c : null));
    const trackPts = (tr: Track, every: number) => { const out: THREE.Vector3[] = []; for (let i = tr.inStart; i <= tr.inEnd; i += every) out.push(new THREE.Vector3(tr.x[i], tr.y[i], tr.z[i])); const e = tr.inEnd; if ((e - tr.inStart) % every) out.push(new THREE.Vector3(tr.x[e], tr.y[e], tr.z[e])); return out; };
    const pierGeo = new THREE.BoxGeometry(2.2, 1, 2.2);
    for (const line of ['lrt', 'ktm', 'erl'] as const) {
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
        const k2i = this.ktmTrackLine.indexOf(2), k2j = this.ktmTrackLine.lastIndexOf(2);
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
    this.trains = new Trains(this.lrtTracks, H);
    this.ktmTrains = new Trains(this.ktmTracks, H, KTM_TRAIN);
    this.group.add(this.trains.group, this.ktmTrains.group);

    // landmark blocks whose footprint centroid lies outside the study square (full OSM outline, not clipped)
    for (const l of landmarks.filter((l) => !l.buildingId)) {
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
    for (const p of areas.precincts.filter((p) => p.name === 'KL Eco City')) {
      const l = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(p.ring.map(([x, n]) => v3(x, n, 0.5))), this.mats.precinct);
      l.computeLineDistances(); this.precinctGroup.add(l);
    }
    this.group.add(this.precinctGroup);
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
    m.zone.eco.color = col(p.zone.eco); m.zone.gardens.color = col(p.zone.gardens); m.zone.midvalley.color = col(p.zone.midvalley);
    m.rainCovered.color = col(p.covered); m.rainOpen.color = col(p.open); m.walker.color = col(p.route); m.dots.color = new THREE.Color(1, 1, 1);
    const edge = col(p.edge);
    for (const e of [m.edgeKey, m.edgeContext, m.edgeFade, m.precinct, m.frame]) e.color = edge;
    m.edgeKey.opacity = p.edgeOpacity;
    m.edgeContext.opacity = p.edgeContextOpacity;
    m.rail.lrt.color = col(p.rail.lrt); m.rail.ktm.color = col(p.rail.ktm1); m.rail.ktm2.color = col(p.rail.ktm2); m.rail.erl.color = col(p.rail.erl); this.erlColors.base.copy(col(p.rail.erl)); this.erlColors.klia.copy(col(p.rail.kliaTransit)); if (this.mode) m.rail.erl.color.copy(this.mode.airport ? this.erlColors.klia : this.erlColors.base); if (this.skypark) (this.skypark.material as THREE.MeshBasicMaterial).color = col(p.rail.skypark);
    m.foot.color = col(p.footway); m.footBridge.color = col(p.footbridge);
    m.landmark.color = col(p.landmark); m.podium.color = col(p.podium);
    this.trains.setColors(col(p.train.body), col(p.train.window), col(p.train.accent), edge, p.edgeOpacity * 0.85);
    this.ktmTrains.setTrackColors(this.ktmTrackLine.map((l) => col(l === 1 ? p.rail.ktm1 : p.rail.ktm2)));
    this.ktmTrains.setColors(col(p.train.body), col(p.train.window), col(p.train.accent), edge, p.edgeOpacity * 0.85);
    m.route.color = col(p.route); m.routeDim.color = col(p.route);
    this.hemiBase = p.light.hemi; this.hemi.groundColor = col(p.light.hemiGround);
    this.sunBase = p.light.sun;
    this.setMode({});
  }

  // ---------- modes ----------
  setMode(patch: Partial<SceneMode>) {
    const prev = this.mode;
    this.mode = { ...this.mode, ...patch, rails: { ...this.mode.rails, ...(patch.rails || {}) } };
    const md = this.mode; const m = this.mats;
    for (const b of this.bmeshes) {
      let mat: THREE.Material = b.key ? m.build : m.context; let em: THREE.LineBasicMaterial = b.key ? m.edgeKey : m.edgeContext;
      if (md.buildingStyle === 'source') { mat = m.src[b.data.heightSource]; em = m.edgeKey; }
      else if (md.buildingStyle === 'zone') { mat = b.data.zone ? m.zone[b.data.zone] : m.context; em = b.data.zone ? m.edgeKey : m.edgeContext; }
      else if (md.buildingStyle === 'threshold') { const on = b.data.height >= md.threshold; mat = on ? m.build : m.fade; em = on ? m.edgeKey : m.edgeFade; }
      if (md.landmarks && b.data.landmark) { mat = m.landmark; em = m.edgeKey; }
      if (md.landmarks && b.data.podiumFor) { mat = m.podium; em = m.edgeKey; }
      if (md.xray) { mat = m.xray; em = b.key ? m.edgeContext : m.edgeFade; }
      b.mesh.material = mat; b.edges.material = em;
      b.mesh.castShadow = !md.xray;
    }
    for (const line of ['lrt', 'ktm', 'erl'] as const) {
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
    this.trains.group.visible = this.trainsOn && md.rails.lrt !== 'hidden';
    this.ktmTrains.group.visible = this.trainsOn && md.rails.ktm !== 'hidden';
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
    for (const tr of [this.trains, this.ktmTrains]) {
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
