// Animated LRT trainsets on the Kelana Jaya line viaduct.
// Track geometry: the OSM track ways chained into continuous tracks (one per direction),
// resampled every metre, lightly smoothed, extended beyond the study frame so trains can
// enter and leave the map edge (clipped there). Each train follows a fixed run profile:
// cruise -> brake to a stop at Abdullah Hukum (KJ17) -> dwell -> accelerate -> cruise.
// All trains on a track share that profile, offset by a constant headway, so they can never
// overlap. Rendering: instanced bodies / window bands / accent stripes plus one dynamic
// LineSegments for the outlines; nothing is allocated per frame.
import * as THREE from 'three';
import type { Rail, XY } from './data';

export const TRAIN = {
  carLen: 17, carGap: 0.8, carW: 2.65, carH: 3.3, floor: 0.45, bogieInset: 2.6, nose: 1.4, // metres, illustrative proportions
  vMax: 16, accel: 1.0, decel: 1.0, dwell: 15, headway: 48, // m/s, m/s², s, s
  pattern: [[4, 2, 4], [2, 4, 4]] as number[][], // cars per train, repeating, per track
  trackOffset: 0.5, // track 2 runs half a headway after track 1
};
const EXT = 160; // m of virtual straight track beyond each map edge

export interface Track { n: number; x: Float32Array; y: Float32Array; z: Float32Array; inStart: number; inEnd: number; stop: number }

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

/** Resample a chain every metre, smooth plan (±4 m) and deck height (±15 m ramp), extend both ends. */
export function buildTrack(chain: Rail[], deck: (r: Rail) => number, station: XY | null): Track {
  const raw: { x: number; n: number; y: number }[] = [];
  for (const w of chain) for (const [x, n] of w.pts) { const l = raw[raw.length - 1]; if (!l || Math.hypot(l.x - x, l.n - n) > 0.01) raw.push({ x, n, y: deck(w) }); else l.y = Math.max(l.y, deck(w)); }
  // per-segment height: the way the segment belongs to (use the max at joins)
  const segY: number[] = []; { let k = 0; for (const w of chain) { for (let i = 1; i < w.pts.length; i++) segY[k++] = deck(w); } }
  const cum = [0]; for (let i = 1; i < raw.length; i++) cum.push(cum[i - 1] + Math.hypot(raw[i].x - raw[i - 1].x, raw[i].n - raw[i - 1].n));
  const L = cum[cum.length - 1]; const m = Math.floor(L) + 1;
  const px = new Float64Array(m), pn = new Float64Array(m), py = new Float64Array(m);
  for (let s = 0, j = 1; s < m; s++) {
    while (j < raw.length - 1 && cum[j] < s) j++;
    const t = (s - cum[j - 1]) / Math.max(1e-9, cum[j] - cum[j - 1]);
    px[s] = raw[j - 1].x + (raw[j].x - raw[j - 1].x) * t; pn[s] = raw[j - 1].n + (raw[j].n - raw[j - 1].n) * t; py[s] = segY[j - 1] ?? raw[j].y;
  }
  const smooth = (a: Float64Array, r: number) => { const o = new Float64Array(a.length); for (let i = 0; i < a.length; i++) { const k = Math.min(r, i, a.length - 1 - i); let s = 0; for (let d = -k; d <= k; d++) s += a[i + d]; o[i] = s / (2 * k + 1); } return o; };
  const sx = smooth(px, 4), sn = smooth(pn, 4), sy = smooth(py, 15);
  const n = m + 2 * EXT; const x = new Float32Array(n), y = new Float32Array(n), z = new Float32Array(n);
  const d0 = [sx[1] - sx[0], sn[1] - sn[0]], d1 = [sx[m - 1] - sx[m - 2], sn[m - 1] - sn[m - 2]];
  const n0 = Math.hypot(d0[0], d0[1]) || 1, n1 = Math.hypot(d1[0], d1[1]) || 1;
  for (let i = 0; i < n; i++) {
    const s = i - EXT;
    if (s < 0) { x[i] = sx[0] + (d0[0] / n0) * s; z[i] = -(sn[0] + (d0[1] / n0) * s); y[i] = sy[0]; }
    else if (s >= m) { const e = s - (m - 1); x[i] = sx[m - 1] + (d1[0] / n1) * e; z[i] = -(sn[m - 1] + (d1[1] / n1) * e); y[i] = sy[m - 1]; }
    else { x[i] = sx[s]; z[i] = -sn[s]; y[i] = sy[s]; }
  }
  let stop = EXT + m / 2;
  if (station) { let best = Infinity; for (let i = EXT; i < EXT + m; i++) { const d = Math.hypot(x[i] - station[0], -z[i] - station[1]); if (d < best) { best = d; stop = i; } } }
  return { n, x, y, z, inStart: EXT, inEnd: EXT + m - 1, stop };
}

