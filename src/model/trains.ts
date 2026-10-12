// Animated trainsets: LRT Kelana Jaya line (viaduct) and KTM Komuter (at grade, both lines).
// Track geometry: the OSM track ways chained into continuous tracks (one per direction),
// resampled every metre, lightly smoothed, extended beyond the study frame so trains can
// enter and leave the map edge (clipped there). Each train follows a fixed run profile:
// cruise -> brake to a stop at the station (LRT: KJ17; KTM: KB01 / KD01) -> dwell -> accelerate -> cruise.
// All trains on a track share that profile, offset by a constant headway, so they can never
// overlap. Rendering: instanced bodies / window bands / accent stripes plus one dynamic
// LineSegments for the outlines; nothing is allocated per frame.
import * as THREE from 'three';
import type { Rail, XY } from '../data';

export interface TrainSpec {
  carLen: number; carGap: number; carW: number; carH: number; floor: number; bogieInset: number; nose: number; // m
  vMax: number; accel: number; decel: number; dwell: number; headway: number; // m/s, m/s², s, s
  pattern: number[][]; // cars per train, repeating, per track
  trackOffset: number; // track k runs k × trackOffset headways after track 0 (used when `phases` is absent)
  /** per track: the first train is mid-dwell at phase × headway (overrides trackOffset) */
  phases?: number[];
  /** clock at page load (s): KTM starts with trains already on the move */
  start?: number;
  band: { y: number; h: number }; stripe: { y: number; h: number }; // window band / livery stripe, centre height above rail and height (m)
}
export const TRAIN: TrainSpec = {
  carLen: 17, carGap: 0.8, carW: 2.65, carH: 3.3, floor: 0.45, bogieInset: 2.6, nose: 1.4, // metres, illustrative proportions
  vMax: 16, accel: 1.0, decel: 1.0, dwell: 15, headway: 48, // m/s, m/s², s, s
  pattern: [[4, 2, 4], [2, 4, 4]], // cars per train, repeating, per track
  trackOffset: 0.5, // track 2 runs half a headway after track 1
  band: { y: 0.45 + 1.95 + 0.39, h: 0.78 }, stripe: { y: 0.45 + 1.3, h: 0.16 },
};
/** KTM Komuter EMU, sized after the KTM Class 92 (Wikipedia "KTM Class 92", fetched 2026-10-12: train 138.6 m / 6 cars,
 *  cars 22.8–23.7 m, width 2.75 m, height 3.905 m, floor 1.1 m, service max 120–125 km/h). Class 92 sets are 6 cars; the
 *  5-car sets are illustrative. Speed, rates, dwell and headway are illustrative (no timetable source): the real
 *  Komuter headway (tens of minutes) is compressed so a train passes every few minutes per track. */
export const KTM_TRAIN: TrainSpec = {
  carLen: 23.1, carGap: 0.9, carW: 2.75, carH: 3.0, floor: 0.9, bogieInset: 3.6, nose: 1.8,
  vMax: 20, accel: 0.8, decel: 0.8, dwell: 30, headway: 180, // 72 km/h through the cluster
  pattern: [[6, 5], [5, 6]],
  trackOffset: 0.5,
  phases: [0, 0.5, 0, 0.5], // per line: track 0 / 2 dwell together (reduced motion shows one train at each station)
  start: 20, // load just after those trains depart, with the opposite trains on their way in
  band: { y: 2.5, h: 0.8 }, stripe: { y: 1.5, h: 0.5 },
};
const EXT = 160; // m of virtual straight track beyond each map edge

/** hide: 1 where the track is in a tunnel (cars there are not drawn); elev: 1 on bridge / viaduct ways. */
export interface Track { n: number; x: Float32Array; y: Float32Array; z: Float32Array; inStart: number; inEnd: number; stop: number; hide: Uint8Array; elev: Uint8Array }

