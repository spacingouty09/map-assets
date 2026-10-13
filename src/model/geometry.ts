// Geometry helpers shared by the model, shade sampling and any site that draws on top of the model.
// Local frame: x = metres east, north = metres north of the study-area centre; Three.js y is up and z = -north.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { XY } from '../data';

export const v3 = (x: number, north: number, y = 0) => new THREE.Vector3(x, y, -north);

// Flat ribbon along a 3D polyline (width measured horizontally).
export function ribbon(pts: THREE.Vector3[], width: number): THREE.BufferGeometry | null {
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
export const merge = (gs: (THREE.BufferGeometry | null)[]) => { const ok = gs.filter((g): g is THREE.BufferGeometry => !!g); for (const g of ok) { g.deleteAttribute('uv'); if (!g.index) g.setIndex([...Array(g.getAttribute('position').count).keys()]); } return ok.length ? mergeGeometries(ok, false) : new THREE.BufferGeometry(); };

/** Copy-and-merge. Does not mutate the inputs, so the same buildings can be batched again under another material. */
function mergeChunked(gs: THREE.BufferGeometry[], solid: boolean): THREE.BufferGeometry {
  const copies: THREE.BufferGeometry[] = [];
  for (const g of gs) {
    const pos = g.getAttribute('position'); if (!pos || pos.count < (solid ? 3 : 2)) continue;
    const c = new THREE.BufferGeometry(); c.setAttribute('position', pos.clone());
    if (solid) {
      const nor = g.getAttribute('normal');
      if (nor && nor.count === pos.count) c.setAttribute('normal', nor.clone());
      else { const n = new Float32Array(pos.count * 3); for (let i = 1; i < n.length; i += 3) n[i] = 1; c.setAttribute('normal', new THREE.BufferAttribute(n, 3)); }
      if (g.index) c.setIndex(g.index.clone());
      else { const idx = new Uint32Array(pos.count); for (let i = 0; i < pos.count; i++) idx[i] = i; c.setIndex(new THREE.BufferAttribute(idx, 1)); }
    }
    copies.push(c);
  }
  if (!copies.length) return new THREE.BufferGeometry();
  if (copies.length === 1) return copies[0];
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < copies.length; i += 256) {
    const slice = copies.slice(i, i + 256);
    const m = mergeGeometries(slice, false); for (const s of slice) s.dispose();
    if (!m) throw new Error('mergeGeometries failed');
    parts.push(m);
  }
  if (parts.length === 1) return parts[0];
  const out = mergeGeometries(parts, false); for (const p of parts) p.dispose();
  if (!out) throw new Error('mergeGeometries failed');
  return out;
}
export const mergeSolids = (gs: THREE.BufferGeometry[]) => mergeChunked(gs, true);
export const mergeLines = (gs: THREE.BufferGeometry[]) => mergeChunked(gs, false);
export const flatShape = (ring: XY[], y: number) => { const g = new THREE.ShapeGeometry(new THREE.Shape(ring.map(([x, n]) => new THREE.Vector2(x, n)))); g.rotateX(-Math.PI / 2); g.translate(0, y, 0); return g; };

/** Drawn height (m) of a walking route segment on OSM layer `layer` (schematic deck heights). */
export function routeY(layer: number) { return layer >= 1 ? 5.5 + (layer - 1) * 3.5 : layer < 0 ? 0.7 : 1.2; }
