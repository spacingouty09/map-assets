// Three.js world: block massing, ground layers, rail, footways, routes, camera flights.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildings, lines, areas, routes, meta, type XY, type Building, type HeightSource } from './data';

export interface View { target: [number, number, number]; azimuth: number; polar: number; distance: number }
export type RailState = 'highlight' | 'context' | 'hidden';
export interface SceneMode {
  rails: { lrt: RailState; ktm: RailState; erl: RailState };
  footways: 'hidden' | 'faint' | 'show';
  routes: boolean;
  routeFocus: number | null;
  xray: boolean;
  buildingStyle: 'default' | 'source' | 'threshold';
  threshold: number;
  precincts: boolean;
}
export const DEFAULT_MODE: SceneMode = {
  rails: { lrt: 'context', ktm: 'context', erl: 'context' },
  footways: 'hidden', routes: false, routeFocus: null, xray: false,
  buildingStyle: 'default', threshold: 60, precincts: false,
};

const STAGE_W = 1920, STAGE_H = 1080;
const VIEW_SHIFT_X = 155; // shift the model right so the left text column stays clear
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
    src: { osm: new THREE.MeshLambertMaterial(), levels: new THREE.MeshLambertMaterial(), estimate: new THREE.MeshLambertMaterial() } as Record<HeightSource, THREE.MeshLambertMaterial>,
    edgeKey: new THREE.LineBasicMaterial({ transparent: true }), edgeContext: new THREE.LineBasicMaterial({ transparent: true }),
    edgeFade: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.08 }),
    rail: { lrt: new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide }), ktm: new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide }), erl: new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide }) },
    pier: new THREE.MeshLambertMaterial(),
    foot: new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide }), footBridge: new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide }),
    route: new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true }),
    routeDim: new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, opacity: 0.3 }),
    precinct: new THREE.LineDashedMaterial({ dashSize: 8, gapSize: 6, transparent: true, opacity: 0.7 }),
    frame: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.35 }),
  };
  private railGroups: Record<'lrt' | 'ktm' | 'erl', THREE.Group> = { lrt: new THREE.Group(), ktm: new THREE.Group(), erl: new THREE.Group() };
  private footGroup = new THREE.Group();
  private routeMeshes: THREE.Mesh[] = [];
  private routeDrawStart = 0;
  private precinctGroup = new THREE.Group();
  private tween: { from: View; to: View; t0: number; dur: number } | null = null;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(STAGE_W, STAGE_H, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(28, STAGE_W / STAGE_H, 20, 9000);
    this.camera.setViewOffset(STAGE_W, STAGE_H, -VIEW_SHIFT_X, 0, STAGE_W, STAGE_H);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.08, minPolarAngle: 0.12, maxPolarAngle: 1.3, minDistance: 220, maxDistance: 3000, screenSpacePanning: false, panSpeed: 0.6, rotateSpeed: 0.6, zoomSpeed: 0.8 });
    this.controls.addEventListener('start', () => { this.tween = null; this.onUserInteract?.(); });
    this.controls.addEventListener('change', () => {
      const t = this.controls.target; t.x = THREE.MathUtils.clamp(t.x, -H - 50, H + 50); t.z = THREE.MathUtils.clamp(t.z, -H - 50, H + 50); t.y = THREE.MathUtils.clamp(t.y, 0, 120);
    });

    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.sun.position.set(-420, 900, -380);
    this.sun.castShadow = true;
    Object.assign(this.sun.shadow.camera, { left: -720, right: 720, top: 720, bottom: -720, near: 50, far: 2600 });
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

    // buildings
    for (const b of buildings) {
      const h = Math.max(1, b.height - b.minHeight);
      const shape = new THREE.Shape(b.ring.map(([x, n]) => new THREE.Vector2(x, n)));
      const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
      g.rotateX(-Math.PI / 2); g.translate(0, b.minHeight, 0);
      const mesh = new THREE.Mesh(g, this.mats.build); mesh.castShadow = true; mesh.receiveShadow = true;
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g, 25), this.mats.edgeKey);
      const key = !!b.precinct || !!b.station || b.height >= 45;
      this.bmeshes.push({ data: b, mesh, edges, key });
      this.scene.add(mesh, edges);
    }

    // rail
    const pierGeo = new THREE.BoxGeometry(2.2, 1, 2.2);
    for (const line of ['lrt', 'ktm', 'erl'] as const) {
      const grp = this.railGroups[line];
      const rs = lines.rails.filter((r) => r.line === line && !r.tunnel);
      const deckY = (r: (typeof rs)[number]) => (r.elevated ? (line === 'lrt' ? 9 + Math.max(0, r.layer - 2) * 1.5 : 6 + Math.max(0, r.layer - 1) * 3) : 0.35);
      grp.add(new THREE.Mesh(merge(rs.map((r) => ribbon(r.pts.map(([x, n]) => v3(x, n, deckY(r))), line === 'lrt' ? 3.2 : 2.6))), this.mats.rail[line]));
      // piers under elevated track every ~32 m
      const piers: THREE.Vector3[] = [];
      for (const r of rs.filter((r) => r.elevated)) {
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

    // footways
    const fy = (f: { bridge: boolean; layer: number; indoor: boolean }) => (f.bridge ? 5 + Math.max(0, f.layer - 1) * 3 : f.layer > 0 ? 5 + (f.layer - 1) * 3 : 0.22);
    this.footGroup.add(new THREE.Mesh(merge(lines.footways.filter((f) => !f.bridge).map((f) => ribbon(f.pts.map(([x, n]) => v3(x, n, fy(f))), 1.4))), this.mats.foot));
    this.footGroup.add(new THREE.Mesh(merge(lines.footways.filter((f) => f.bridge).map((f) => ribbon(f.pts.map(([x, n]) => v3(x, n, fy(f))), 2.4))), this.mats.footBridge));
    this.scene.add(this.footGroup);

    // routes (one mesh per leg; vertices ordered along the path for draw-on)
    const ry = (layer: number) => (layer >= 1 ? 5.5 + (layer - 1) * 3.5 : layer < 0 ? 0.7 : 1.2);
    for (const r of routes) {
      const pts: THREE.Vector3[] = [];
      for (const s of r.segments) for (const [x, n] of s.pts) { const p = v3(x, n, ry(s.layer)); const last = pts[pts.length - 1]; if (!last || last.distanceToSquared(p) > 0.01) pts.push(p); }
      const g = ribbon(pts, 5) || new THREE.BufferGeometry();
      const m = new THREE.Mesh(g, this.mats.route); m.renderOrder = 10; m.userData.count = g.index ? g.index.count : 0;
      this.routeMeshes.push(m); this.scene.add(m);
    }

    // precinct outlines (KL Eco City, Mid Valley City)
    for (const p of areas.precincts.filter((p) => p.name === 'KL Eco City' || p.name === 'Mid Valley City')) {
      const l = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(p.ring.map(([x, n]) => v3(x, n, 0.5))), this.mats.precinct);
      l.computeLineDistances(); this.precinctGroup.add(l);
    }
    this.scene.add(this.precinctGroup);
  }

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
    m.src.osm.color = cssColor('--src-osm'); m.src.levels.color = cssColor('--src-levels'); m.src.estimate.color = cssColor('--src-estimate');
    const edge = cssColor('--scene-edge');
    for (const e of [m.edgeKey, m.edgeContext, m.edgeFade, m.precinct, m.frame]) e.color = edge;
    m.edgeKey.opacity = parseFloat(cssVar('--scene-edge-opacity')) || 0.5;
    m.edgeContext.opacity = parseFloat(cssVar('--scene-edge-context-opacity')) || 0.2;
    m.rail.lrt.color = cssColor('--c-lrt'); m.rail.ktm.color = cssColor('--c-ktm'); m.rail.erl.color = cssColor('--c-erl');
    m.foot.color = cssColor('--grey-2'); m.footBridge.color = cssColor('--ink');
    m.route.color = cssColor('--c-route'); m.routeDim.color = cssColor('--c-route');
    const dark = document.documentElement.dataset.theme === 'dark';
    this.hemi.intensity = dark ? 1.6 : 2.4; this.hemi.groundColor = new THREE.Color(dark ? 0x202020 : 0xbdbdb8);
    this.sun.intensity = dark ? 1.1 : 1.5;
    this.setMode({});
  }

  // ---------- modes ----------
  setMode(patch: Partial<SceneMode>) {
    const prevRoutes = this.mode.routes;
    this.mode = { ...this.mode, ...patch, rails: { ...this.mode.rails, ...(patch.rails || {}) } };
    const md = this.mode; const m = this.mats;
    for (const b of this.bmeshes) {
      let mat: THREE.Material = b.key ? m.build : m.context; let em: THREE.LineBasicMaterial = b.key ? m.edgeKey : m.edgeContext;
      if (md.buildingStyle === 'source') { mat = m.src[b.data.heightSource]; em = m.edgeKey; }
      else if (md.buildingStyle === 'threshold') { const on = b.data.height >= md.threshold; mat = on ? m.build : m.fade; em = on ? m.edgeKey : m.edgeFade; }
      if (md.xray) { mat = m.xray; em = b.key ? m.edgeContext : m.edgeFade; }
      b.mesh.material = mat; b.edges.material = em;
      b.mesh.castShadow = !md.xray;
    }
    for (const line of ['lrt', 'ktm', 'erl'] as const) {
      const st = md.rails[line]; const grp = this.railGroups[line];
      grp.visible = st !== 'hidden';
      m.rail[line].opacity = st === 'highlight' ? 1 : 0.35;
    }
    this.footGroup.visible = md.footways !== 'hidden';
    m.foot.opacity = md.footways === 'show' ? 0.85 : 0.35; m.footBridge.opacity = md.footways === 'show' ? 0.95 : 0.4;
    this.routeMeshes.forEach((r, i) => { r.visible = md.routes; r.material = md.routeFocus == null || md.routeFocus === i ? m.route : m.routeDim; });
    if (md.routes && !prevRoutes) this.routeDrawStart = performance.now();
    this.precinctGroup.visible = md.precincts;
  }

  // ---------- camera ----------
  currentView(): View {
    const off = this.camera.position.clone().sub(this.controls.target); const s = new THREE.Spherical().setFromVector3(off);
    const t = this.controls.target; return { target: [t.x, t.y, t.z], azimuth: s.theta, polar: s.phi, distance: s.radius };
  }
  flyTo(view: View, instant = prefersReducedMotion()) {
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
    return { x: (v.x * 0.5 + 0.5) * STAGE_W, y: (-v.y * 0.5 + 0.5) * STAGE_H, visible: v.z < 1 && v.z > -1 };
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
  setPixelRatio(stageScale: number) { this.renderer.setPixelRatio(Math.min(2, Math.max(1, window.devicePixelRatio * stageScale))); this.renderer.setSize(STAGE_W, STAGE_H, false); }

  private frame(now: number) {
    this.stepTween(now);
    if (!this.tween) this.controls.update();
    // route draw-on
    const k = prefersReducedMotion() ? 1 : Math.min(1, (now - this.routeDrawStart) / 2600);
    const total = this.routeMeshes.length;
    this.routeMeshes.forEach((r, i) => {
      const local = THREE.MathUtils.clamp(k * total - i, 0, 1); const count = r.userData.count as number;
      r.geometry.setDrawRange(0, Math.floor((count * local) / 6) * 6);
    });
    this.renderer.render(this.scene, this.camera);
    for (const f of this.onFrame) f();
  }
}