/** Join rail ways end-to-start into continuous chains (ignores crossovers / sidings). */
export function chainWays(ways: Rail[]): Rail[][] {
  const main = ways.filter((w) => !w.service);
  const near = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1;
  const used = new Set<Rail>(); const chains: Rail[][] = [];
  for (const w of main) {
    if (used.has(w) || main.some((o) => o !== w && near(o.pts[o.pts.length - 1], w.pts[0]))) continue;
    const chain = [w]; used.add(w);
    for (;;) { const last = chain[chain.length - 1]; const nx = main.find((o) => !used.has(o) && near(last.pts[last.pts.length - 1], o.pts[0])); if (!nx) break; chain.push(nx); used.add(nx); }
    chains.push(chain);
  }
  return chains;
}

/** Chain rail ways regardless of their drawn direction (ways are reversed as needed); service tracks and
 *  ways with an inferred route are left out. Returns the oriented chains (reversed ways are copies) and the source ways. */
export function chainWaysAnyDir(ways: Rail[]): { chain: Rail[]; src: Rail[] }[] {
  const main = ways.filter((w) => !w.service && !w.routeInferred);
  const near = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.5;
  const ends = (w: Rail) => [w.pts[0], w.pts[w.pts.length - 1]];
  const degree = (p: XY) => main.reduce((k, w) => k + ends(w).filter((e) => near(e, p)).length, 0);
  const used = new Set<Rail>(); const out: { chain: Rail[]; src: Rail[] }[] = [];
  for (const w0 of main) {
    if (used.has(w0)) continue;
    const startAtHead = degree(w0.pts[0]) === 1, startAtTail = degree(w0.pts[w0.pts.length - 1]) === 1;
    if (!startAtHead && !startAtTail) continue; // not a chain end (picked up from its end way)
    const chain: Rail[] = [startAtHead ? w0 : { ...w0, pts: [...w0.pts].reverse() }]; const src = [w0]; used.add(w0);
    for (;;) {
      const last = chain[chain.length - 1].pts; const tip = last[last.length - 1];
      const nx = main.find((o) => !used.has(o) && (near(o.pts[0], tip) || near(o.pts[o.pts.length - 1], tip))); if (!nx) break;
      chain.push(near(nx.pts[0], tip) ? nx : { ...nx, pts: [...nx.pts].reverse() }); src.push(nx); used.add(nx);
    }
    out.push({ chain, src });
  }
  return out;
}

/** Orient a pair of parallel chains for left-hand running: each runs with the other track on its right. */
export function orientLeftHand(chains: Rail[][]): Rail[][] {
  const pts = (ch: Rail[]) => ch.flatMap((w) => w.pts);
  const rev = (ch: Rail[]) => [...ch].reverse().map((w) => ({ ...w, pts: [...w.pts].reverse() }));
  return chains.map((ch, k) => {
    const other = chains.find((_, j) => j !== k); if (!other) return ch;
    const p = pts(ch); const op = pts(other); const i = Math.floor(p.length / 2); const a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)];
    const d = [b[0] - a[0], b[1] - a[1]]; const m = p[i];
    let best = op[0]; for (const q of op) if (Math.hypot(q[0] - m[0], q[1] - m[1]) < Math.hypot(best[0] - m[0], best[1] - m[1])) best = q;
    const v = [best[0] - m[0], best[1] - m[1]];
    return v[0] * d[1] - v[1] * d[0] > 0 ? ch : rev(ch); // v · (d rotated clockwise) > 0: other track on the right
  });
}