/** Run profile of one train: head position (m along the extended track) at a given age (s). */
class Profile {
  sIn: number; sB: number; sStop: number; sA: number; sOut: number;
  tB: number; tStop: number; tDep: number; tA: number; tOut: number; len: number;
  constructor(tr: Track, cars: number) {
    const P = TRAIN; this.len = cars * P.carLen + (cars - 1) * P.carGap;
    const dB = (P.vMax * P.vMax) / (2 * P.decel), dA = (P.vMax * P.vMax) / (2 * P.accel);
    this.sIn = tr.inStart - 2; // whole train just outside the frame
    this.sStop = tr.stop + this.len / 2; // train centred on the platform
    this.sB = this.sStop - dB; this.sA = this.sStop + dA;
    this.sOut = Math.min(tr.n - 2, tr.inEnd + this.len + 2);
    this.tB = (this.sB - this.sIn) / P.vMax; this.tStop = this.tB + P.vMax / P.decel; this.tDep = this.tStop + P.dwell;
    this.tA = this.tDep + P.vMax / P.accel; this.tOut = this.tA + (this.sOut - this.sA) / P.vMax;
  }
  at(t: number): number {
    const P = TRAIN;
    if (t < this.tB) return this.sIn + P.vMax * t;
    if (t < this.tStop) { const u = t - this.tB; return this.sB + P.vMax * u - 0.5 * P.decel * u * u; }
    if (t < this.tDep) return this.sStop;
    if (t < this.tA) { const u = t - this.tDep; return this.sStop + 0.5 * P.accel * u * u; }
    return this.sA + P.vMax * (t - this.tA);
  }
}

