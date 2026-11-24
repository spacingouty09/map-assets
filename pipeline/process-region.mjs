// Build a region's compact data (regions/<id>/data/region.json) from raw OpenStreetMap (regions/<raw>/raw/overpass.json,
// fetched with npm run region:fetch) and the region's region.json (box) and rules.json (which route relation is which
// line, interchanges, walking changes). Local frame: x = metres east, y = metres north of the middle of the box.
// With regions/<id>/raw/basemap.json.gz (npm run region:fetch -- <id> basemap) it also builds regions/<id>/data/basemap.json:
// the flat street map (roads by class, water and green areas, cut to the box) and the named places (suburbs and smaller).
// Usage: npm run region:process [-- <region id>]   (no id = every region with a rules.json)
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { at } from './config.mjs';

const R = 6378137, K = Math.PI / 180;
const readJson = (p) => JSON.parse(readFileSync(at(p), 'utf8'));
export const regionIds = () => readdirSync(at('regions'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(at(`regions/${d.name}/rules.json`))).map((d) => d.name).sort();

// ---------- geometry ----------
const d2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const r1 = (v) => Math.round(v * 10) / 10;
/** Douglas–Peucker */
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1; const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop(); const [ax, ay] = pts[i], [bx, by] = pts[j]; const L = Math.hypot(bx - ax, by - ay);
    let best = -1, bi = -1;
    // distance to the chord; on a closed ring (first point = last) the chord is a point, so distance to that point
    for (let k = i + 1; k < j; k++) { const d = L > 1e-9 ? Math.abs((bx - ax) * (ay - pts[k][1]) - (ax - pts[k][0]) * (by - ay)) / L : Math.hypot(pts[k][0] - ax, pts[k][1] - ay); if (d > best) { best = d; bi = k; } }
    if (best > tol) { keep[bi] = 1; stack.push([i, bi], [bi, j]); }
  }
  return pts.filter((_, k) => keep[k]);
}
const cumOf = (pts) => pts.reduce((c, p, i) => (c.push(i ? c[i - 1] + d2(p, pts[i - 1]) : 0), c), []);
/** nearest point on a polyline: { at (m along it), d (m away) }, searching only from `from` m on */
function locate(pts, cum, p, from = 0) {
  let best = { at: 0, d: Infinity };
  for (let i = 1; i < pts.length; i++) {
    if (cum[i] < from) continue;
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i]; const dx = bx - ax, dy = by - ay; const L2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / L2)); const q = [ax + dx * t, ay + dy * t];
    const d = d2(p, q); if (d < best.d) best = { at: cum[i - 1] + Math.sqrt(L2) * t, d };
  }
  return best;
}
/** Join ways (in relation order) into one polyline, turning each to continue from the last end; small gaps are bridged. */
function chain(ways) {
  const key = (p) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`; let out = [];
  for (const w of ways) {
    if (!out.length) { out = w.slice(); continue; }
    const end = key(out[out.length - 1]); const start = key(out[0]);
    if (key(w[0]) === end) out.push(...w.slice(1));
    else if (key(w[w.length - 1]) === end) out.push(...w.slice(0, -1).reverse());
    else if (out.length === ways[0].length && (key(w[0]) === start || key(w[w.length - 1]) === start)) { out.reverse(); out.push(...(key(w[0]) === start ? w.slice(1) : w.slice(0, -1).reverse())); }
    else { // gap: continue from whichever end of the way is nearer
      const e = out[out.length - 1]; const near0 = Math.hypot(w[0][0] - e[0], w[0][1] - e[1]) <= Math.hypot(w[w.length - 1][0] - e[0], w[w.length - 1][1] - e[1]);
      out.push(...(near0 ? w : w.slice().reverse()));
    }
  }
  return out;
}
/** Keep a polyline from where it first enters the box to where it last leaves it, cut exactly at the box edge. */
function clipRun(pts, inBox, edgeAt) {
  const first = pts.findIndex(inBox); if (first < 0) return [];
  let last = pts.length - 1; while (!inBox(pts[last])) last--;
  const out = pts.slice(first, last + 1);
  if (first > 0) out.unshift(edgeAt(pts[first - 1], pts[first]));
  if (last < pts.length - 1) out.push(edgeAt(pts[last + 1], pts[last]));
  return out;
}
/** Split a polyline into the runs inside the box (for the base map). */
function clipRuns(pts, inBox, edgeAt) {
  const runs = []; let cur = null;
  for (let i = 0; i < pts.length; i++) {
    const ins = inBox(pts[i]);
    if (ins && !cur) { cur = i > 0 ? [edgeAt(pts[i - 1], pts[i])] : []; }
    if (ins) cur.push(pts[i]);
    if (!ins && cur) { cur.push(edgeAt(pts[i], pts[i - 1])); runs.push(cur); cur = null; }
  }
  if (cur) runs.push(cur);
  return runs.filter((r) => r.length > 1);
}

export function processRegion(id) {
  const cfg = readJson(`regions/${id}/region.json`); const rules = readJson(`regions/${id}/rules.json`);
  if (!rules.lines) return null; // a base-map-only region (rules.json without lines)
  const rawId = cfg.raw || id; const raw = readJson(`regions/${rawId}/raw/overpass.json`);
  const B = cfg.bbox; const center = { lat: +((B.south + B.north) / 2).toFixed(6), lon: +((B.west + B.east) / 2).toFixed(6) };
  // region.json "frame": <region id>: everything is given in that region's frame (metres from the middle of its box), so
  // the two line up; worked out here around the middle of this box (a shift by c0), then shifted back on output
  const fc = cfg.frame ? (({ south, north, west, east }) => ({ lat: +((south + north) / 2).toFixed(6), lon: +((west + east) / 2).toFixed(6) }))(readJson(`regions/${cfg.frame}/region.json`).bbox) : center;
  const P0 = (lat, lon) => [(lon - fc.lon) * K * R * Math.cos(fc.lat * K), (lat - fc.lat) * K * R];
  const c0 = cfg.frame ? P0(center.lat, center.lon) : [0, 0];
  const P = cfg.frame ? (lat, lon) => { const p = P0(lat, lon); return [p[0] - c0[0], p[1] - c0[1]]; } : P0;
  const [hx, hy] = [P(center.lat, B.east)[0], P(B.north, center.lon)[1]];
  const inBox = (p) => Math.abs(p[0]) <= hx && Math.abs(p[1]) <= hy;
  // where the segment from an outside point a to an inside point b crosses the box edge
  const edgeAt = (a, b) => {
    let t = 0; for (const [i, h] of [[0, hx], [1, hy]]) for (const s of [h, -h]) { const den = b[i] - a[i]; if (Math.abs(den) < 1e-9) continue; const u = (s - a[i]) / den; if (u > t && u <= 1) { const q = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]; if (Math.abs(q[0]) <= hx + 1e-6 && Math.abs(q[1]) <= hy + 1e-6) t = u; } }
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  const geom = (g) => g.map((q) => P(q.lat, q.lon));
  const els = raw.elements; const nodes = new Map(els.filter((e) => e.type === 'node').map((n) => [n.id, n]));
  const ways = new Map(els.filter((e) => e.type === 'way').map((w) => [w.id, w]));
  const rels = new Map(els.filter((e) => e.type === 'relation').map((r) => [r.id, r]));

  // ---------- lines and their stops ----------
  const baseName = (n) => String(n || '').replace(/^([A-Z]{2,3}\d+[A-Z]?[;\s]*)+/, '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+Departure$/i, '').trim();
  const refsOf = (t) => [...new Set([...(t.ref ? String(t.ref).split(/[;,\s]+/) : []), ...(String(t.name || '').match(/\b[A-Z]{2,3}\d{1,2}[A-Z]?\b/g) || [])])].filter((r) => /^[A-Z]{2,3}\d{1,2}[A-Z]?$/.test(r));
  const stations = []; // { id, name, nameZh, refs:Set, c, lines:Set, stopIds:Set }
  const stationFor = (n) => {
    const name = baseName(n.tags?.name); const c = P(n.lat, n.lon);
    let s = stations.find((x) => x.stopIds.has(n.id)) || stations.find((x) => x.name === name && d2(x.c, c) <= (rules.mergeM ?? 400));
    if (!s) { s = { id: `node/${n.id}`, name, nameZh: n.tags?.['name:zh-Hans'] || n.tags?.['name:zh'] || null, refs: new Set(), c, lines: new Set(), stopIds: new Set() }; stations.push(s); }
    s.stopIds.add(n.id); for (const r of refsOf(n.tags || {})) s.refs.add(r);
    if (!s.nameZh) s.nameZh = n.tags?.['name:zh-Hans'] || n.tags?.['name:zh'] || null;
    return s;
  };
  const lines = [];
  for (const L of rules.lines) {
    const rel = rels.get(L.relation); if (!rel) throw new Error(`[${id}] route relation ${L.relation} (${L.id}) is not in regions/${rawId}/raw/: re-fetch`);
    const trackWays = rel.members.filter((m) => m.type === 'way' && !/platform/.test(m.role || '')).map((m) => ways.get(m.ref)).filter((w) => w?.geometry && !/platform/.test(w.tags?.railway || '') && w.tags?.public_transport !== 'platform');
    const full = chain(trackWays.map((w) => geom(w.geometry)));
    const path = simplify(clipRun(full, inBox, edgeAt), 2).map(([x, y]) => [r1(x), r1(y)]);
    const cum = cumOf(path);
    const stops = []; let from = 0;
    for (const m of rel.members.filter((x) => x.type === 'node' && /^stop/.test(x.role || ''))) {
      const n = nodes.get(m.ref); if (!n) continue; const c = P(n.lat, n.lon); if (!inBox(c)) continue;
      const loc = locate(path, cum, c, from); if (loc.d > 250) continue; // a stop beyond the kept stretch of track
      const s = stationFor(n); if (stops.some((x) => x.station === s.id)) continue;
      s.lines.add(L.id); stops.push({ station: s.id, at: Math.round(loc.at) }); from = Math.max(0, loc.at - 50);
    }
    lines.push({ id: L.id, number: L.number ?? null, code: L.code, name: L.name, kind: L.kind, color: rel.tags.colour || L.color || '#888888', path, cum: cum.map((v) => Math.round(v)), lengthM: Math.round(cum[cum.length - 1] || 0), stops, osmRelation: L.relation });
  }
  // a station's refs: its stops' refs, plus OSM station nodes of the same name nearby
  for (const n of els.filter((e) => e.type === 'node' && e.tags?.railway === 'station')) {
    const c = P(n.lat, n.lon); const s = stations.find((x) => x.name === baseName(n.tags.name) && d2(x.c, c) <= (rules.mergeM ?? 400));
    if (s) for (const r of refsOf(n.tags)) s.refs.add(r);
  }
  const byRef = (r) => stations.find((s) => s.refs.has(r));
  const transfers = (rules.transfers || []).map((t) => {
    const a = byRef(t.a), b = byRef(t.b); if (!a || !b) throw new Error(`[${id}] transfer ${t.a}–${t.b}: station not found`);
    return { a: a.id, b: b.id, m: Math.round(d2(a.c, b.c)) };
  }).filter((t) => t.a !== t.b);

  // ---------- base map ----------
  const roads = [], rivers = [], boundaries = [];
  for (const w of ways.values()) {
    if (!w.geometry) continue; const hw = w.tags?.highway;
    if (hw === 'motorway' || hw === 'trunk') for (const run of clipRuns(geom(w.geometry), inBox, edgeAt)) roads.push({ cls: hw, pts: simplify(run, 6).map(([x, y]) => [Math.round(x), Math.round(y)]) });
    else if (w.tags?.waterway === 'river') for (const run of clipRuns(geom(w.geometry), inBox, edgeAt)) rivers.push({ name: w.tags.name || null, pts: simplify(run, 6).map(([x, y]) => [Math.round(x), Math.round(y)]) });
  }
  for (const r of rels.values()) {
    if (r.tags?.boundary !== 'administrative') continue;
    const segs = r.members.filter((m) => m.type === 'way' && m.role === 'outer' && m.geometry).map((m) => geom(m.geometry));
    const ring = simplify(chain(segs), 15).map(([x, y]) => [Math.round(x), Math.round(y)]);
    if (ring.some(inBox)) boundaries.push({ name: r.tags['name:en'] || r.tags.name, rings: [ring] });
  }
  // stable order: roads and rivers by first point
  const ord = (a, b) => a.pts[0][0] - b.pts[0][0] || a.pts[0][1] - b.pts[0][1];
  roads.sort(ord); rivers.sort(ord);

  const kept = stations.filter((s) => s.lines.size).sort((a, b) => a.id.localeCompare(b.id));
  const data = {
    meta: {
      id, name: cfg.name, summary: cfg.summary, center, bbox: B, halfSizeM: [Math.round(hx), Math.round(hy)],
      source: 'OpenStreetMap via the Overpass API (route relations, stations, motorways and trunk roads, rivers, Federal Territory boundaries)',
      attribution: '© OpenStreetMap contributors (ODbL)', fetchedAt: raw.fetched_at ?? null,
    },
    lines,
    stations: kept.map((s) => ({ id: s.id, name: s.name, ...(s.nameZh ? { nameZh: s.nameZh } : {}), refs: [...s.refs].sort(), c: s.c.map(r1), lines: lines.filter((l) => s.lines.has(l.id)).map((l) => l.id) })),
    transfers,
    base: { roads, rivers, boundaries },
  };
  if (cfg.frame) {
    const sh = ([x, y]) => [r1(x + c0[0]), r1(y + c0[1])], shi = ([x, y]) => [Math.round(x + c0[0]), Math.round(y + c0[1])];
    for (const l of data.lines) l.path = l.path.map(sh);
    for (const s of data.stations) s.c = sh(s.c);
    for (const r of [...roads, ...rivers]) r.pts = r.pts.map(shi);
    for (const b of boundaries) b.rings = b.rings.map((ring) => ring.map(shi));
    const box = [-hx + c0[0], -hy + c0[1], hx + c0[0], hy + c0[1]].map((v) => Math.round(v));
    // the frame's middle; halfSizeM reaches the farthest edge of the box from it (the box itself is meta.box)
    Object.assign(data.meta, { center: fc, frame: cfg.frame, box, halfSizeM: [Math.max(-box[0], box[2]), Math.max(-box[1], box[3])] });
  }
  mkdirSync(at(`regions/${id}/data`), { recursive: true });
  writeFileSync(at(`regions/${id}/data/region.json`), JSON.stringify(data));
  console.log(`[${id}] ${lines.length} lines (${lines.map((l) => `${l.id} ${l.stops.length}`).join(', ')}), ${kept.length} stations, ${transfers.length} walking changes, ${roads.length} road and ${rivers.length} river runs`);
  return data;
}

// ---------- flat base map ----------
/** Road classes of the base map (links go with their road), drawn from wide to thin. */
const ROAD_CLASS = { motorway: 'motorway', motorway_link: 'motorway', trunk: 'trunk', trunk_link: 'trunk', primary: 'primary', primary_link: 'primary', secondary: 'secondary', secondary_link: 'secondary', tertiary: 'tertiary', tertiary_link: 'tertiary', residential: 'minor', unclassified: 'minor', living_street: 'minor' };
const ROAD_TOL = { motorway: 3, trunk: 3, primary: 2.5, secondary: 2.5, tertiary: 2.5, minor: 2.5 };
const isWater = (t) => t.natural === 'water' || t.landuse === 'reservoir' || t.landuse === 'basin' || t.waterway === 'riverbank';
const isGreen = (t) => ['wood', 'scrub', 'grassland', 'wetland'].includes(t.natural) || ['forest', 'grass', 'meadow', 'recreation_ground', 'cemetery', 'village_green'].includes(t.landuse) || ['park', 'garden', 'golf_course', 'nature_reserve', 'recreation_ground'].includes(t.leisure);
/** smallest area kept (m²): grass verges and planters are left out */
const MIN_AREA = { water: 400, green: 2500 };
const ringArea = (r) => { let a = 0; for (let i = 0, n = r.length; i < n; i++) { const [x1, y1] = r[i], [x2, y2] = r[(i + 1) % n]; a += x1 * y2 - x2 * y1; } return a / 2; };
const insideRing = (pt, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c; } return c; };
/** Join a relation's member ways of one role into closed rings (lat / lon points). */
function memberRings(rel, role) {
  const k = (g) => `${g.lat},${g.lon}`;
  const open = rel.members.filter((m) => m.type === 'way' && (m.role || 'outer') === role && m.geometry?.length > 1).map((m) => m.geometry);
  const rings = [];
  while (open.length) {
    let ring = open.shift().slice(); let grew = true;
    while (k(ring[0]) !== k(ring.at(-1)) && grew) {
      grew = false;
      for (let i = 0; i < open.length; i++) {
        const s = open[i]; const end = k(ring.at(-1));
        if (k(s[0]) === end) ring = ring.concat(s.slice(1)); else if (k(s.at(-1)) === end) ring = ring.concat(s.slice(0, -1).reverse()); else continue;
        open.splice(i, 1); grew = true; break;
      }
    }
    if (k(ring[0]) === k(ring.at(-1)) && ring.length > 3) rings.push(ring);
  }
  return rings;
}
/** Sutherland–Hodgman: a ring cut to the box |x| <= hx, |y| <= hy. */
function clipRing(ring, hx, hy) {
  let out = ring;
  for (const [axis, lim, sign] of [[0, hx, 1], [0, hx, -1], [1, hy, 1], [1, hy, -1]]) {
    const inp = out; out = []; if (!inp.length) break;
    const ins = (p) => sign * p[axis] <= lim;
    const cut = (a, b) => { const t = (sign * lim - a[axis]) / (b[axis] - a[axis]); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; };
    for (let i = 0; i < inp.length; i++) {
      const a = inp[(i + inp.length - 1) % inp.length], b = inp[i];
      if (ins(b)) { if (!ins(a)) out.push(cut(a, b)); out.push(b); } else if (ins(a)) out.push(cut(a, b));
    }
  }
  return out;
}
const flat = (pts) => pts.flatMap(([x, y]) => [Math.round(x), Math.round(y)]);

/** A box in the processing frame, from x0 to x1 and y0 to y1 (m): inside test, segment–edge point, ring clip. */
function boxTools(x0, x1, y0, y1) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hx = (x1 - x0) / 2, hy = (y1 - y0) / 2;
  const inside = (p) => p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1;
  const edgeAt = (a, b) => {
    let t = 0; for (const [i, lo, hi] of [[0, x0, x1], [1, y0, y1]]) for (const s of [hi, lo]) { const den = b[i] - a[i]; if (Math.abs(den) < 1e-9) continue; const u = (s - a[i]) / den; if (u > t && u <= 1) { const q = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]; if (q[0] >= x0 - 1e-6 && q[0] <= x1 + 1e-6 && q[1] >= y0 - 1e-6 && q[1] <= y1 + 1e-6) t = u; } }
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  const clip = (ring) => clipRing(ring.map(([x, y]) => [x - cx, y - cy]), hx, hy).map(([x, y]) => [x + cx, y + cy]);
  return { inside, edgeAt, clip };
}

export function processBasemap(id) {
  const src = `regions/${id}/raw/basemap.json.gz`; if (!existsSync(at(src))) return null;
  const raw = JSON.parse(gunzipSync(readFileSync(at(src))).toString('utf8'));
  const cfg = readJson(`regions/${id}/region.json`); const B = cfg.bbox;
  const rules = existsSync(at(`regions/${id}/rules.json`)) ? readJson(`regions/${id}/rules.json`) : {};
  const boxCenter = (b) => ({ lat: +((b.south + b.north) / 2).toFixed(6), lon: +((b.west + b.east) / 2).toFixed(6) });
  const center = boxCenter(B);
  const P = (lat, lon) => [(lon - center.lon) * K * R * Math.cos(center.lat * K), (lat - center.lat) * K * R];
  const [hx, hy] = [P(center.lat, B.east)[0], P(B.north, center.lon)[1]];
  const inBox = (p) => Math.abs(p[0]) <= hx && Math.abs(p[1]) <= hy;
  const edgeAt = (a, b) => {
    let t = 0; for (const [i, h] of [[0, hx], [1, hy]]) for (const s of [h, -h]) { const den = b[i] - a[i]; if (Math.abs(den) < 1e-9) continue; const u = (s - a[i]) / den; if (u > t && u <= 1) { const q = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]; if (Math.abs(q[0]) <= hx + 1e-6 && Math.abs(q[1]) <= hy + 1e-6) t = u; } }
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  // region.json "frame": <region id>: the output is given in that region's frame (metres from the middle of its box), so
  // the base map lines up with that region's rail and spots with no offset. Exact: x scales with the cosine of the
  // frame's latitude, y only shifts.
  const fc = cfg.frame ? boxCenter(readJson(`regions/${cfg.frame}/region.json`).bbox) : center;
  const sx = Math.cos(fc.lat * K) / Math.cos(center.lat * K);
  const [ox, oy] = [(center.lon - fc.lon) * K * R * Math.cos(fc.lat * K), (center.lat - fc.lat) * K * R];
  const out = cfg.frame ? ([x, y]) => [x * sx + ox, y + oy] : (p) => p;
  const flatOut = (pts) => flat(pts.map(out));
  const boxOut = (x0, y0, x1, y1) => [...out([x0, y0]), ...out([x1, y1])].map((v) => Math.round(v));
  // rules.json "basemap": { "inner": bbox, "outer": { "tolScale", "drop": [classes], "minRunM": { class: m } } } splits the
  // map in two files: data/basemap.json (inside the inner box, full detail, loaded first) and data/basemap-outer.json
  // (the rest of the box, thinned: wider simplification, some classes left out, short runs dropped)
  const split = rules.basemap?.inner ? rules.basemap : null;
  const inner = split && (() => { const [x0, y0] = P(split.inner.south, split.inner.west), [x1, y1] = P(split.inner.north, split.inner.east); return { ...boxTools(x0, x1, y0, y1), x0, y0, x1, y1 }; })();
  const notInner = inner && { inside: (p) => !inner.inside(p), edgeAt: inner.edgeAt };
  const thin = { tolScale: 1, drop: [], minRunM: {}, ...(split?.outer || {}) };
  const runLen = (pts) => { let s = 0; for (let i = 1; i < pts.length; i++) s += d2(pts[i - 1], pts[i]); return s; };
  const geom = (g) => g.map((q) => P(q.lat, q.lon));
  const parts = [{ roads: Object.fromEntries(Object.keys(ROAD_TOL).map((c) => [c, []])), water: [], green: [], places: [] }];
  if (split) parts.push({ roads: Object.fromEntries(Object.keys(ROAD_TOL).map((c) => [c, []])), water: [], green: [], places: [] });
  const [main, outer] = parts;
  const seen = new Set(); // an element is listed once even when two statements of the query returned it
  const addPolys = (kind, outers, inners, minArea) => {
    const holes = inners.map((r) => clipRing(simplify(geom(r), 3), hx, hy)).filter((r) => r.length >= 3 && Math.abs(ringArea(r)) >= minArea);
    for (const o of outers) {
      const ring = clipRing(simplify(geom(o), 3), hx, hy); if (ring.length < 3 || Math.abs(ringArea(ring)) < minArea) continue;
      const own = holes.filter((h) => insideRing(h[0], ring));
      if (!split) { main[kind].push([flatOut(ring), ...own.map(flatOut)]); continue; }
      // inner file: cut to the inner box; outer file: whole (in the big box) unless it lies wholly inside the inner box
      const r1 = inner.clip(ring); if (r1.length >= 3 && Math.abs(ringArea(r1)) >= minArea) main[kind].push([flatOut(r1), ...own.map((h) => inner.clip(h)).filter((h) => h.length >= 3).map(flatOut)]);
      if (!ring.every(inner.inside)) { const r2 = simplify(ring, 3 * thin.tolScale); if (r2.length >= 3) outer[kind].push([flatOut(r2), ...own.map((h) => simplify(h, 3 * thin.tolScale)).filter((h) => h.length >= 3).map(flatOut)]); }
    }
  };
  for (const e of raw.elements) {
    const key = `${e.type}/${e.id}`; if (seen.has(key)) continue; seen.add(key); const t = e.tags || {};
    if (e.type === 'node' && t.place && t.name) {
      const c = P(e.lat, e.lon); if (!inBox(c)) continue;
      const zh = t['name:zh-Hans'] || t['name:zh'];
      (split && !inner.inside(c) ? outer : main).places.push({ name: t['name:en'] || t.name, ...(zh ? { nameZh: zh } : {}), kind: t.place, c: out(c).map((v) => Math.round(v)), osm: e.id });
    } else if (e.type === 'way' && t.highway && ROAD_CLASS[t.highway] && e.geometry) {
      const cls = ROAD_CLASS[t.highway];
      for (const run of clipRuns(geom(e.geometry), inBox, edgeAt)) {
        if (!split) { const pts = simplify(run, ROAD_TOL[cls]); if (pts.length > 1) main.roads[cls].push(flatOut(pts)); continue; }
        for (const r of clipRuns(run, inner.inside, inner.edgeAt)) { const pts = simplify(r, ROAD_TOL[cls]); if (pts.length > 1) main.roads[cls].push(flatOut(pts)); }
        if (thin.drop.includes(cls)) continue;
        for (const r of clipRuns(run, notInner.inside, notInner.edgeAt)) { if (runLen(r) < (thin.minRunM[cls] || 0)) continue; const pts = simplify(r, ROAD_TOL[cls] * thin.tolScale); if (pts.length > 1) outer.roads[cls].push(flatOut(pts)); }
      }
    } else if (isWater(t) || isGreen(t)) {
      const kind = isWater(t) ? 'water' : 'green'; const min = isWater(t) ? MIN_AREA.water : MIN_AREA.green;
      if (e.type === 'way' && e.geometry?.length > 3) addPolys(kind, [e.geometry], [], min);
      else if (e.type === 'relation' && e.members) addPolys(kind, memberRings(e, 'outer'), memberRings(e, 'inner'), min);
    }
  }
  // a place mapped twice (same name within 1.5 km): the larger kind stays
  const RANK = { town: 0, suburb: 1, quarter: 2, neighbourhood: 3 };
  const all = parts.flatMap((p) => p.places).sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.osm - b.osm);
  const dup = new Set(all.filter((p, i) => all.slice(0, i).some((q) => q.name === p.name && d2(q.c, p.c) < 1500)));
  const meta = (part) => ({
    id, bbox: B, center: fc, fetchedAt: raw.fetched_at ?? null,
    source: 'OpenStreetMap via the Overpass API: roads (residential and up), water and green areas, named places (town, suburb, quarter, neighbourhood)',
    attribution: '© OpenStreetMap contributors (ODbL)',
    ...(cfg.frame ? { frame: cfg.frame } : {}),
    ...(split ? { part, box: part === 'inner' ? boxOut(inner.x0, inner.y0, inner.x1, inner.y1) : boxOut(-hx, -hy, hx, hy) } : cfg.frame ? { box: boxOut(-hx, -hy, hx, hy) } : {}),
    ...(part === 'outer' ? { thinned: `outside the inner box: roads simplified ${thin.tolScale}× wider${thin.drop.length ? `, no ${thin.drop.join('/')} roads` : ''}${Object.keys(thin.minRunM).length ? `, runs shorter than ${Object.entries(thin.minRunM).map(([c, m]) => `${m} m (${c})`).join(', ')} left out` : ''}` } : {}),
  });
  const build = (p, part) => ({ meta: meta(part), roads: p.roads, water: p.water, green: p.green, places: p.places.sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.osm - b.osm).filter((q) => !dup.has(q)).map(({ osm, ...q }) => q) });
  mkdirSync(at(`regions/${id}/data`), { recursive: true });
  const data = build(main, split ? 'inner' : undefined);
  writeFileSync(at(`regions/${id}/data/basemap.json`), JSON.stringify(data));
  const say = (d, name) => console.log(`[${id}] ${name}: ${Object.keys(d.roads).map((c) => `${d.roads[c].length} ${c}`).join(', ')} road runs, ${d.water.length} water and ${d.green.length} green areas, ${d.places.length} places`);
  say(data, split ? 'base map (inner)' : 'base map');
  if (split) { const o = build(outer, 'outer'); writeFileSync(at(`regions/${id}/data/basemap-outer.json`), JSON.stringify(o)); say(o, 'base map (outer)'); }
  return data;
}

/** Land as polygons from coastline ways (land on their left, as OpenStreetMap maps them), cut to a box: islands whole,
 *  the open coast runs joined along the box edge, going round it counter-clockwise. Returns null when a run ends
 *  inside the box (the coastline is broken there), so a bad extract can't flood the map with sea. */
function landFromCoast(ways, x0, x1, y0, y1) {
  const key = (p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`;
  // join the ways end to start into chains
  const byStart = new Map(); for (const w of ways) byStart.set(key(w[0]), w);
  const used = new Set(); const chains = [];
  const ends = new Set(ways.map((w) => key(w.at(-1))));
  const starts = ways.filter((w) => !ends.has(key(w[0]))); // chain heads
  for (const head of [...starts, ...ways]) {
    if (used.has(head)) continue; let c = head.slice(); used.add(head);
    for (;;) { const n = byStart.get(key(c.at(-1))); if (!n || used.has(n)) break; used.add(n); c = c.concat(n.slice(1)); }
    chains.push(c);
  }
  const box = boxTools(x0, x1, y0, y1); const land = []; const runs = [];
  const onEdge = (p) => Math.min(Math.abs(p[0] - x0), Math.abs(p[0] - x1), Math.abs(p[1] - y0), Math.abs(p[1] - y1)) < 1;
  for (const c of chains) {
    if (key(c[0]) === key(c.at(-1))) { const r = box.clip(c.slice(0, -1)); if (r.length >= 3) land.push(r); continue; }
    for (const r of clipRuns(c, box.inside, box.edgeAt)) { if (!onEdge(r[0]) || !onEdge(r.at(-1))) return null; runs.push(r); }
  }
  // position along the box edge, counter-clockwise from the south-west corner
  const W = x1 - x0, H = y1 - y0, P = 2 * (W + H);
  const sOf = ([x, y]) => Math.abs(y - y0) < 1 ? x - x0 : Math.abs(x - x1) < 1 ? W + (y - y0) : Math.abs(y - y1) < 1 ? W + H + (x1 - x) : 2 * W + H + (y1 - y);
  const corners = [[W, [x1, y0]], [W + H, [x1, y1]], [2 * W + H, [x0, y1]], [P, [x0, y0]]];
  const walk = (s0, s1) => { const out = []; let d = (s1 - s0 + P) % P; for (const off of [0, P]) for (const [cs, pt] of corners) { const u = cs + off - s0; if (u > 0 && u < d) out.push([u, pt]); } return out.sort((a, b) => a[0] - b[0]).map((q) => q[1]); };
  const left = new Set(runs);
  while (left.size) {
    const first = left.values().next().value; left.delete(first); let ring = first.slice(); let cur = first;
    for (let guard = 0; guard < 10000; guard++) {
      const sx = sOf(cur.at(-1)); let best = first, bd = (sOf(first[0]) - sx + P) % P;
      for (const r of left) { const d = (sOf(r[0]) - sx + P) % P; if (d < bd) { bd = d; best = r; } }
      ring.push(...walk(sx, sOf(best[0])));
      if (best === first) break;
      left.delete(best); ring.push(...best); cur = best;
    }
    land.push(ring);
  }
  if (!runs.length && !land.length) land.push([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]); // no coast: all land
  return land;
}