/** Resample a chain every metre, smooth plan (±4 m) and deck height (±smoothY m ramp, default 15; or ramps at maxGrade), extend both ends. */
export function buildTrack(chain: Rail[], deck: (r: Rail) => number, station: XY | null, opts: { smoothY?: number; maxGrade?: number; hidden?: (r: Rail) => boolean } = {}): Track {
  const raw: { x: number; n: number; y: number }[] = [];
  for (const w of chain) for (const [x, n] of w.pts) { const l = raw[raw.length - 1]; if (!l || Math.hypot(l.x - x, l.n - n) > 0.01) raw.push({ x, n, y: deck(w) }); else l.y = Math.max(l.y, deck(w)); }
  // per-segment height: the way the segment belongs to (use the max at joins)
  const segY: number[] = []; const segF: number[] = []; { let k = 0; for (const w of chain) { for (let i = 1; i < w.pts.length; i++) { segF[k] = (opts.hidden?.(w) ? 1 : 0) | (w.elevated ? 2 : 0); segY[k++] = deck(w); } } }
  const cum = [0]; for (let i = 1; i < raw.length; i++) cum.push(cum[i - 1] + Math.hypot(raw[i].x - raw[i - 1].x, raw[i].n - raw[i - 1].n));
  const L = cum[cum.length - 1]; const m = Math.floor(L) + 1;
  const px = new Float64Array(m), pn = new Float64Array(m), py = new Float64Array(m); const pf = new Uint8Array(m);
  for (let s = 0, j = 1; s < m; s++) {
    while (j < raw.length - 1 && cum[j] < s) j++;
    const t = (s - cum[j - 1]) / Math.max(1e-9, cum[j] - cum[j - 1]);
    px[s] = raw[j - 1].x + (raw[j].x - raw[j - 1].x) * t; pn[s] = raw[j - 1].n + (raw[j].n - raw[j - 1].n) * t; py[s] = segY[j - 1] ?? raw[j].y; pf[s] = segF[j - 1] ?? 0;
  }
  // maxGrade: approaches climb to a raised deck at that grade (the deck keeps its full height over its own length)
  if (opts.maxGrade) { const g = opts.maxGrade; for (let i = 1; i < m; i++) py[i] = Math.max(py[i], py[i - 1] - g); for (let i = m - 2; i >= 0; i--) py[i] = Math.max(py[i], py[i + 1] - g); }
  const smooth = (a: Float64Array, r: number) => { const o = new Float64Array(a.length); for (let i = 0; i < a.length; i++) { const k = Math.min(r, i, a.length - 1 - i); let s = 0; for (let d = -k; d <= k; d++) s += a[i + d]; o[i] = s / (2 * k + 1); } return o; };
  const sx = smooth(px, 4), sn = smooth(pn, 4), sy = smooth(py, opts.smoothY ?? 15);
  const n = m + 2 * EXT; const x = new Float32Array(n), y = new Float32Array(n), z = new Float32Array(n);
  const hide = new Uint8Array(n), elev = new Uint8Array(n);
  const d0 = [sx[1] - sx[0], sn[1] - sn[0]], d1 = [sx[m - 1] - sx[m - 2], sn[m - 1] - sn[m - 2]];
  const n0 = Math.hypot(d0[0], d0[1]) || 1, n1 = Math.hypot(d1[0], d1[1]) || 1;
  for (let i = 0; i < n; i++) {
    const s = i - EXT;
    if (s < 0) { x[i] = sx[0] + (d0[0] / n0) * s; z[i] = -(sn[0] + (d0[1] / n0) * s); y[i] = sy[0]; }
    else if (s >= m) { const e = s - (m - 1); x[i] = sx[m - 1] + (d1[0] / n1) * e; z[i] = -(sn[m - 1] + (d1[1] / n1) * e); y[i] = sy[m - 1]; }
    else { x[i] = sx[s]; z[i] = -sn[s]; y[i] = sy[s]; hide[i] = pf[s] & 1; elev[i] = (pf[s] >> 1) & 1; }
  }
  let stop = EXT + m / 2;
  if (station) { let best = Infinity; for (let i = EXT; i < EXT + m; i++) { if (hide[i]) continue; const d = Math.hypot(x[i] - station[0], -z[i] - station[1]); if (d < best) { best = d; stop = i; } } }
  return { n, x, y, z, inStart: EXT, inEnd: EXT + m - 1, stop, hide, elev };
}