function carGeometry(cab: boolean) {
  const P = TRAIN; const w = P.carW / 2, h = P.carH, c = 0.38;
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
  private maxCars: number;
  private time = 0; private frozen: number | null = null;
  // scratch
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler(0, 0, 0, 'YZX'); private p = new THREE.Vector3(); private one = new THREE.Vector3(1, 1, 1);
  private flipM = new THREE.Matrix4().makeRotationY(Math.PI); private tmpM = new THREE.Matrix4();

  constructor(tracks: Track[], halfSize: number) {
    this.tracks = tracks;
    this.profiles = tracks.map((tr, k) => TRAIN.pattern[k % TRAIN.pattern.length].map((cars) => new Profile(tr, cars)));
    const maxActive = Math.max(...this.profiles.flat().map((p) => Math.ceil(p.tOut / TRAIN.headway) + 1));
    this.maxCars = tracks.length * maxActive * 4;
    const clip = [new THREE.Plane(new THREE.Vector3(1, 0, 0), halfSize), new THREE.Plane(new THREE.Vector3(-1, 0, 0), halfSize), new THREE.Plane(new THREE.Vector3(0, 0, 1), halfSize), new THREE.Plane(new THREE.Vector3(0, 0, -1), halfSize)];
    for (const mt of Object.values(this.mats)) mt.clippingPlanes = clip;
    const P = TRAIN;
    const cabG = carGeometry(true), midG = carGeometry(false);
    const bandG = new THREE.BoxGeometry(P.carLen - 2.8, 0.78, P.carW + 0.04); bandG.translate(0, P.floor + 1.95 + 0.39, 0);
    const stripeG = new THREE.BoxGeometry(P.carLen - 1.6, 0.16, P.carW + 0.03); stripeG.translate(0, P.floor + 1.3, 0);
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
    this.mats.body.color.copy(body); this.mats.window.color.copy(win); this.mats.accent.color.copy(accent); this.mats.edge.color.copy(edge); this.mats.edge.opacity = edgeOpacity;
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
  dwellTime(k = 0, slot = 0) { const pr = this.profiles[k][slot]; return slot * TRAIN.headway + this.offset(k) + (pr.tStop + pr.tDep) / 2; }
  private offset(k: number) { return k * TRAIN.trackOffset * TRAIN.headway; }

  /** Trains currently on the map: [track, carCount, head s]. Used by checks. */
  state(): { track: number; cars: number; head: number; tail: number; speedHint: string }[] {
    const out: { track: number; cars: number; head: number; tail: number; speedHint: string }[] = [];
    this.forEachTrain((k, pr, age) => { const s = pr.at(age); out.push({ track: k, cars: Math.round((pr.len + TRAIN.carGap) / (TRAIN.carLen + TRAIN.carGap)), head: s, tail: s - pr.len, speedHint: age < pr.tB ? 'cruise' : age < pr.tStop ? 'braking' : age < pr.tDep ? 'dwell' : age < pr.tA ? 'accel' : 'cruise' }); });
    return out;
  }
  private forEachTrain(f: (k: number, pr: Profile, age: number) => void) {
    const t = this.clock; const H = TRAIN.headway;
    for (let k = 0; k < this.tracks.length; k++) {
      const profs = this.profiles[k]; const tk = t - this.offset(k); const kMax = Math.floor(tk / H);
      for (let i = kMax; i > kMax - 12; i--) {
        const pr = profs[((i % profs.length) + profs.length) % profs.length]; const age = tk - i * H;
        if (age > pr.tOut) { if (age > 400) break; continue; }
        f(k, pr, age);
      }
    }
  }

  update() {
    if (!this.group.visible) return;
    let nCab = 0, nMid = 0, nCar = 0, ePtr = 0;
    const P = TRAIN, pitch = P.carLen + P.carGap;
    this.forEachTrain((k, pr, age) => {
      const tr = this.tracks[k]; const head = pr.at(age); const cars = Math.round((pr.len + P.carGap) / pitch);
      for (let c = 0; c < cars; c++) {
        const front = head - c * pitch - P.bogieInset, rear = head - c * pitch - P.carLen + P.bogieInset;
        if (rear < 1 || front > tr.n - 2) continue;
        const fx = this.sample(tr.x, front), fy = this.sample(tr.y, front), fz = this.sample(tr.z, front);
        const rx = this.sample(tr.x, rear), ry = this.sample(tr.y, rear), rz = this.sample(tr.z, rear);
        const dx = fx - rx, dy = fy - ry, dz = fz - rz; const hl = Math.hypot(dx, dz) || 1;
        this.e.set(0, Math.atan2(-dz, dx), Math.atan2(dy, hl)); this.q.setFromEuler(this.e);
        this.p.set((fx + rx) / 2, (fy + ry) / 2, (fz + rz) / 2); this.m.compose(this.p, this.q, this.one);
        const isCab = c === 0 || c === cars - 1;
        let mm = this.m;
        if (isCab && c !== 0) { this.tmpM.multiplyMatrices(this.m, this.flipM); mm = this.tmpM; } // rear cab faces backwards
        if (isCab) this.cab.setMatrixAt(nCab++, mm); else this.mid.setMatrixAt(nMid++, mm);
        this.band.setMatrixAt(nCar, this.m); this.stripe.setMatrixAt(nCar, this.m); nCar++;
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
    const attr = this.edges.geometry.getAttribute('position') as THREE.BufferAttribute; attr.needsUpdate = true; attr.clearUpdateRanges(); attr.addUpdateRange(0, ePtr);
    this.edges.geometry.setDrawRange(0, ePtr / 3);
  }
  private sample(a: Float32Array, s: number) { const i = Math.max(0, Math.min(a.length - 2, Math.floor(s))); const f = Math.max(0, Math.min(1, s - i)); return a[i] + (a[i + 1] - a[i]) * f; }
}
