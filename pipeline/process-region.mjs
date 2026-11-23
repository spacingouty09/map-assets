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
  const rawId = cfg.raw || id; const raw = readJson(`regions/${rawId}/raw/overpass.json`);
  const B = cfg.bbox; const center = { lat: +((B.south + B.north) / 2).toFixed(6), lon: +((B.west + B.east) / 2).toFixed(6) };
  const P = (lat, lon) => [(lon - center.lon) * K * R * Math.cos(center.lat * K), (lat - center.lat) * K * R];
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

export function processBasemap(id) {
  const src = `regions/${id}/raw/basemap.json.gz`; if (!existsSync(at(src))) return null;
  const raw = JSON.parse(gunzipSync(readFileSync(at(src))).toString('utf8'));
  const cfg = readJson(`regions/${id}/region.json`); const B = cfg.bbox;
  const center = { lat: +((B.south + B.north) / 2).toFixed(6), lon: +((B.west + B.east) / 2).toFixed(6) };
  const P = (lat, lon) => [(lon - center.lon) * K * R * Math.cos(center.lat * K), (lat - center.lat) * K * R];
  const [hx, hy] = [P(center.lat, B.east)[0], P(B.north, center.lon)[1]];
  const inBox = (p) => Math.abs(p[0]) <= hx && Math.abs(p[1]) <= hy;
  const edgeAt = (a, b) => {
    let t = 0; for (const [i, h] of [[0, hx], [1, hy]]) for (const s of [h, -h]) { const den = b[i] - a[i]; if (Math.abs(den) < 1e-9) continue; const u = (s - a[i]) / den; if (u > t && u <= 1) { const q = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]; if (Math.abs(q[0]) <= hx + 1e-6 && Math.abs(q[1]) <= hy + 1e-6) t = u; } }
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  const geom = (g) => g.map((q) => P(q.lat, q.lon));
  const roads = Object.fromEntries(Object.keys(ROAD_TOL).map((c) => [c, []])); const water = [], green = [], places = [];
  const seen = new Set(); // an element is listed once even when two statements of the query returned it
  const addPolys = (list, outers, inners, minArea) => {
    const holes = inners.map((r) => clipRing(simplify(geom(r), 3), hx, hy)).filter((r) => r.length >= 3 && Math.abs(ringArea(r)) >= minArea);
    for (const o of outers) {
      const ring = clipRing(simplify(geom(o), 3), hx, hy); if (ring.length < 3 || Math.abs(ringArea(ring)) < minArea) continue;
      list.push([flat(ring), ...holes.filter((h) => insideRing(h[0], ring)).map(flat)]);
    }
  };
  for (const e of raw.elements) {
    const key = `${e.type}/${e.id}`; if (seen.has(key)) continue; seen.add(key); const t = e.tags || {};
    if (e.type === 'node' && t.place && t.name) {
      const c = P(e.lat, e.lon); if (!inBox(c)) continue;
      const zh = t['name:zh-Hans'] || t['name:zh'];
      places.push({ name: t['name:en'] || t.name, ...(zh ? { nameZh: zh } : {}), kind: t.place, c: c.map((v) => Math.round(v)), osm: e.id });
    } else if (e.type === 'way' && t.highway && ROAD_CLASS[t.highway] && e.geometry) {
      const cls = ROAD_CLASS[t.highway];
      for (const run of clipRuns(geom(e.geometry), inBox, edgeAt)) { const pts = simplify(run, ROAD_TOL[cls]); if (pts.length > 1) roads[cls].push(flat(pts)); }
    } else if (isWater(t) || isGreen(t)) {
      const list = isWater(t) ? water : green; const min = isWater(t) ? MIN_AREA.water : MIN_AREA.green;
      if (e.type === 'way' && e.geometry?.length > 3) addPolys(list, [e.geometry], [], min);
      else if (e.type === 'relation' && e.members) addPolys(list, memberRings(e, 'outer'), memberRings(e, 'inner'), min);
    }
  }
  // a place mapped twice (same name within 1.5 km): the larger kind stays
  const RANK = { town: 0, suburb: 1, quarter: 2, neighbourhood: 3 };
  places.sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.osm - b.osm);
  const kept = places.filter((p, i) => !places.slice(0, i).some((q) => q.name === p.name && d2(q.c, p.c) < 1500));
  const data = {
    meta: {
      id, bbox: B, center, fetchedAt: raw.fetched_at ?? null,
      source: 'OpenStreetMap via the Overpass API: roads (residential and up), water and green areas, named places (town, suburb, quarter, neighbourhood)',
      attribution: '© OpenStreetMap contributors (ODbL)',
    },
    roads, water, green,
    places: kept.map(({ osm, ...p }) => p),
  };
  mkdirSync(at(`regions/${id}/data`), { recursive: true });
  writeFileSync(at(`regions/${id}/data/basemap.json`), JSON.stringify(data));
  const n = (cls) => roads[cls].length;
  console.log(`[${id}] base map: ${Object.keys(roads).map((c) => `${n(c)} ${c}`).join(', ')} road runs, ${water.length} water and ${green.length} green areas, ${kept.length} places`);
  return data;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ids = process.argv[2] ? [process.argv[2]] : regionIds();
  for (const id of ids) { processRegion(id); processBasemap(id); }
}