/** Run profile of one train: head position (m along the extended track) at a given age (s). */
class Profile {
  sIn: number; sB: number; sStop: number; sA: number; sOut: number;
  tB: number; tStop: number; tDep: number; tA: number; tOut: number; len: number; private P: TrainSpec;
  constructor(tr: Track, cars: number, P: TrainSpec) {
    this.P = P; this.len = cars * P.carLen + (cars - 1) * P.carGap;
    const dB = (P.vMax * P.vMax) / (2 * P.decel), dA = (P.vMax * P.vMax) / (2 * P.accel);
    this.sStop = tr.stop + this.len / 2; // train centred on the platform
    this.sB = this.sStop - dB; this.sA = this.sStop + dA;
    this.sIn = Math.min(tr.inStart - 2, this.sB); // whole train just outside the frame (earlier if it must already brake there)
    this.sOut = Math.max(this.sA, Math.min(tr.n - 2, tr.inEnd + this.len + 2));
    this.tB = (this.sB - this.sIn) / P.vMax; this.tStop = this.tB + P.vMax / P.decel; this.tDep = this.tStop + P.dwell;
    this.tA = this.tDep + P.vMax / P.accel; this.tOut = this.tA + (this.sOut - this.sA) / P.vMax;
  }
  get tMid() { return (this.tStop + this.tDep) / 2; }
  at(t: number): number {
    const P = this.P;
    if (t < this.tB) return this.sIn + P.vMax * t;
    if (t < this.tStop) { const u = t - this.tB; return this.sB + P.vMax * u - 0.5 * P.decel * u * u; }
    if (t < this.tDep) return this.sStop;
    if (t < this.tA) { const u = t - this.tDep; return this.sStop + 0.5 * P.accel * u * u; }
    return this.sA + P.vMax * (t - this.tA);
  }
}

function carGeometry(cab: boolean, P: TrainSpec) {
  const w = P.carW / 2, h = P.carH, c = 0.38;
  const shape = new THREE.Shape([new THREE.Vector2(-w, 0), new THREE.Vector2(w, 0), new THREE.Vector2(w, h - c), new THREE.Vector2(w - c, h), new THREE.Vector2(-w + c, h), new THREE.Vector2(-w, h - c)]);
  const g = new THREE.ExtrudeGeometry(shape, { depth: P.carLen, bevelEnabled: false, steps: 1 });
  g.rotateY(Math.PI / 2); g.translate(-P.carLen / 2, 0, 0); // length along +x, centred, base at y = 0
  if (cab) { const pos = g.getAttribute('position'); for (let i = 0; i < pos.count; i++) if (pos.getX(i) > P.carLen / 2 - 0.01) pos.setX(i, pos.getX(i) - (pos.getY(i) / h) * P.nose); }
  g.deleteAttribute('uv'); g.computeVertexNormals(); g.translate(0, P.floor, 0);
  return g;
}

export class Trains {
  group = new THREE.Group();
  mats = {
    body: new THREE.MeshLambertMaterial(), window: new THREE.MeshLambertMaterial(), accent: new THREE.MeshLambertMaterial(),
    edge: new THREE.LineBasicMaterial({ transparent: true }),
  };
  private tracks: Track[]; private profiles: Profile[][]; // per track, per pattern slot
  private cab: THREE.InstancedMesh; private mid: THREE.InstancedMesh; private band: THREE.InstancedMesh; private stripe: THREE.InstancedMesh;
  private edges: THREE.LineSegments; private edgePos: Float32Array; private edgeTpl: { cab: Float32Array; mid: Float32Array };
  private maxCars: number; readonly spec: TrainSpec; private trackColors: THREE.Color[] | null = null;
  private time = 0; private frozen: number | null = null;
  // scratch
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler(0, 0, 0, 'YZX'); private p = new THREE.Vector3(); private one = new THREE.Vector3(1, 1, 1);
  private flipM = new THREE.Matrix4().makeRotationY(Math.PI); private tmpM = new THREE.Matrix4();