/** The coarse backdrop around a region (rules.json "backdrop", raw/backdrop.json.gz from pipeline/import-pbf-backdrop.mjs)
 *  as data/basemap-backdrop.json, in the same shape as the street map plus land and built-up areas: land (from the
 *  coastline; the rest of the box is sea), big green and water areas, built-up areas, motorways and trunk roads.
 *  Inside the region's own box only the land is kept: the street map is drawn there. */
export function processBackdrop(id) {
  const src = `regions/${id}/raw/backdrop.json.gz`; if (!existsSync(at(src))) return null;
  const rules = readJson(`regions/${id}/rules.json`); const bd = rules.backdrop; if (!bd) return null;
  const raw = JSON.parse(gunzipSync(readFileSync(at(src))).toString('utf8'));
  const cfg = readJson(`regions/${id}/region.json`); const B = cfg.bbox, BB = raw.bbox;
  const boxCenter = (b) => ({ lat: +((b.south + b.north) / 2).toFixed(6), lon: +((b.west + b.east) / 2).toFixed(6) });
  const center = boxCenter(B);
  const P = (lat, lon) => [(lon - center.lon) * K * R * Math.cos(center.lat * K), (lat - center.lat) * K * R];
  const fc = cfg.frame ? boxCenter(readJson(`regions/${cfg.frame}/region.json`).bbox) : center;
  const sx = Math.cos(fc.lat * K) / Math.cos(center.lat * K);
  const [ox, oy] = [(center.lon - fc.lon) * K * R * Math.cos(fc.lat * K), (center.lat - fc.lat) * K * R];
  const out = cfg.frame ? ([x, y]) => [x * sx + ox, y + oy] : (p) => p;
  const flatOut = (pts) => flat(pts.map(out));
  const [X0, Y0] = P(BB.south, BB.west), [X1, Y1] = P(BB.north, BB.east); const big = boxTools(X0, X1, Y0, Y1);
  const [d0x, d0y] = P(B.south, B.west), [d1x, d1y] = P(B.north, B.east); const own = boxTools(d0x, d1x, d0y, d1y);
  const notOwn = { inside: (p) => !own.inside(p), edgeAt: own.edgeAt };
  const geom = (g) => g.map((q) => P(q.lat, q.lon));
  const tol = bd.tolM, minA = Object.fromEntries(Object.entries(bd.minAreaKm2).map(([k, v]) => [k, v * 1e6]));
  const closeSimp = (r, t) => { const s = simplify([...r, r[0]], t); return s.slice(0, -1); };
  const kindOf = (t) => t.natural === 'water' || t.landuse === 'reservoir' ? 'water'
    : ['wood', 'wetland', 'scrub'].includes(t.natural) || t.landuse === 'forest' || t.leisure === 'nature_reserve' ? 'green'
    : ['residential', 'commercial', 'industrial', 'retail'].includes(t.landuse) ? 'urban' : null;
  const acc = { water: [], green: [], urban: [], land: [] }; const roads = Object.fromEntries(Object.keys(ROAD_TOL).map((c) => [c, []]));
  const coast = []; const seen = new Set();
  for (const e of raw.elements) {
    const k0 = `${e.osmType ?? e.type}/${e.id}`; if (seen.has(k0)) continue; seen.add(k0); const t = e.tags || {};
    if (e.type === 'way' && t.natural === 'coastline') { coast.push(geom(e.geometry)); continue; }
    if (e.type === 'way' && bd.roads.includes(t.highway)) {
      for (const run of clipRuns(geom(e.geometry), big.inside, big.edgeAt)) for (const r of clipRuns(run, notOwn.inside, notOwn.edgeAt)) {
        const pts = simplify(r, tol.road); if (pts.length > 1) roads[ROAD_CLASS[t.highway]].push(flatOut(pts));
      }
      continue;
    }
    const kind = e.type === 'relation' ? kindOf(t) : null; if (!kind) continue;
    const holes = memberRings(e, 'inner').map((r) => big.clip(closeSimp(geom(r).slice(0, -1), tol[kind]))).filter((r) => r.length >= 3 && Math.abs(ringArea(r)) >= minA[kind]);
    for (const o of memberRings(e, 'outer')) {
      const ring = big.clip(closeSimp(geom(o).slice(0, -1), tol[kind])); if (ring.length < 3 || Math.abs(ringArea(ring)) < minA[kind] || ring.every(own.inside)) continue;
      acc[kind].push([flatOut(ring), ...holes.filter((h) => insideRing(h[0], ring)).map(flatOut)]);
    }
  }
  // rail: the parts of the listed routes outside the region's box, chained as processRegion chains them (from the
  // region's own raw rail file) so they meet its lines exactly at the box edge
  const rail = [];
  if (bd.rail?.length) {
    const rr = readJson(`regions/${id}/raw/overpass.json`).elements; const rways = new Map(rr.filter((e) => e.type === 'way').map((w) => [w.id, w]));
    const rrels = new Map(rr.filter((e) => e.type === 'relation').map((r) => [r.id, r]));
    const own0 = existsSync(at(`regions/${id}/data/region.json`)) ? readJson(`regions/${id}/data/region.json`).lines ?? [] : [];
    for (const L of bd.rail) {
      const rel = rrels.get(L.relation); if (!rel) throw new Error(`[${id}] backdrop rail: relation ${L.relation} (${L.line}) is not in raw/overpass.json`);
      const tw = rel.members.filter((m) => m.type === 'way' && !/platform/.test(m.role || '')).map((m) => rways.get(m.ref)).filter((w) => w?.geometry && !/platform/.test(w.tags?.railway || '') && w.tags?.public_transport !== 'platform');
      const full = chain(tw.map((w) => geom(w.geometry)));
      const runs = [];
      for (const run of clipRuns(full, big.inside, big.edgeAt)) for (const r of clipRuns(run, notOwn.inside, notOwn.edgeAt)) { const pts = simplify(r, tol.rail); if (pts.length > 1) runs.push(flatOut(pts)); }
      const mine = own0.find((l) => l.id === L.line);
      rail.push({ line: L.line, name: L.name ?? mine?.name ?? rel.tags?.name ?? L.line, colour: L.colour !== undefined ? L.colour : mine?.color ?? null, ofRegion: !!mine, osmRelation: L.relation, runs });
    }
  }
  // exits: where a line runs on past the region's box toward a terminus far away (rules backdrop.exits): its path from
  // the box edge to the terminus (coarse; it may run past the backdrop) and the stations on the way, in order
  const exits = [];
  if (bd.exits?.length) {
    const rr = readJson(`regions/${id}/raw/overpass.json`).elements;
    const rways = new Map(rr.filter((e) => e.type === 'way').map((w) => [w.id, w])); const rnodes = new Map(rr.filter((e) => e.type === 'node').map((n) => [n.id, n]));
    const rrels = new Map(rr.filter((e) => e.type === 'relation').map((r) => [r.id, r]));
    const xraw = existsSync(at(`regions/${id}/raw/exits.json.gz`)) ? JSON.parse(gunzipSync(readFileSync(at(`regions/${id}/raw/exits.json.gz`))).toString('utf8')).exits : {};
    const clean = (n) => String(n || '').replace(/^([A-Z]{2,3}\d+[A-Z]?\s+)+/, '').replace(/\s*\(KTM\)\s*$/, '').replace(/^KTM\s+/, '').trim();
    for (const X of bd.exits) {
      const rel = rrels.get(X.relation); if (!rel) throw new Error(`[${id}] exit ${X.id}: relation ${X.relation} is not in raw/overpass.json`);
      const tw = rel.members.filter((m) => m.type === 'way' && !/platform/.test(m.role || '')).map((m) => rways.get(m.ref)).filter((w) => w?.geometry && !/platform/.test(w.tags?.railway || '') && w.tags?.public_transport !== 'platform');
      let path = chain(tw.map((w) => geom(w.geometry)));
      let stops = rel.members.filter((m) => m.type === 'node' && /^stop/.test(m.role || '')).map((m) => rnodes.get(m.ref)).filter(Boolean);
      if (X.toward === 'start') stops = stops.reverse();
      const term = P(stops.at(-1).lat, stops.at(-1).lon);
      if (d2(path[0], term) < d2(path.at(-1), term)) path = path.slice().reverse();
      // from the last point inside the region's box on
      let last = -1; for (let i = 0; i < path.length; i++) if (own.inside(path[i])) last = i;
      if (last < 0 || last === path.length - 1) throw new Error(`[${id}] exit ${X.id}: the line does not leave the box`);
      const out0 = [own.edgeAt(path[last + 1], path[last]), ...path.slice(last + 1)];
      // the label path starts back inside the map, at the `from` stop (the line can leave the screen anywhere on the way)
      let lead = [];
      if (X.from) { const f = stops.find((n) => clean(n.tags?.['name:en'] || n.tags?.name) === X.from); if (!f) throw new Error(`[${id}] exit ${X.id}: no stop "${X.from}"`);
        const cumP = cumOf(path); const fa = locate(path, cumP, P(f.lat, f.lon)); const k = cumP.findIndex((v) => v > fa.at); if (k > 0 && k <= last) lead = path.slice(k, last + 1); }
      const cum = cumOf(out0);
      const stations = [];
      for (const n of stops) { const c = P(n.lat, n.lon); if (own.inside(c)) continue; const at0 = locate(out0, cum, c); if (at0.d > 500) continue; stations.push({ name: clean(n.tags?.['name:en'] || n.tags?.name), country: 'MY', c: out0 && out(c).map(Math.round), at: at0.at }); }
      stations.sort((a, b) => a.at - b.at);
      let full = out0;
      if (X.trackTo) { // follow the main line from the end of the route to the terminus (shortest path over the track)
        const T = xraw[X.id]; if (!T) throw new Error(`[${id}] exit ${X.id}: no raw/exits.json.gz entry: run pipeline/import-pbf-exits.mjs`);
        const pt = new Map(); const adj = new Map(); const link = (a, b, w) => { if (!adj.has(a)) adj.set(a, []); adj.get(a).push([b, w]); };
        for (const w of T.ways) for (let i = 0; i < w.nodes.length; i++) { const [nid, lon, lat] = w.nodes[i]; pt.set(nid, P(lat, lon)); if (i) { const a = w.nodes[i - 1][0]; const d = d2(pt.get(a), pt.get(nid)); link(a, nid, d); link(nid, a, d); } }
        const nearest = (c) => { let b = null, bd0 = Infinity; for (const [k, p] of pt) { const d = d2(p, c); if (d < bd0) { bd0 = d; b = k; } } return b; };
        const goal = T.stations.find((n) => n.tags.name === X.trackTo || n.tags['name:en'] === X.trackTo); if (!goal) throw new Error(`[${id}] exit ${X.id}: no station "${X.trackTo}" in raw/exits.json.gz`);
        const s0 = nearest(full.at(-1)), g0 = nearest(P(goal.lat, goal.lon));
        const dist = new Map([[s0, 0]]), prev = new Map(), done = new Set(); const q = [[0, s0]];
        while (q.length) { q.sort((a, b) => b[0] - a[0]); const [d, u] = q.pop(); if (done.has(u)) continue; done.add(u); if (u === g0) break; for (const [v, w] of adj.get(u) ?? []) { const nd = d + w; if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, u); q.push([nd, v]); } } }
        if (!done.has(g0)) throw new Error(`[${id}] exit ${X.id}: no track from the end of the route to ${X.trackTo}`);
        const seq = []; for (let u = g0; u !== undefined; u = prev.get(u)) seq.push(pt.get(u)); seq.reverse();
        const cum2 = cumOf(seq); const base = cum.at(-1); const seen0 = new Set(stations.map((x) => x.name));
        // passenger stations only: not light rail / metro, not under construction, not operating (crew) stations
        const passenger = (n) => !n.tags.construction && !n.tags.disused && !['light_rail', 'subway', 'monorail'].includes(n.tags.station) && !/operasi/i.test(n.tags.name) && !(X.skipStations ?? []).includes(n.tags.name);
        const more = T.stations.filter(passenger).map((n) => { const c = P(n.lat, n.lon); const l = locate(seq, cum2, c); return { n, c, l }; }).filter((x) => x.l.d < 400)
          .map(({ n, c, l }) => ({ name: clean(n.tags['name:en'] || n.tags.name), country: n.tags.name === X.trackTo || n.tags['name:en'] === X.trackTo ? X.country : 'MY', c: out(c).map(Math.round), at: base + l.at }))
          .filter((x) => !seen0.has(x.name)).sort((a, b) => a.at - b.at).filter((x, i, a) => a.findIndex((y) => y.name === x.name) === i);
        stations.push(...more); full = [...full, ...seq];
      }
      exits.push({ id: X.id, line: X.line, terminus: X.terminus, country: X.country, services: X.services ?? null, osmRelation: X.relation,
        path: flatOut(simplify([...lead, ...full], tol.exitPath ?? 200)), edgeStation: stations[0]?.name ?? null, stations: stations.map(({ at: _a, ...q }) => q), ...(X.beyond ? { beyond: X.beyond } : {}), ...(X.beyondNote ? { note: X.beyondNote } : {}), sources: X.sources ?? [] });
    }
  }
  const land = landFromCoast(coast, X0, X1, Y0, Y1);
  if (!land) throw new Error(`[${id}] backdrop: the coastline is broken inside the box (a run ends inside it)`);
  if (!land.some((r) => insideRing([0, 0], r))) throw new Error(`[${id}] backdrop: the middle of the region is not on land (coastline direction?)`);
  for (const r of land) { const s = closeSimp(r, tol.coast); if (s.length >= 3) acc.land.push([flatOut(s)]); }
  const data = {
    meta: {
      id, bbox: BB, center: fc, fetchedAt: raw.fetched_at ?? null,
      source: `OpenStreetMap (${raw.source?.file ?? 'extract'}, as of ${raw.source?.replicationTimestamp ?? '?'}): coastline, forest and green areas, built-up areas, lakes and reservoirs, motorways and trunk roads`,
      attribution: '© OpenStreetMap contributors (ODbL)', ...(cfg.frame ? { frame: cfg.frame } : {}), part: 'backdrop',
      box: [...out([X0, Y0]), ...out([X1, Y1])].map((v) => Math.round(v)),
      thinned: `areas under ${Object.entries(bd.minAreaKm2).map(([k, v]) => `${v} km² (${k})`).join(', ')} left out, lines simplified to ${Object.entries(tol).map(([k, v]) => `${v} m (${k})`).join(', ')}; inside the region's box only the land`,
    },
    roads, water: acc.water, green: acc.green, places: [], land: acc.land, urban: acc.urban, ...(rail.length ? { rail } : {}), ...(exits.length ? { exits } : {}),
  };
  writeFileSync(at(`regions/${id}/data/basemap-backdrop.json`), JSON.stringify(data));
  console.log(`[${id}] backdrop: ${data.land.length} land, ${data.green.length} green, ${data.water.length} water, ${data.urban.length} built-up areas, ${roads.motorway.length + roads.trunk.length} road runs, rail ${rail.map((l) => `${l.line} ${l.runs.length}`).join(', ')}, exits ${exits.map((x) => `${x.id} → ${x.terminus} (${x.stations.length} stations)`).join(', ')}`);
  return data;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ids = process.argv[2] ? [process.argv[2]] : regionIds();
  for (const id of ids) { processRegion(id); processBasemap(id); processBackdrop(id); }
}
