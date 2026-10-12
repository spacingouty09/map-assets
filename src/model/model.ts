// Three.js world: block massing, ground layers, rail, footways, routes, camera flights.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildings, lines, areas, routes, walks, meta, landmarks, station, type XY, type Building, type HeightSource, type Route, type Zone, type Rail } from './data';
import { chainWays, chainWaysAnyDir, orientLeftHand, buildTrack, Trains, KTM_TRAIN, type Track } from './trains';
import { sunVector } from './sun';

export interface View { target: [number, number, number]; azimuth: number; polar: number; distance: number }
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
}
export const DEFAULT_MODE: SceneMode = {
  rails: { lrt: 'context', ktm: 'context', erl: 'context' },
  footways: 'hidden', routeSet: 'none', routeFocus: null, walkFocus: null, routeStyle: 'plain', sun: null, shadeDots: false, muteWater: false, xray: false,
  buildingStyle: 'default', threshold: 60, precincts: false, landmarks: false,
};

const DESK_W = 1920, DESK_H = 1080; // desktop stage; mobile uses the real viewport size (setStageSize)
const H = meta.halfSizeM;
const v3 = (x: number, north: number, y = 0) => new THREE.Vector3(x, y, -north);
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const cssColor = (name: string) => new THREE.Color(cssVar(name) || '#ff00ff');
export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Flat ribbon along a 3D polyline (width measured horizontally).
function ribbon(pts: THREE.Vector3[], width: number): THREE.BufferGeometry | null {
  const n = pts.length; if (n < 2) return null;
  const pos = new Float32Array(n * 6); const nor = new Float32Array(n * 6); const idx: number[] = [];
  const dir = (a: THREE.Vector3, b: THREE.Vector3) => { const d = new THREE.Vector2(b.x - a.x, b.z - a.z); return d.lengthSq() > 1e-9 ? d.normalize() : new THREE.Vector2(1, 0); };
  for (let i = 0; i < n; i++) {
    const dPrev = i > 0 ? dir(pts[i - 1], pts[i]) : null; const dNext = i < n - 1 ? dir(pts[i], pts[i + 1]) : null;
    const t = dPrev && dNext ? dPrev.clone().add(dNext) : (dPrev || dNext)!.clone();
    if (t.lengthSq() < 1e-6) t.copy((dNext || dPrev)!); t.normalize();
    const perp = new THREE.Vector2(-t.y, t.x);
    const ref = dNext || dPrev!; const segPerp = new THREE.Vector2(-ref.y, ref.x);
    const scale = 1 / Math.max(0.35, Math.abs(perp.dot(segPerp)));
    const hw = (width / 2) * scale; const p = pts[i];
    pos.set([p.x + perp.x * hw, p.y, p.z + perp.y * hw, p.x - perp.x * hw, p.y, p.z - perp.y * hw], i * 6);
    nor.set([0, 1, 0, 0, 1, 0], i * 6);
    if (i < n - 1) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setIndex(idx);
  return g;
}
const merge = (gs: (THREE.BufferGeometry | null)[]) => { const ok = gs.filter((g): g is THREE.BufferGeometry => !!g); for (const g of ok) { g.deleteAttribute('uv'); if (!g.index) g.setIndex([...Array(g.getAttribute('position').count).keys()]); } return ok.length ? mergeGeometries(ok, false) : new THREE.BufferGeometry(); };
const flatShape = (ring: XY[], y: number) => { const g = new THREE.ShapeGeometry(new THREE.Shape(ring.map(([x, n]) => new THREE.Vector2(x, n)))); g.rotateX(-Math.PI / 2); g.translate(0, y, 0); return g; };

interface BMesh { data: Building; mesh: THREE.Mesh; edges: THREE.LineSegments; key: boolean }

export class World {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  mode: SceneMode = structuredClone(DEFAULT_MODE);
  onFrame: (() => void)[] = [];
  onUserInteract: (() => void) | null = null;
  keyNames = new Set<string>();

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
  /** Horizontal shift (stage px) of the projection centre, so the model sits in the area left free by the panels. */
  private viewShift = 104; private viewShiftTarget = 104;
  private viewShiftY = 0; private viewShiftYTarget = 0;
  private stageW = DESK_W; private stageH = DESK_H; private distScale = 1;
  private precinctGroup = new THREE.Group();
  private tween: { from: View; to: View; t0: number; dur: number } | null = null;
  /** LRT tracks (one chain per direction) and the animated trainsets on them. */
  lrtTracks: Track[] = [];
  trains!: Trains;
  /** KTM Komuter tracks (two per line, oriented for left-hand running), their line (1 / 2), and the trainsets on them. */
  ktmTracks: Track[] = []; ktmTrackLine: (1 | 2)[] = [];
  ktmTrains!: Trains;
  private trainsOn = true;
  private lastFrame = 0;
  // turntable (00 Overview): slow continuous orbit about the target at the preset pitch / distance. Paused while the
  // user drags / zooms (resumes TURN_RESUME_MS after they stop), during flights, while the tab is hidden, and never
  // runs under prefers-reduced-motion.
  static readonly TURN_PERIOD_S = 75; static readonly TURN_RESUME_MS = 1500;
  /** Seconds for one full turn. The dev camera GUI writes this. */
  turnPeriodS = World.TURN_PERIOD_S;
  /** +1 orbits the camera clockwise from above; -1 is anti-clockwise (chapter 00 default). */
  turnSign: 1 | -1 = -1;
  private turnOn = false; private turnHeld = false; private turnResumeAt = 0;
  private landmarkGroup = new THREE.Group(); // landmark blocks outside the study square (shown with mode.landmarks)

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(this.stageW, this.stageH, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.localClippingEnabled = true; // trains are clipped at the study-area frame
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(28, this.stageW / this.stageH, 20, 9000);
    this.applyViewOffset();
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.08, minPolarAngle: 0.12, maxPolarAngle: 1.3, minDistance: 220, maxDistance: 3000, screenSpacePanning: false, panSpeed: 0.6, rotateSpeed: 0.6, zoomSpeed: 0.8 });
    this.controls.addEventListener('start', () => { this.tween = null; this.turnHeld = true; this.onUserInteract?.(); });
    this.controls.addEventListener('end', () => { this.turnHeld = false; this.turnResumeAt = performance.now() + World.TURN_RESUME_MS; });
    this.controls.addEventListener('change', () => {
      const t = this.controls.target; t.x = THREE.MathUtils.clamp(t.x, -H - 50, H + 50); t.z = THREE.MathUtils.clamp(t.z, -H - 50, H + 50); t.y = THREE.MathUtils.clamp(t.y, 0, 120);
    });

    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.sun.position.set(-420, 900, -380);
    this.sun.castShadow = true;
    Object.assign(this.sun.shadow.camera, { left: -760, right: 760, top: 760, bottom: -760, near: 50, far: 3200 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.6; this.sun.shadow.radius = 3;

    this.build();
    this.applyTheme();
    this.setMode({});
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  // ---------- construction ----------
  private build() {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), this.mats.ground);
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; this.scene.add(ground);

    // study-area frame
    const frame = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([v3(-H, -H, 0.3), v3(H, -H, 0.3), v3(H, H, 0.3), v3(-H, H, 0.3)]), this.mats.frame);
    this.scene.add(frame);

    this.scene.add(new THREE.Mesh(merge(areas.green.map((a) => flatShape(a.ring, 0.04))), this.mats.green));
    const water = merge([
      ...areas.waterAreas.map((a) => flatShape(a.ring, 0.1)),
      ...lines.waterLines.map((w) => ribbon(w.pts.map(([x, n]) => v3(x, n, 0.09)), w.width ?? (w.kind === 'river' ? 20 : 4))),
    ]);
    this.scene.add(new THREE.Mesh(water, this.mats.water));

    const major = new Set(['motorway', 'trunk', 'primary', 'secondary']);
    const roadG = (sel: boolean, y: number) => merge(lines.roads.filter((r) => major.has(r.cls) === sel && !r.tunnel).map((r) => ribbon(r.pts.map(([x, n]) => v3(x, n, y)), r.w)));
    this.scene.add(new THREE.Mesh(roadG(false, 0.06), this.mats.road));
    this.scene.add(new THREE.Mesh(roadG(true, 0.08), this.mats.roadMajor));

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
      this.scene.add(mesh, edges);
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
      this.scene.add(grp);
    }
    // trains: LRT on the viaduct; KTM Komuter on both lines (one instanced set, livery stripe per line)
    this.trains = new Trains(this.lrtTracks, H);
    this.ktmTrains = new Trains(this.ktmTracks, H, KTM_TRAIN);
    this.scene.add(this.trains.group, this.ktmTrains.group);

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
    this.scene.add(this.landmarkGroup);

    // footways
    const fy = (f: { bridge: boolean; layer: number; indoor: boolean }) => (f.bridge ? 5 + Math.max(0, f.layer - 1) * 3 : f.layer > 0 ? 5 + (f.layer - 1) * 3 : 0.22);
    this.footGroup.add(new THREE.Mesh(merge(lines.footways.filter((f) => !f.bridge).map((f) => ribbon(f.pts.map(([x, n]) => v3(x, n, fy(f))), 1.4))), this.mats.foot));
    this.footGroup.add(new THREE.Mesh(merge(lines.footways.filter((f) => f.bridge).map((f) => ribbon(f.pts.map(([x, n]) => v3(x, n, fy(f))), 2.4))), this.mats.footBridge));
    this.scene.add(this.footGroup);
    // footways coloured by shelter (chapter 08)
    this.footRain.add(new THREE.Mesh(merge(lines.footways.filter((f) => f.sheltered).map((f) => ribbon(f.pts.map(([x, n]) => v3(x, n, fy(f) + 0.05)), f.bridge ? 2.6 : 2))), this.mats.rainCovered));
    this.footRain.add(new THREE.Mesh(merge(lines.footways.filter((f) => !f.sheltered).map((f) => ribbon(f.pts.map(([x, n]) => v3(x, n, fy(f) + 0.05)), f.bridge ? 2.6 : 2))), this.mats.rainOpen));
    this.scene.add(this.footRain);

    // routes: one mesh per route; vertices ordered along the path for draw-on
    const pathOf = (r: Route) => {
      const pts: THREE.Vector3[] = [];
      for (const s of r.segments) for (const [x, n] of s.pts) { const p = v3(x, n, World.routeY(s.layer)); const last = pts[pts.length - 1]; if (!last || last.distanceToSquared(p) > 0.01) pts.push(p); }
      return pts;
    };
    const routeMesh = (r: Route, width: number) => {
      const pts = pathOf(r); const g = ribbon(pts, width) || new THREE.BufferGeometry();
      const m = new THREE.Mesh(g, this.mats.route); m.renderOrder = 10; m.userData.count = g.index ? g.index.count : 0;
      const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
      m.userData.pts = pts; m.userData.cum = cum; m.userData.length = cum[cum.length - 1];
      this.scene.add(m); return m;
    };
    for (const r of routes) this.routeMeshes.push(routeMesh(r, 5));
    for (const r of [...routes, ...walks]) {
      if (!this.walkMeshes.has(r.id) && walks.includes(r)) this.walkMeshes.set(r.id, routeMesh(r, 5.5));
      const grp = new THREE.Group();
      for (const [cov, mat] of [[true, this.mats.rainCovered], [false, this.mats.rainOpen]] as const) {
        const m = new THREE.Mesh(merge(r.segments.filter((sg) => sg.sheltered === cov).map((sg) => ribbon(sg.pts.map(([x, n]) => v3(x, n, World.routeY(sg.layer) + 0.1)), 6))), mat);
        m.renderOrder = 11; grp.add(m);
      }
      this.rainGroups.set(r.id, grp); this.scene.add(grp);
    }
    this.walker.renderOrder = 12; this.scene.add(this.walker);

    // precinct outline (KL Eco City; the Mid Valley City polygon is not drawn: the Mid Valley precinct is the Megamall itself)
    for (const p of areas.precincts.filter((p) => p.name === 'KL Eco City')) {
      const l = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(p.ring.map(([x, n]) => v3(x, n, 0.5))), this.mats.precinct);
      l.computeLineDistances(); this.precinctGroup.add(l);
    }
    this.scene.add(this.precinctGroup);
  }

  static routeY(layer: number) { return layer >= 1 ? 5.5 + (layer - 1) * 3.5 : layer < 0 ? 0.7 : 1.2; }

  // ---------- shade sampling (chapter 07) ----------
  /** Show sample points as small squares (colours set by setShadeResult). */
  setShadeSamples(pts: THREE.Vector3[]) {
    if (this.dots) { this.scene.remove(this.dots); this.dots.dispose(); }
    const g = new THREE.PlaneGeometry(2.6, 2.6); g.rotateX(-Math.PI / 2);
    this.dots = new THREE.InstancedMesh(g, this.mats.dots, Math.max(1, pts.length)); const m = new THREE.Matrix4();
    pts.forEach((p, i) => { m.makeTranslation(p.x, p.y - 1.3, p.z); this.dots!.setMatrixAt(i, m); this.dots!.setColorAt(i, new THREE.Color(1, 1, 1)); });
    this.dots.count = pts.length; this.dots.renderOrder = 9; this.dots.visible = this.mode.shadeDots; this.scene.add(this.dots);
  }
  /** For each sample, true when a building blocks the ray towards the sun. */
  shadeTest(pts: THREE.Vector3[], altitude: number, azimuth: number): boolean[] {
    if (altitude <= 0) return pts.map(() => true);
    const dir = new THREE.Vector3(...sunVector(altitude, azimuth)); const rc = new THREE.Raycaster(); rc.far = 2500;
    const meshes = this.bmeshes.map((b) => b.mesh);
    return pts.map((p) => { rc.set(p, dir); return rc.intersectObjects(meshes, false).length > 0; });
  }
  setShadeResult(shaded: boolean[]) {
    if (!this.dots) return; const lit = cssColor('--c-amber'), sh = cssColor('--c-shade');
    shaded.forEach((s, i) => this.dots!.setColorAt(i, s ? sh : lit)); if (this.dots.instanceColor) this.dots.instanceColor.needsUpdate = true;
  }
  /** Centre the projection on the free area between visible panels (stage px, + = right). */
  setViewShift(px: number, instant = prefersReducedMotion(), py = 0) {
    this.viewShiftTarget = px; this.viewShiftYTarget = py;
    if (instant) { this.viewShift = px; this.viewShiftY = py; this.applyViewOffset(); }
  }
  private applyViewOffset() { this.camera.setViewOffset(this.stageW, this.stageH, -this.viewShift, -this.viewShiftY, this.stageW, this.stageH); }
  /** Stage size in CSS px: 1920x1080 on desktop (the stage is scaled to fit), the real viewport on mobile. */
  setStageSize(w: number, h: number) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    if (w === this.stageW && h === this.stageH) return;
    this.stageW = w; this.stageH = h; this.camera.aspect = w / h; this.renderer.setSize(w, h, false); this.applyViewOffset();
  }
  get stageSize() { return { w: this.stageW, h: this.stageH }; }
  /** Mobile framing: every chapter preset (and any flyTo view) is pulled back by this factor so its subject fits a
   *  narrow / portrait screen. 1 on desktop. */
  setDistanceScale(k: number) {
    if (Math.abs(k - this.distScale) < 1e-3) return;
    const prev = this.distScale; this.distScale = k; this.controls.maxDistance = 3000 * Math.max(1, k);
    if (!this.tween) { const v = this.currentView(); this.applyView({ ...v, distance: (v.distance * k) / prev }); }
    else this.tween.to = { ...this.tween.to, distance: (this.tween.to.distance * k) / prev };
  }
  private scaled(v: View): View { return this.distScale === 1 ? v : { ...v, distance: v.distance * this.distScale }; }
  /** Restart the draw-on animation of the visible walking route. */
  replayWalk() { this.walkDrawStart = performance.now(); }

  // ---------- theme ----------
  applyTheme() {
    const bg = cssColor('--scene-bg');
    this.scene.background = bg;
    this.scene.fog = new THREE.Fog(bg, 2200, 5200);
    const m = this.mats;
    m.ground.color = cssColor('--scene-ground');
    m.road.color = cssColor('--scene-road'); m.roadMajor.color = cssColor('--scene-road-major');
    m.water.color = cssColor('--c-water'); m.green.color = cssColor('--c-green');
    m.build.color = cssColor('--scene-building'); m.context.color = cssColor('--scene-building-context');
    m.fade.color = cssColor('--scene-building-context'); m.xray.color = cssColor('--scene-building');
    m.pier.color = cssColor('--scene-building-context');
    m.src.osm.color = cssColor('--src-osm'); m.src.levels.color = cssColor('--src-levels'); m.src.estimate.color = cssColor('--src-estimate'); m.src.cited.color = cssColor('--src-cited');
    m.zone.eco.color = cssColor('--z-eco'); m.zone.gardens.color = cssColor('--z-gardens'); m.zone.midvalley.color = cssColor('--z-midvalley');
    m.rainCovered.color = cssColor('--c-covered'); m.rainOpen.color = cssColor('--c-open'); m.walker.color = cssColor('--c-route'); m.dots.color = new THREE.Color(1, 1, 1);
    const edge = cssColor('--scene-edge');
    for (const e of [m.edgeKey, m.edgeContext, m.edgeFade, m.precinct, m.frame]) e.color = edge;
    m.edgeKey.opacity = parseFloat(cssVar('--scene-edge-opacity')) || 0.5;
    m.edgeContext.opacity = parseFloat(cssVar('--scene-edge-context-opacity')) || 0.2;
    m.rail.lrt.color = cssColor('--c-lrt'); m.rail.ktm.color = cssColor('--c-ktm1'); m.rail.ktm2.color = cssColor('--c-ktm2'); m.rail.erl.color = cssColor('--c-erl');
    m.foot.color = cssColor('--grey-2'); m.footBridge.color = cssColor('--ink');
    m.landmark.color = cssColor('--landmark'); m.podium.color = cssColor('--podium');
    this.trains.setColors(cssColor('--train-body'), cssColor('--train-window'), cssColor('--train-accent'), edge, (parseFloat(cssVar('--scene-edge-opacity')) || 0.5) * 0.85);
    this.ktmTrains.setTrackColors(this.ktmTrackLine.map((l) => cssColor(l === 1 ? '--c-ktm1' : '--c-ktm2')));
    this.ktmTrains.setColors(cssColor('--train-body'), cssColor('--train-window'), cssColor('--train-accent'), edge, (parseFloat(cssVar('--scene-edge-opacity')) || 0.5) * 0.85);
    m.route.color = cssColor('--c-route'); m.routeDim.color = cssColor('--c-route');
    const dark = document.documentElement.dataset.theme === 'dark';
    this.hemiBase = dark ? 1.6 : 2.4; this.hemi.groundColor = new THREE.Color(dark ? 0x202020 : 0xbdbdb8);
    this.sunBase = dark ? 1.1 : 1.5;
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
    m.water.color = cssColor(md.muteWater ? '--scene-water-muted' : '--c-water');
    this.precinctGroup.visible = md.precincts;
    this.landmarkGroup.visible = md.landmarks;
    this.trains.group.visible = this.trainsOn && md.rails.lrt !== 'hidden';
    this.ktmTrains.group.visible = this.trainsOn && md.rails.ktm !== 'hidden';
  }

  // ---------- trains ----------
  /** Show or hide the animated LRT and KTM trainsets (scene life; user toggle). */
  setTrains(on: boolean) { this.trainsOn = on; this.setMode({}); }
  get trainsVisible() { return this.trainsOn; }

  // ---------- camera ----------
  currentView(): View {
    const off = this.camera.position.clone().sub(this.controls.target); const s = new THREE.Spherical().setFromVector3(off);
    const t = this.controls.target; return { target: [t.x, t.y, t.z], azimuth: s.theta, polar: s.phi, distance: s.radius };
  }
  /** Start / stop the 00 turntable orbit (it starts from wherever the camera is once any flight has landed). */
  setTurntable(on: boolean) { this.turnOn = on; this.turnHeld = false; this.turnResumeAt = 0; }
  get turntableOn() { return this.turnOn; }
  /** True while the turntable is actually advancing the bearing this frame. */
  turntableActive(now = performance.now()) { return this.turnOn && !this.tween && !this.turnHeld && now >= this.turnResumeAt && !document.hidden && !prefersReducedMotion(); }
  private stepTurntable(now: number, dt: number) {
    if (!this.turntableActive(now)) return;
    const off = this.camera.position.clone().sub(this.controls.target); const s = new THREE.Spherical().setFromVector3(off);
    s.theta += this.turnSign * (Math.PI * 2 / this.turnPeriodS) * Math.min(dt, 0.1); // clamped: no jump after a stall / hidden tab
    this.camera.position.copy(this.controls.target).add(off.setFromSpherical(s)); this.camera.lookAt(this.controls.target);
  }
  /** True while a camera flight (chapter preset / reset) is animating. */
  isFlying() { return this.tween != null; }
  /** Whether the camera is near a view: target within 8 m, bearing / tilt within ~2°, distance within 4 %. */
  isNear(v: View, ignoreBearing = false) {
    v = this.scaled(v); const c = this.currentView();
    const dAz = ignoreBearing ? 0 : Math.abs(Math.atan2(Math.sin(c.azimuth - v.azimuth), Math.cos(c.azimuth - v.azimuth)));
    return Math.hypot(c.target[0] - v.target[0], c.target[1] - v.target[1], c.target[2] - v.target[2]) < 8 && dAz < 0.035 && Math.abs(c.polar - v.polar) < 0.035 && Math.abs(Math.log(c.distance / v.distance)) < 0.04;
  }
  flyTo(view: View, instant = prefersReducedMotion()) {
    view = this.scaled(view);
    if (instant) { this.tween = null; this.applyView(view); return; }
    this.tween = { from: this.currentView(), to: view, t0: performance.now(), dur: 1900 };
  }
  private applyView(v: View) {
    const target = new THREE.Vector3(...v.target);
    const off = new THREE.Vector3().setFromSpherical(new THREE.Spherical(v.distance, v.polar, v.azimuth));
    this.controls.target.copy(target); this.camera.position.copy(target).add(off); this.camera.lookAt(target);
  }
  private stepTween(now: number) {
    if (!this.tween) return;
    const { from, to, t0, dur } = this.tween; const k = Math.min(1, (now - t0) / dur); const e = ease(k);
    let dAz = to.azimuth - from.azimuth; dAz = Math.atan2(Math.sin(dAz), Math.cos(dAz));
    // slight lift mid-flight reads as a deliberate camera move
    const lift = Math.sin(Math.PI * e) * 0.12;
    this.applyView({
      target: [0, 1, 2].map((i) => from.target[i] + (to.target[i] - from.target[i]) * e) as [number, number, number],
      azimuth: from.azimuth + dAz * e,
      polar: Math.max(0.12, from.polar + (to.polar - from.polar) * e - lift),
      distance: Math.exp(Math.log(from.distance) + (Math.log(to.distance) - Math.log(from.distance)) * e) * (1 + lift * 0.6),
    });
    if (k >= 1) this.tween = null;
  }

  // ---------- helpers for overlays ----------
  /** Project a world point to stage pixel coordinates. */
  project(p: THREE.Vector3) {
    const v = p.clone().project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * this.stageW, y: (-v.y * 0.5 + 0.5) * this.stageH, visible: v.z < 1 && v.z > -1 };
  }
  /** Stage pixels per metre at the orbit target, measured across the screen. */
  pxPerMetre() {
    const t = this.controls.target.clone(); const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0).setY(0).normalize();
    const a = this.project(t), b = this.project(t.clone().addScaledVector(right, 100));
    return Math.hypot(b.x - a.x, b.y - a.y) / 100;
  }
  /** Screen angle (radians, clockwise from up) of geographic north at the target. */
  northAngle() {
    const t = this.controls.target.clone(); const a = this.project(t), b = this.project(t.clone().add(new THREE.Vector3(0, 0, -100)));
    return Math.atan2(b.x - a.x, -(b.y - a.y));
  }
  setPixelRatio(stageScale: number) { this.renderer.setPixelRatio(Math.min(2, Math.max(1, window.devicePixelRatio * stageScale))); this.renderer.setSize(this.stageW, this.stageH, false); }

  private frame(now: number) {
    // trains: run on a clamped clock that only advances while the page is visible;
    // with prefers-reduced-motion they are shown static (one train standing at KJ17, one at each KTM station)
    const dt = this.lastFrame ? (now - this.lastFrame) / 1000 : 0; this.lastFrame = now;
    for (const tr of [this.trains, this.ktmTrains]) {
      if (prefersReducedMotion()) tr.freeze(tr.reducedMotionClock());
      else if (!document.hidden) tr.step(dt);
      tr.update();
    }
    if (this.viewShift !== this.viewShiftTarget || this.viewShiftY !== this.viewShiftYTarget) {
      const near = Math.abs(this.viewShift - this.viewShiftTarget) <= 0.3 && Math.abs(this.viewShiftY - this.viewShiftYTarget) <= 0.3;
      if (near) { this.viewShift = this.viewShiftTarget; this.viewShiftY = this.viewShiftYTarget; }
      else { this.viewShift += (this.viewShiftTarget - this.viewShift) * 0.12; this.viewShiftY += (this.viewShiftYTarget - this.viewShiftY) * 0.12; }
      this.applyViewOffset();
    }
    this.stepTween(now);
    this.stepTurntable(now, dt);
    if (!this.tween) this.controls.update();
    // route draw-on
    const k = prefersReducedMotion() ? 1 : Math.min(1, (now - this.routeDrawStart) / 2600);
    const total = this.routeMeshes.length;
    this.routeMeshes.forEach((r, i) => {
      const local = THREE.MathUtils.clamp(k * total - i, 0, 1); const count = r.userData.count as number;
        r.geometry.setDrawRange(0, Math.floor((count * local) / 6) * 6);
    });
    for (const r of this.walkMeshes.values()) {
      if (!r.visible) continue;
      const L = r.userData.length as number; const dur = Math.max(1400, (L / 650) * 3600);
      const kw = prefersReducedMotion() ? 1 : Math.min(1, (now - this.walkDrawStart) / dur);
      const count = r.userData.count as number; r.geometry.setDrawRange(0, Math.floor((count * kw) / 6) * 6);
      // walker marker at the head of the line
      const pts = r.userData.pts as THREE.Vector3[]; const cum = r.userData.cum as number[]; const d = kw * L;
      let i = cum.findIndex((c) => c >= d); if (i <= 0) i = 1;
      const t = (d - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
      if (pts.length > 1) this.walker.position.lerpVectors(pts[i - 1], pts[i], THREE.MathUtils.clamp(t, 0, 1)).add(new THREE.Vector3(0, 1.6, 0));
    }
    this.renderer.render(this.scene, this.camera);
    for (const f of this.onFrame) f();
  }
}