  constructor(tracks: Track[], halfSize: number, spec: TrainSpec = TRAIN) {
    this.tracks = tracks; this.spec = spec; const P = spec; this.time = spec.start ?? 0;
    this.profiles = tracks.map((tr, k) => P.pattern[k % P.pattern.length].map((cars) => new Profile(tr, cars, P)));
    const maxActive = Math.max(...this.profiles.flat().map((p) => Math.ceil(p.tOut / P.headway) + 1));
    this.maxCars = tracks.length * maxActive * Math.max(...P.pattern.flat());
    const clip = [new THREE.Plane(new THREE.Vector3(1, 0, 0), halfSize), new THREE.Plane(new THREE.Vector3(-1, 0, 0), halfSize), new THREE.Plane(new THREE.Vector3(0, 0, 1), halfSize), new THREE.Plane(new THREE.Vector3(0, 0, -1), halfSize)];
    for (const mt of Object.values(this.mats)) mt.clippingPlanes = clip;
    const cabG = carGeometry(true, P), midG = carGeometry(false, P);
    const bandG = new THREE.BoxGeometry(P.carLen - 2.8, P.band.h, P.carW + 0.04); bandG.translate(0, P.band.y, 0);
    const stripeG = new THREE.BoxGeometry(P.carLen - 1.6, P.stripe.h, P.carW + 0.03); stripeG.translate(0, P.stripe.y, 0);
    const mk = (g: THREE.BufferGeometry, mat: THREE.Material, shadow: boolean) => { const im = new THREE.InstancedMesh(g, mat, this.maxCars); im.count = 0; im.frustumCulled = false; im.castShadow = shadow; im.receiveShadow = shadow; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.group.add(im); return im; };
    this.cab = mk(cabG, this.mats.body, true); this.mid = mk(midG, this.mats.body, true);
    this.band = mk(bandG, this.mats.window, false); this.stripe = mk(stripeG, this.mats.accent, false);
    const tpl = (g: THREE.BufferGeometry) => new THREE.EdgesGeometry(g, 20).getAttribute('position').array as Float32Array;
    this.edgeTpl = { cab: tpl(cabG), mid: tpl(midG) };
    this.edgePos = new Float32Array(this.maxCars * Math.max(this.edgeTpl.cab.length, this.edgeTpl.mid.length));
    const eg = new THREE.BufferGeometry(); const attr = new THREE.BufferAttribute(this.edgePos, 3); attr.setUsage(THREE.DynamicDrawUsage); eg.setAttribute('position', attr); eg.setDrawRange(0, 0);
    this.edges = new THREE.LineSegments(eg, this.mats.edge); this.edges.frustumCulled = false; this.group.add(this.edges);
  }

  setColors(body: THREE.Color, win: THREE.Color, accent: THREE.Color, edge: THREE.Color, edgeOpacity: number) {
    this.mats.body.color.copy(body); this.mats.window.color.copy(win); this.mats.accent.color.copy(this.trackColors ? new THREE.Color(1, 1, 1) : accent); this.mats.edge.color.copy(edge); this.mats.edge.opacity = edgeOpacity;
  }
  /** Per-track livery stripe colour (instance colours; the accent material turns white). */
  setTrackColors(colors: THREE.Color[]) {
    this.trackColors = colors.map((c) => c.clone()); this.mats.accent.color.setRGB(1, 1, 1);
    if (!this.stripe.instanceColor) { for (let i = 0; i < this.maxCars; i++) this.stripe.setColorAt(i, this.trackColors[0]); }
  }
  /** Advance the simulation clock (seconds); dt is clamped so a background tab does not jump. */
  step(dt: number) { this.time += Math.min(0.1, Math.max(0, dt)); }
  /** Fix the clock (screenshots, reduced motion). null = run. */
  freeze(t: number | null) { this.frozen = t; }
  private debugFrozen = false;
  /** Freeze for checks/screenshots (takes precedence over the reduced-motion clock). */
  debugFreeze(t: number | null) { this.debugFrozen = t != null; this.frozen = t; }
  reducedMotionClock() { return this.debugFrozen && this.frozen != null ? this.frozen : this.dwellTime(0, 0); }
  get clock() { return this.frozen ?? this.time; }
  /** A clock value at which the first train on track `k` is halfway through its dwell. */
  dwellTime(k = 0, slot = 0) { const pr = this.profiles[k][slot]; return slot * this.spec.headway + this.offset(k) + pr.tMid; }
  private offset(k: number) { const P = this.spec; return P.phases ? P.phases[k % P.phases.length] * P.headway - this.profiles[k][0].tMid : k * P.trackOffset * P.headway; }
  /** Track geometry (checks). */
  get trackList() { return this.tracks; }

