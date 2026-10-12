// Sample points for the sidewalk-shade analysis (chapter 07).
import * as THREE from 'three';
import { lines, buildings, walks, routes, type XY, type Route } from '../data';
import { routeY } from './geometry';

const STEP = 5; // metres between samples
const EYE = 1.5; // metres above the walking surface

const inside = (p: XY, ring: XY[]) => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const bIdx = buildings.map((b) => { const xs = b.ring.map((p) => p[0]), ys = b.ring.map((p) => p[1]); return { ring: b.ring, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }; });
const inBuilding = (p: XY) => bIdx.some((b) => p[0] >= b.x0 && p[0] <= b.x1 && p[1] >= b.y0 && p[1] <= b.y1 && inside(p, b.ring));

/** Points every STEP metres along a polyline (centres of each STEP-long piece). */
function along(pts: XY[], cb: (p: XY) => void) {
  let carry = STEP / 2;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i]; const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let s = carry;
    while (s < d) { const t = s / d; cb([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); s += STEP; }
    carry = s - d;
  }
}

/** Ground-level, open-air footway points (not bridges, not indoor/covered, not inside a building). */
export const groundSamples: THREE.Vector3[] = (() => {
  const out: THREE.Vector3[] = [];
  for (const f of lines.footways) {
    if (f.bridge || f.sheltered || f.layer > 0 || f.layer < 0) continue;
    along(f.pts, (p) => { if (!inBuilding(p)) out.push(new THREE.Vector3(p[0], EYE + 0.22, -p[1])); });
  }
  return out;
})();

/** Exposed (not sheltered) parts of a route, sampled at their walking level. */
export function routeSamples(r: Route): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const s of r.segments) if (!s.sheltered) along(s.pts, (p) => out.push(new THREE.Vector3(p[0], routeY(s.layer) + EYE, -p[1])));
  return out;
}
const exposed = (r: Route) => r.segments.filter((s) => !s.sheltered).reduce((a, s) => a + s.length, 0);
export const routeSampleSets = [
  ...(routes.length ? [{ id: 'legs', route: null as Route | null, pts: routes.flatMap(routeSamples), exposedM: Math.round(routes.reduce((a, r) => a + exposed(r), 0)) }] : []),
  ...walks.map((w) => ({ id: w.id, route: w as Route | null, pts: routeSamples(w), exposedM: Math.round(exposed(w)) })),
];