  /** Trains currently on the map: [track, carCount, head s]. Used by checks. */
  state(): { track: number; cars: number; head: number; tail: number; speedHint: string }[] {
    const out: { track: number; cars: number; head: number; tail: number; speedHint: string }[] = [];
    this.forEachTrain((k, pr, age) => { const s = pr.at(age); out.push({ track: k, cars: Math.round((pr.len + this.spec.carGap) / (this.spec.carLen + this.spec.carGap)), head: s, tail: s - pr.len, speedHint: age < pr.tB ? 'cruise' : age < pr.tStop ? 'braking' : age < pr.tDep ? 'dwell' : age < pr.tA ? 'accel' : 'cruise' }); });
    return out;
  }
  private forEachTrain(f: (k: number, pr: Profile, age: number) => void) {
    const t = this.clock; const H = this.spec.headway;
    for (let k = 0; k < this.tracks.length; k++) {
      const profs = this.profiles[k]; const tk = t - this.offset(k); const kMax = Math.floor(tk / H);
      for (let i = kMax; i > kMax - 12; i--) {
        const pr = profs[((i % profs.length) + profs.length) % profs.length]; const age = tk - i * H;
        if (age > pr.tOut) { if (age > Math.max(400, 2 * pr.tOut)) break; continue; }
        f(k, pr, age);
      }
    }
  }

  update() {
    if (!this.group.visible) return;
    let nCab = 0, nMid = 0, nCar = 0, ePtr = 0;
    const P = this.spec, pitch = P.carLen + P.carGap; const tc = this.trackColors;
    this.forEachTrain((k, pr, age) => {
      const tr = this.tracks[k]; const head = pr.at(age); const cars = Math.round((pr.len + P.carGap) / pitch);
      for (let c = 0; c < cars; c++) {
        const front = head - c * pitch - P.bogieInset, rear = head - c * pitch - P.carLen + P.bogieInset;
        if (rear < 1 || front > tr.n - 2) continue;
        if (tr.hide[Math.round((front + rear) / 2)]) continue; // in a tunnel
        const fx = this.sample(tr.x, front), fy = this.sample(tr.y, front), fz = this.sample(tr.z, front);
        const rx = this.sample(tr.x, rear), ry = this.sample(tr.y, rear), rz = this.sample(tr.z, rear);
        const dx = fx - rx, dy = fy - ry, dz = fz - rz; const hl = Math.hypot(dx, dz) || 1;
        this.e.set(0, Math.atan2(-dz, dx), Math.atan2(dy, hl)); this.q.setFromEuler(this.e);
        this.p.set((fx + rx) / 2, (fy + ry) / 2, (fz + rz) / 2); this.m.compose(this.p, this.q, this.one);
        const isCab = c === 0 || c === cars - 1;
        let mm = this.m;
        if (isCab && c !== 0) { this.tmpM.multiplyMatrices(this.m, this.flipM); mm = this.tmpM; } // rear cab faces backwards
        if (isCab) this.cab.setMatrixAt(nCab++, mm); else this.mid.setMatrixAt(nMid++, mm);
        this.band.setMatrixAt(nCar, this.m); this.stripe.setMatrixAt(nCar, this.m); if (tc) this.stripe.setColorAt(nCar, tc[k % tc.length]); nCar++;
        const tpl = isCab ? this.edgeTpl.cab : this.edgeTpl.mid; const el = mm.elements;
        for (let i = 0; i < tpl.length; i += 3) {
          const x = tpl[i], y = tpl[i + 1], z = tpl[i + 2];
          this.edgePos[ePtr++] = el[0] * x + el[4] * y + el[8] * z + el[12];
          this.edgePos[ePtr++] = el[1] * x + el[5] * y + el[9] * z + el[13];
          this.edgePos[ePtr++] = el[2] * x + el[6] * y + el[10] * z + el[14];
        }
      }
    });
    this.cab.count = nCab; this.mid.count = nMid; this.band.count = nCar; this.stripe.count = nCar;
    for (const im of [this.cab, this.mid, this.band, this.stripe]) im.instanceMatrix.needsUpdate = true;
    if (tc && this.stripe.instanceColor) this.stripe.instanceColor.needsUpdate = true;
    const attr = this.edges.geometry.getAttribute('position') as THREE.BufferAttribute; attr.needsUpdate = true; attr.clearUpdateRanges(); attr.addUpdateRange(0, ePtr);
    this.edges.geometry.setDrawRange(0, ePtr / 3);
  }
  private sample(a: Float32Array, s: number) { const i = Math.max(0, Math.min(a.length - 2, Math.floor(s))); const f = Math.max(0, Math.min(1, s - i)); return a[i] + (a[i + 1] - a[i]) * f; }
}
