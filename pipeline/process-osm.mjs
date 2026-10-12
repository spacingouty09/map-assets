// Convert areas/<id>/raw/overpass.json into compact local-metric JSON for the model (areas/<id>/data/), then
// regenerate the spot index (areas/index.json) and the typed loaders (src/areas.gen.ts, src/areas/<id>.gen.ts).
// Local frame: x = metres east, y = metres north of the area centre (equirectangular, fine for ~1 km).
// Area-specific choices (precincts, zones, landmarks, route anchors, KTM lines, model hints) come from
// areas/<id>/rules.json; everything else is the same for every area.
// Usage: npm run data:process [-- <area id>]   (no id = every area; paths are relative to the repo root)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { at, areaIds, areaConfig } from './config.mjs';

const R = 6378137;
const K = Math.PI / 180;
const LEVEL_H = 3.5; // metres per storey for building:levels -> height
const WALK_SPEED = 80; // m/min
const r1 = (v) => Math.round(v * 10) / 10;
const key = (p) => `${p.lat},${p.lon}`;
const readJson = (p, fallback) => (existsSync(at(p)) ? JSON.parse(readFileSync(at(p), 'utf8')) : fallback);

// ---------- geometry helpers ----------
const area = (ring) => { let a = 0; for (let i = 0, n = ring.length; i < n; i++) { const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % n]; a += x1 * y2 - x2 * y1; } return a / 2; };
const centroid = (ring) => {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, n = ring.length; i < n; i++) { const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % n]; const f = x1 * y2 - x2 * y1; a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f; }
  if (Math.abs(a) < 1e-9) { const s = ring.reduce((m, p) => [m[0] + p[0], m[1] + p[1]], [0, 0]); return [s[0] / ring.length, s[1] / ring.length]; }
  return [cx / (3 * a), cy / (3 * a)];
};
const inside = (pt, ring) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c; } return c; };
const len = (pts) => { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return s; };
const dropClosing = (ring) => (ring.length > 1 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1] ? ring.slice(0, -1) : ring);
const rnd = (pts) => pts.map(([x, y]) => [r1(x), r1(y)]);

// Assemble multipolygon outer rings from relation member geometries.
function relationRings(rel, role = 'outer') {
  const segs = (rel.members || []).filter((m) => m.type === 'way' && (m.role || 'outer') === role && m.geometry).map((m) => m.geometry.map((g) => ({ lat: g.lat, lon: g.lon })));
  const rings = []; const open = [];
  for (const s of segs) (key(s[0]) === key(s.at(-1)) ? rings : open).push(s);
  while (open.length) {
    let ring = open.shift(); let grew = true;
    while (key(ring[0]) !== key(ring.at(-1)) && grew) {
      grew = false;
      for (let i = 0; i < open.length; i++) {
        const s = open[i]; const end = key(ring.at(-1));
        if (key(s[0]) === end) ring = ring.concat(s.slice(1));
        else if (key(s.at(-1)) === end) ring = ring.concat(s.slice(0, -1).reverse());
        else continue;
        open.splice(i, 1); grew = true; break;
      }
    }
    rings.push(ring);
  }
  return rings;
}
const elRings = (el) => {
  if (el.type === 'way' && el.geometry) return [el.geometry];
  if (el.type === 'relation') return relationRings(el);
  return [];
};
const T = (e) => e.tags || {};
const num = (v) => { if (v == null) return null; const m = String(v).replace(',', '.').match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null; };
const yes = (v) => v != null && v !== 'no';

// Rail line of an OSM track way, by name (official line names, Malay or English).
const RAIL_LINES = [[/kelana jaya/i, 'lrt'], [/ktm/i, 'ktm'], [/erl|klia/i, 'erl'], [/putrajaya/i, 'py'], [/monorel|monorail/i, 'mr']];

function processArea(id) {
  const cfg = areaConfig(id);
  const CENTER = cfg.center; const H = cfg.halfSizeM; const BBOX = cfg.bbox;
  const dir = (p) => `areas/${id}/${p}`;
  const rules = readJson(dir('rules.json'), {});
  // rules.railLines: extra [name regex, line id] pairs tried before the shared list (e.g. Bukit Jalil: the Sri Petaling Line drawn as the area's 'lrt')
  const LINES = [...(rules.railLines ?? []).map(([re, l]) => [new RegExp(re, 'i'), l]), ...RAIL_LINES];
  const lineOf = (t) => LINES.find(([re]) => re.test(t.name || ''))?.[1] ?? 'other';
  const raw = JSON.parse(readFileSync(at(dir('raw/overpass.json')), 'utf8'));
  const cosLat = Math.cos(CENTER.lat * K);
  const proj = (p) => [(p.lon - CENTER.lon) * K * R * cosLat, (p.lat - CENTER.lat) * K * R];
  const inBox = ([x, y], m = 0) => Math.abs(x) <= H + m && Math.abs(y) <= H + m;

  function clipPolygon(ring) { // Sutherland-Hodgman against the study square
    let out = ring;
    const edges = [[0, 1, -H], [0, -1, H], [1, 1, -H], [1, -1, H]]; // axis, sign, limit : keep sign*(v) >= sign*limit
    for (const [ax, s, lim] of edges) {
      const inp = out; out = [];
      if (!inp.length) break;
      const ok = (p) => s * p[ax] >= s * lim;
      for (let i = 0; i < inp.length; i++) {
        const cur = inp[i], prev = inp[(i + inp.length - 1) % inp.length];
        const cross = () => { const t = (lim - prev[ax]) / (cur[ax] - prev[ax]); return [prev[0] + t * (cur[0] - prev[0]), prev[1] + t * (cur[1] - prev[1])]; };
        if (ok(cur)) { if (!ok(prev)) out.push(cross()); out.push(cur); } else if (ok(prev)) out.push(cross());
      }
    }
    return out;
  }
  function clipLine(pts) { // Liang-Barsky per segment, returns list of polylines
    const res = []; let curr = null;
    for (let i = 1; i < pts.length; i++) {
      let [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      let t0 = 0, t1 = 1; const dx = x1 - x0, dy = y1 - y0; let ok = true;
      for (const [p, q] of [[-dx, x0 + H], [dx, H - x0], [-dy, y0 + H], [dy, H - y0]]) {
        if (p === 0) { if (q < 0) { ok = false; break; } } else { const t = q / p; if (p < 0) { if (t > t1) { ok = false; break; } if (t > t0) t0 = t; } else { if (t < t0) { ok = false; break; } if (t < t1) t1 = t; } }
      }
      if (!ok) { curr = null; continue; }
      const a = [x0 + t0 * dx, y0 + t0 * dy], b = [x0 + t1 * dx, y0 + t1 * dy];
      if (!curr || t0 > 0) { curr = [a]; res.push(curr); }
      curr.push(b);
      if (t1 < 1) curr = null;
    }
    return res.filter((l) => l.length > 1 && len(l) > 0.5);
  }

  // ---------- cited corrections to OSM tags (sources/overrides.json) ----------
  // Where OSM lags behind (e.g. a building still tagged as a construction site after it opened), a cited override
  // replaces tags before processing; the building keeps a record of it.
  const OV = readJson(dir('sources/overrides.json'), { overrides: {} });
  const els = raw.elements.map((e) => { const o = OV.overrides[`${e.type}/${e.id}`]; return o ? { ...e, tags: { ...e.tags, ...o.tags }, override: { ...o, fetched: o.fetched ?? OV.fetched } } : e; });

  // ---------- precincts (named landuse) ----------
  const precincts = [];
  for (const e of els) {
    const t = T(e); if (!t.landuse || !t.name) continue;
    for (const g of elRings(e)) {
      const ring = dropClosing(g.map(proj)); if (ring.length < 3) continue;
      precincts.push({ id: `${e.type}/${e.id}`, name: t.name, landuse: t.landuse, ring: rnd(ring) });
    }
  }
  const precinctRing = (name) => precincts.find((p) => p.name === name)?.ring ?? null;
  const precinctOf = (c) => { for (const name of rules.precincts ?? []) { const ring = precinctRing(name); if (ring && inside(c, ring)) return name; } return null; };

  // ---------- buildings ----------
  function heightInfo(t) {
    const h = num(t.height); const lv = num(t['building:levels']);
    let minH = num(t.min_height); const minLv = num(t['building:min_level']);
    if (minH == null && minLv != null) minH = minLv * LEVEL_H;
    if (h != null && h > 0) return { height: h, heightSource: 'osm', levels: lv, minHeight: minH || 0 };
    if (lv != null && lv > 0) return { height: lv * LEVEL_H, heightSource: 'levels', levels: lv, minHeight: minH || 0 };
    return null;
  }
  function estimate(t) { // modest defaults, flagged as estimates
    const b = t.building || t['building:part'];
    if (b === 'roof') return 5;
    if (['industrial', 'warehouse', 'temple', 'mosque', 'commercial', 'retail', 'mall'].includes(b)) return 9;
    return 7;
  }
  const outlines = []; const parts = [];
  for (const e of els) {
    const t = T(e);
    const isPart = t['building:part'] && !t.building;
    if (!t.building && !isPart) continue;
    for (const g of elRings(e)) {
      const ring = dropClosing(g.map(proj)); if (ring.length < 3) continue;
      const a = area(ring); const poly = a < 0 ? ring.slice().reverse() : ring; // CCW
      const item = { id: `${e.type}/${e.id}`, tags: t, ring: poly, area: Math.abs(a), c: centroid(poly), override: e.override };
      (isPart ? parts : outlines).push(item);
    }
  }
  // attach parts to outlines
  for (const p of parts) p.parent = outlines.find((o) => inside(p.c, o.ring)) || null;
  // rules.partParents: a part whose centre lies in several outlines (e.g. the Petronas skybridge above Suria KLCC) -> its outline
  for (const [pid, oid] of Object.entries(rules.partParents ?? {})) { const p = parts.find((x) => x.id === pid); const o = outlines.find((x) => x.id === oid); if (p && o) p.parent = o; else console.warn(`[${id}] partParents: ${pid} -> ${oid} not found`); }
  for (const o of outlines) { o.parts = parts.filter((p) => p.parent === o); o.partArea = o.parts.reduce((s, p) => s + p.area, 0); }

  const buildings = [];
  const pushB = (item, info, extra = {}) => {
    if (!inBox(item.c)) return;
    const t = item.tags;
    const b = {
      id: item.id,
      name: t.name || null,
      type: t.building || t['building:part'],
      part: !!extra.part,
      parent: extra.parentId || null,
      height: r1(info.height), minHeight: r1(info.minHeight || 0), levels: info.levels ?? null,
      heightSource: info.heightSource, heightNote: extra.note || undefined,
      precinct: precinctOf(item.c),
      station: t.railway === 'station' || t.public_transport === 'station' ? (t.ref || t.name) : null,
      area: Math.round(item.area),
      c: [r1(item.c[0]), r1(item.c[1])],
      ring: rnd(item.ring),
    };
    if (item.override) b.override = { reason: item.override.reason, publisher: item.override.publisher, url: item.override.url, fetched: item.override.fetched };
    buildings.push(b);
  };
  let skippedOutlines = 0;
  for (const o of outlines) {
    const own = heightInfo(o.tags);
    const useParts = o.parts.length && o.partArea >= 0.5 * o.area;
    if (useParts) {
      skippedOutlines++;
      for (const p of o.parts) {
        const pi = heightInfo(p.tags);
        if (pi) pushB(p, pi, { part: true, parentId: o.id });
        else if (own) pushB(p, { ...own, heightSource: 'estimate', minHeight: num(p.tags.min_height) || 0 }, { part: true, parentId: o.id, note: `estimate: inherited from parent outline (${own.heightSource})` });
        else pushB(p, { height: estimate(p.tags), heightSource: 'estimate', minHeight: 0, levels: null }, { part: true, parentId: o.id });
      }
    } else {
      pushB(o, own || { height: estimate(o.tags), heightSource: 'estimate', minHeight: 0, levels: null });
    }
  }
  // orphan parts (no enclosing outline)
  for (const p of parts.filter((p) => !p.parent)) {
    const pi = heightInfo(p.tags) || { height: estimate(p.tags), heightSource: 'estimate', minHeight: 0, levels: null };
    pushB(p, pi, { part: true });
  }

  // ---------- cited heights (sources/height-sources.json, see the area's height-sources.md) ----------
  const HS = readJson(dir('sources/height-sources.json'), { fetched: null, storeyHeights: { default: LEVEL_H }, buildings: [] });
  const citedLog = [];
  const outlineCited = new Map();
  for (const src of HS.buildings) {
    const storey = src.unit === 'floors' ? HS.storeyHeights[src.use || 'default'] : null;
    const h = src.unit === 'm' ? src.value : src.value * storey;
    const ref = { value: src.value, unit: src.unit, floors: src.floors ?? (src.unit === 'floors' ? src.value : null), storeyHeight: storey, publisher: src.publisher, url: src.url, fetched: src.fetched ?? HS.fetched, note: src.note, ctbuhEstimated: !!src.ctbuhEstimated };
    const applied = [];
    for (const b of buildings.filter((x) => x.name === src.osmName)) {
      applied.push({ id: b.id, from: `${b.height} m (${b.heightSource})` });
      Object.assign(b, { height: r1(h), heightSource: 'cited', heightRef: ref }); delete b.heightNote;
    }
    if (src.applyToUntaggedParts) {
      const o = outlines.find((x) => x.tags.name === src.osmName);
      if (o) {
        outlineCited.set(o.id, { h: r1(h), ref });
        for (const b of buildings.filter((x) => x.parent === o.id && x.heightSource === 'estimate' && (!x.name || x.name === src.osmName))) { // named parts (e.g. Centrepoint North/South) are separate buildings: not touched
          applied.push({ id: b.id, from: `${b.height} m (estimate)` });
          Object.assign(b, { height: r1(h), heightSource: 'cited', heightRef: { ...ref, note: `${ref.note} (untagged part of ${src.osmName})` } }); delete b.heightNote;
        }
      }
    }
    citedLog.push({ name: src.osmName, height: r1(h), applied });
  }

  // ---------- zones (rules.zones: by building / outline name, or by precinct; priority decides) ----------
  const outlineName = new Map(outlines.map((o) => [o.id, o.tags.name]));
  // zone.near: blocks of the given OSM building types within radiusM of a point (e.g. the National Stadium roof, mapped as
  // hundreds of unnamed building=roof pieces under a leisure=stadium outline that has no building tag)
  const zoneRules = (rules.zones ?? []).map((z) => ({ ...z, nameSet: new Set(z.names ?? []), nearPt: z.near ? proj(z.near) : null }));
  const isNear = (zr, b) => !!zr.nearPt && (!zr.near.types || zr.near.types.includes(b.type)) && Math.hypot(b.c[0] - zr.nearPt[0], b.c[1] - zr.nearPt[1]) <= zr.near.radiusM;
  const byPriority = zoneRules.slice().sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  for (const b of buildings) {
    const parentName = b.parent ? outlineName.get(b.parent) : null;
    const z = byPriority.find((zr) => (zr.names && (zr.nameSet.has(b.name) || zr.nameSet.has(parentName))) || (zr.precinct && b.precinct === zr.precinct) || isNear(zr, b));
    b.zone = z ? z.id : null;
  }
  // footprint per zone: union of block footprints rasterised on a 1 m grid (overlapping parts counted once)
  const zoneStats = {};
  for (const z of [...new Set(zoneRules.map((zr) => zr.id))]) {
    const bs = buildings.filter((b) => b.zone === z);
    const cells = new Set();
    for (const b of bs) {
      const xs = b.ring.map((p) => p[0]), ys = b.ring.map((p) => p[1]);
      for (let x = Math.floor(Math.min(...xs)); x < Math.max(...xs); x++) for (let y = Math.floor(Math.min(...ys)); y < Math.max(...ys); y++) if (inside([x + 0.5, y + 0.5], b.ring)) cells.add(x * 100000 + y);
    }
    const named = [...new Set(bs.filter((b) => b.name).map((b) => b.name))];
    const tallest = bs.filter((b) => b.heightSource !== 'estimate').sort((a, b) => b.height - a.height)[0];
    const cx = bs.reduce((s, b) => s + b.c[0], 0) / (bs.length || 1), cy = bs.reduce((s, b) => s + b.c[1], 0) / (bs.length || 1);
    zoneStats[z] = { blocks: bs.length, footprintM2: cells.size, namedBuildings: named, tallest: tallest ? { name: tallest.name, height: tallest.height, heightSource: tallest.heightSource } : null, centroid: [r1(cx), r1(cy)] };
  }

  // ---------- landmarks (rules.landmarks, selected by OSM name; rules.podiums: landmarks standing on another block) ----------
  const LANDMARK_PODIUMS = rules.podiums ?? {};
  const landmarks = [];
  for (const { name, kind } of rules.landmarks ?? []) {
    const el = els.find((e) => T(e).name === name && T(e).building);
    if (!el) { console.warn(`[${id}] landmark not found:`, name); continue; }
    const t = T(el); const lid = `${el.type}/${el.id}`;
    const outers = elRings(el).map((g) => dropClosing(g.map(proj))).filter((r) => r.length >= 3);
    const holes = el.type === 'relation' ? relationRings(el, 'inner').map((g) => dropClosing(g.map(proj))).filter((r) => r.length >= 3) : [];
    const ccw = (r) => (area(r) < 0 ? r.slice().reverse() : r);
    const polys = outers.map((o) => ({ outer: rnd(ccw(o)), holes: holes.filter((h) => inside(h[0], o)).map((h) => rnd(h)) }));
    const big = outers.map(ccw).sort((a, b) => area(b) - area(a))[0];
    const c = centroid(big);
    const geo = (el.type === 'relation' ? el.members.flatMap((m) => m.geometry || []) : el.geometry);
    const lat = geo.reduce((s, g) => s + g.lat, 0) / geo.length, lon = geo.reduce((s, g) => s + g.lon, 0) / geo.length;
    const b = buildings.find((x) => x.id === lid);
    if (b) {
      b.landmark = kind;
      const cfgP = LANDMARK_PODIUMS[lid];
      const pod = cfgP && buildings.find((o) => o.id === cfgP.podium && inside(b.c, o.ring));
      if (cfgP && !pod) console.warn(`[${id}] podium not found / does not enclose landmark:`, cfgP.podium, lid);
      if (pod) {
        const podEl = els.find((e) => `${e.type}/${e.id}` === pod.id); const pt = T(podEl || {});
        const own = b.height - b.minHeight; // the landmark's own (placeholder) height
        pod.podiumFor = lid;
        pod.podiumName = pt.name || cfgP.name; pod.podiumNameSource = pt.name ? 'osm' : cfgP.nameSource;
        pod.podiumTags = { amenity: pt.amenity || null, parking: pt.parking || null };
        b.minHeight = pod.height; b.height = r1(pod.height + own);
        b.heightNote = `estimate: ${own} m placeholder above the ${pod.height} m roof of ${pod.podiumName} (${pod.levels} levels x ${LEVEL_H} m, OSM building:levels; ${kind} on the car park: ${cfgP.nameSource})`;
        b.podium = pod.id;
      }
    }
    const lparts = b ? [] : buildings.filter((x) => x.parent === lid); // landmark drawn as building:parts (e.g. the Petronas Towers)
    for (const pb of lparts) pb.landmark = kind;
    const tallestPart = lparts.length ? lparts.reduce((m, x) => (x.height > m.height ? x : m)) : null;
    const oc = b ? null : outlineCited.get(lid);
    const info = oc ? { height: oc.h, heightSource: 'cited', minHeight: 0 } : tallestPart ? { height: tallestPart.height, heightSource: tallestPart.heightSource, minHeight: 0 } : heightInfo(t) || { height: estimate(t), heightSource: 'estimate' };
    landmarks.push({ id: lid, kind, name: t.name, nameEn: t['name:en'] || null, altName: t.alt_name || null, religion: t.religion || els.find((e) => e.type === 'way' && el.members?.some((m) => m.ref === e.id && m.role === 'outer'))?.tags?.religion || null,
      c: [r1(c[0]), r1(c[1])], lat: +lat.toFixed(7), lon: +lon.toFixed(7), inStudyArea: inBox(c), buildingId: b ? lid : null,
      height: b ? b.height : r1(info.height), base: b ? b.minHeight : r1(info.minHeight || 0), heightSource: b ? b.heightSource : info.heightSource,
      podium: b?.podium ? (({ id: pid, podiumName: pname, podiumNameSource: nameSource, levels, height }) => ({ id: pid, name: pname, nameSource, levels, storeyM: levels ? r1(height / levels) : null, roof: height }))(buildings.find((o) => o.id === b.podium)) : null,
      polygons: b ? [] : polys });
  }

  const outlineIndex = outlines.filter((o) => o.tags.name && inBox(o.c)).map((o) => {
    const own = heightInfo(o.tags);
    const ph = o.parts.map((p) => buildings.find((b) => b.id === p.id)).filter(Boolean);
    const maxB = ph.length ? ph.reduce((m, b) => (b.height > m.height ? b : m)) : null;
    const oc = outlineCited.get(o.id);
    return { id: o.id, name: o.tags.name, type: o.tags.building, c: [r1(o.c[0]), r1(o.c[1])], area: Math.round(o.area), renderedAsParts: !!(o.parts.length && o.partArea >= 0.5 * o.area), ownHeight: oc ? oc.h : own ? r1(own.height) : null, ownHeightSource: oc ? 'cited' : own ? own.heightSource : 'none', heightRef: oc ? oc.ref : undefined, levels: own?.levels ?? null, tallestPart: maxB ? { id: maxB.id, name: maxB.name, height: maxB.height, heightSource: maxB.heightSource, levels: maxB.levels } : null, ring: rnd(o.ring) };
  });

  // ---------- building footprint index (for 'inside a building' checks) ----------
  const bIndex = [...outlines, ...parts].map((o) => { const xs = o.ring.map((p) => p[0]), ys = o.ring.map((p) => p[1]); return { ring: o.ring, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }; });
  const inBuildingPt = (pt) => bIndex.some((b) => pt[0] >= b.x0 && pt[0] <= b.x1 && pt[1] >= b.y0 && pt[1] <= b.y1 && inside(pt, b.ring));
  const shelterOf = (attrs, a, b) => {
    const inB = inBuildingPt([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    const indoor = attrs.indoor || attrs.kind === 'corridor';
    const sheltered = indoor || attrs.covered || inB;
    const reason = indoor ? 'indoor' : attrs.covered ? 'covered-tag' : inB ? 'in-building' : 'open';
    const share = attrs.bridge ? 'bridge' : indoor ? 'indoor' : attrs.covered || inB ? 'covered' : 'open';
    return { sheltered, reason, share };
  };

  // ---------- lines ----------
  const ROAD_W = { motorway: 14, trunk: 14, primary: 12, secondary: 10, tertiary: 8, motorway_link: 7, trunk_link: 7, primary_link: 7, secondary_link: 6, tertiary_link: 6, residential: 6, unclassified: 6, service: 4 };
  const PED = new Set(['footway', 'pedestrian', 'steps', 'path', 'corridor']);
  const roads = [], rails = [], footways = [], waterLines = [], green = [];
  const waterAreas = [];
  for (const e of els) {
    const t = T(e);
    if (e.type === 'way' && e.geometry && t.highway) {
      const pts = e.geometry.map(proj);
      for (const seg of clipLine(pts)) {
        if (PED.has(t.highway)) {
          const attrs = { kind: t.highway, bridge: yes(t.bridge), covered: yes(t.covered), indoor: yes(t.indoor) };
          let run = null;
          for (let i = 1; i < seg.length; i++) {
            const sh = shelterOf(attrs, seg[i - 1], seg[i]);
            if (!run || run.sheltered !== sh.sheltered || run.shelter !== sh.reason) { run = { id: e.id, kind: t.highway, bridge: attrs.bridge, covered: attrs.covered, indoor: attrs.indoor, layer: num(t.layer) || 0, sheltered: sh.sheltered, shelter: sh.reason, pts: [seg[i - 1]] }; footways.push(run); }
            run.pts.push(seg[i]);
          }
        }
        else if (ROAD_W[t.highway]) roads.push({ id: e.id, cls: t.highway, name: t.name || null, w: ROAD_W[t.highway], bridge: yes(t.bridge), tunnel: yes(t.tunnel), layer: num(t.layer) || 0, pts: rnd(seg) });
      }
    }
    if (e.type === 'way' && e.geometry && ['light_rail', 'rail', 'subway', 'monorail'].includes(t.railway)) {
      for (const seg of clipLine(e.geometry.map(proj))) rails.push({ id: e.id, line: lineOf(t), name: t.name || null, elevated: yes(t.bridge) || (num(t.layer) || 0) > 0, tunnel: t.tunnel === 'yes', layer: num(t.layer) || 0, service: t.service || null, pts: rnd(seg) });
    }
    if (e.type === 'way' && e.geometry && t.waterway) {
      for (const seg of clipLine(e.geometry.map(proj))) waterLines.push({ id: e.id, kind: t.waterway, name: t['name:en'] || t.name || null, width: num(t.width), pts: rnd(seg) });
    }
    const isWater = t.natural === 'water'; const isGreen = ['park', 'garden'].includes(t.leisure) || ['grass', 'recreation_ground'].includes(t.landuse);
    if (isWater || isGreen) {
      for (const g of elRings(e)) {
        const ring = clipPolygon(dropClosing(g.map(proj))); if (ring.length < 3) continue;
        (isWater ? waterAreas : green).push({ id: `${e.type}/${e.id}`, name: t.name || null, ring: rnd(ring) });
      }
    }
  }

  // ---------- stations ----------
  const stations = [];
  for (const e of els) {
    const t = T(e); if (t.railway !== 'station') continue;
    const ring = e.geometry ? dropClosing(e.geometry.map(proj)) : null;
    const c = ring ? centroid(ring) : proj(e);
    stations.push({ id: `${e.type}/${e.id}`, ref: t.ref || null, name: (t.name || '').replace(/^[A-Z]{2}\d+[A-Z]?\s+/, ''), osmName: t.name, operator: t.operator || null, layer: num(t.layer) || 0, c: [r1(c[0]), r1(c[1])] });
  }

  // ---------- facilities: hotels, car parks, bus stops, station entrances ----------
  const pointOf = (e) => { if (e.type === 'node') return proj(e); const rings = elRings(e); const big = rings.map((g) => dropClosing(g.map(proj))).filter((r) => r.length >= 3).sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)))[0]; return big ? centroid(big) : null; };
  const STAY = new Set(['hotel', 'apartment', 'hostel', 'guest_house', 'motel']);
  const facilities = { hotels: [], parking: [], parkingEntrances: [], busStops: [], stationEntrances: [] };
  for (const e of els) {
    const t = T(e); const c = pointOf(e); if (!c || !inBox(c)) continue;
    const base = { id: `${e.type}/${e.id}`, name: t.name || null, nameEn: t['name:en'] || null, c: [r1(c[0]), r1(c[1])] };
    if (STAY.has(t.tourism)) facilities.hotels.push({ ...base, kind: t.tourism, stars: num(t.stars), website: t.website || t['contact:website'] || null });
    if (t.amenity === 'parking') facilities.parking.push({ ...base, parking: t.parking || null, capacity: num(t.capacity), fee: t.fee || null, building: !!t.building, ring: e.type === 'way' && e.geometry ? rnd(dropClosing(e.geometry.map(proj))) : null });
    if (t.amenity === 'parking_entrance') facilities.parkingEntrances.push({ ...base, parking: t.parking || null });
    if (e.type === 'node' && (t.highway === 'bus_stop' || (t.public_transport === 'platform' && t.bus === 'yes'))) facilities.busStops.push({ ...base, ref: t.ref || null, routes: (t.route_ref || '').split(/\s*;\s*/).filter(Boolean), shelter: t.shelter ? yes(t.shelter) : null, network: t.network || null });
    if (t.railway === 'subway_entrance' || t.railway === 'train_station_entrance') facilities.stationEntrances.push({ ...base, ref: t.ref || null, level: t.level ?? null });
  }
  for (const se of facilities.stationEntrances) { const s = stations.slice().sort((a, b) => Math.hypot(a.c[0] - se.c[0], a.c[1] - se.c[1]) - Math.hypot(b.c[0] - se.c[0], b.c[1] - se.c[1]))[0]; se.station = s ? s.ref || s.name : null; }

  // ---------- pedestrian routing on OSM topology ----------
  // Shared OSM nodes have identical coordinates, so coordinates act as node ids.
  const WALKABLE_ROADS = new Set(['primary', 'secondary', 'tertiary', 'primary_link', 'secondary_link', 'tertiary_link', 'residential', 'unclassified', 'service']);
  const nodes = new Map(); // key -> {p, edges:[]}
  const node = (g) => { const k = key(g); let n = nodes.get(k); if (!n) { n = { k, p: proj(g), edges: [], ped: false }; nodes.set(k, n); } return n; };
  for (const e of els) {
    const t = T(e); if (e.type !== 'way' || !e.geometry || !t.highway) continue;
    const ped = PED.has(t.highway); if (!ped && !WALKABLE_ROADS.has(t.highway)) continue;
    if (t.foot === 'no' || t.access === 'no') continue;
    const attrs = { way: e.id, kind: ped ? t.highway : 'road', road: ped ? null : t.highway, name: t.name || null, bridge: yes(t.bridge), covered: yes(t.covered), indoor: yes(t.indoor), layer: num(t.layer) || 0 };
    const factor = ped ? 1 : 1.8; // prefer mapped pedestrian ways; roads assume walking along the roadside
    for (let i = 1; i < e.geometry.length; i++) {
      const a = node(e.geometry[i - 1]), b = node(e.geometry[i]);
      if (ped) { a.ped = true; b.ped = true; }
      const d = Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1]);
      a.edges.push({ to: b, d, cost: d * factor, attrs }); b.edges.push({ to: a, d, cost: d * factor, attrs });
    }
  }
  function nearest(pt, pedOnly = true) {
    let best = null, bd = Infinity;
    for (const n of nodes.values()) { if (pedOnly && !n.ped) continue; const d = Math.hypot(n.p[0] - pt[0], n.p[1] - pt[1]); if (d < bd) { bd = d; best = n; } }
    return { n: best, d: bd };
  }
  function dijkstra(src, dst) {
    const dist = new Map([[src, 0]]); const prev = new Map(); const done = new Set();
    const heap = [[0, src]];
    const push = (it) => { heap.push(it); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    while (heap.length) {
      const [d, u] = pop(); if (done.has(u)) continue; done.add(u); if (u === dst) break;
      for (const e of u.edges) { const nd = d + e.cost; if (nd < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, nd); prev.set(e.to, { n: u, e }); push([nd, e.to]); } }
    }
    if (!done.has(dst)) return null;
    const steps = []; let cur = dst;
    while (cur !== src) { const { n, e } = prev.get(cur); steps.push({ a: n, b: cur, e }); cur = n; }
    return steps.reverse();
  }
  const byName = (n) => { const o = outlines.find((x) => x.tags.name === n) || parts.find((x) => x.tags.name === n); return o ? { c: o.c } : null; };
  const st = (ref) => stations.find((s) => s.ref === ref);
  // route anchors (rules.anchors): a station by ref, a building by OSM name, or the named building closest to the pedestrian graph
  const anchors = {};
  for (const a of rules.anchors ?? []) {
    if (a.closestOf) {
      const cands = a.closestOf.map((n) => ({ n, c: byName(n)?.c })).filter((x) => x.c).map((x) => ({ ...x, snap: nearest(x.c).d }));
      const best = cands.sort((p, q) => p.snap - q.snap)[0];
      if (best) anchors[a.id] = { label: a.labelTemplate.replace('{name}', best.n), pt: best.c };
    } else if (a.footway) { // the end of a named footway inside the study square, e.g. where a walkway leaves it
      const pts = footways.filter((f) => f.pts.length && els.some((e) => e.id === f.id && T(e).name === a.footway)).flatMap((f) => f.pts);
      const score = { north: (q) => q[1], south: (q) => -q[1], east: (q) => q[0], west: (q) => -q[0] }[a.end];
      const pt = pts.length ? pts.reduce((m, q) => (score(q) > score(m) ? q : m)) : undefined;
      anchors[a.id] = { label: a.label, pt: pt ? [r1(pt[0]), r1(pt[1])] : undefined };
    } else if (a.point) { // a point read off OSM (an object outside the Overpass pull, e.g. a leisure=stadium outline without a building tag); a.pointNote says which
      anchors[a.id] = { label: a.label, pt: (([x, y]) => [r1(x), r1(y)])(proj(a.point)) };
    } else anchors[a.id] = { label: a.label, pt: a.station ? st(a.station)?.c : byName(a.building)?.c };
  }
  const within = (rules.routeWithin ?? []).map((w) => ({ key: w.key, ring: precinctRing(w.precinct) }));
  function computeRoute(rid, from, to) {
    const A = anchors[from], B = anchors[to];
    if (!A?.pt || !B?.pt) return { id: rid, from, to, error: 'anchor missing' };
    const sa = nearest(A.pt), sb = nearest(B.pt);
    const steps = dijkstra(sa.n, sb.n);
    if (!steps) return { id: rid, from, to, fromLabel: A.label, toLabel: B.label, error: 'no connected path in OSM graph' };
    const segs = [];
    for (const s of steps) {
      const att = s.e.attrs; const cls = att.kind === 'road' ? 'road' : att.bridge ? (att.indoor || att.covered ? 'bridge-enclosed' : 'bridge') : att.indoor || att.kind === 'corridor' ? 'indoor' : att.kind === 'steps' ? 'steps' : att.covered ? 'covered' : 'footway';
      const sh = shelterOf(att, s.a.p, s.b.p);
      const last = segs.at(-1);
      if (last && last.cls === cls && last.layer === att.layer && last.sheltered === sh.sheltered && last.share === sh.share) { last.pts.push(s.b.p); last.length += s.e.d; last.ways.add(att.way); }
      else segs.push({ cls, layer: att.layer, road: att.road, sheltered: sh.sheltered, shelter: sh.reason, share: sh.share, pts: [s.a.p, s.b.p], length: s.e.d, ways: new Set([att.way]) });
    }
    const total = segs.reduce((s, x) => s + x.length, 0);
    const sumBy = (k) => { const o = {}; for (const sg of segs) o[sg[k]] = r1((o[sg[k]] || 0) + sg.length); return o; };
    const lenWhere = (pred) => Math.round(segs.reduce((acc, sg) => { let tt = 0; for (let i = 1; i < sg.pts.length; i++) { const m = [(sg.pts[i][0] + sg.pts[i - 1][0]) / 2, (sg.pts[i][1] + sg.pts[i - 1][1]) / 2]; if (pred(m)) tt += Math.hypot(sg.pts[i][0] - sg.pts[i - 1][0], sg.pts[i][1] - sg.pts[i - 1][1]); } return acc + tt; }, 0));
    const shelteredM = segs.filter((x) => x.sheltered).reduce((a, x) => a + x.length, 0);
    return {
      id: rid, from, to, fromLabel: A.label, toLabel: B.label,
      snapFrom: r1(sa.d), snapTo: r1(sb.d),
      length: Math.round(total), minutes: r1(total / WALK_SPEED),
      byClass: sumBy('cls'), byShare: sumBy('share'),
      shelteredM: Math.round(shelteredM), shelteredPct: total ? Math.round((shelteredM / total) * 100) : 0,
      overWaterM: lenWhere((m) => waterAreas.some((w) => inside(m, w.ring))),
      ...Object.fromEntries(within.map((w) => [w.key, w.ring ? lenWhere((m) => inside(m, w.ring)) : 0])),
      straightLine: Math.round(Math.hypot(A.pt[0] - B.pt[0], A.pt[1] - B.pt[1])),
      segments: segs.map((s) => ({ cls: s.cls, layer: s.layer, road: s.road, sheltered: s.sheltered, shelter: s.shelter, share: s.share, length: r1(s.length), osmWays: [...s.ways], pts: rnd(s.pts) })),
    };
  }
  const routes = (rules.routes ?? []).map(([rid, a, b]) => computeRoute(rid, a, b));
  const walks = (rules.walks ?? []).map(([rid, a, b]) => computeRoute(rid, a, b));

  // ---------- KTM Komuter line per track (rules.ktmRoutes: route relations looked up once, see rules.ktmRouteNotes) ----------
  if (rules.ktmRoutes) {
    const KR = JSON.parse(readFileSync(at(dir(rules.ktmRoutes)), 'utf8')).ways;
    const ktm = rails.filter((r) => r.line === 'ktm');
    for (const r of ktm) { const refs = KR[r.id]?.refs ?? []; r.route = refs.length === 1 ? Number(refs[0]) : null; }
    const segD = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy; const u = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0; return Math.hypot(p[0] - a[0] - u * dx, p[1] - a[1] - u * dy); };
    const polyD = (p, pts) => { let m = Infinity; for (let i = 1; i < pts.length; i++) m = Math.min(m, segD(p, pts[i - 1], pts[i])); return m; };
    const known = ktm.filter((r) => r.route);
    for (const r of ktm.filter((r) => !r.route)) {
      let best = null, bd = Infinity;
      for (const k of known) { const d = Math.min(polyD(r.pts[0], k.pts), polyD(r.pts[r.pts.length - 1], k.pts)); if (d < bd) { bd = d; best = k; } }
      r.route = best ? best.route : null; r.routeInferred = true;
    }
  }
  for (const r of rails) if (r.line !== 'ktm' || !rules.ktmRoutes) r.route = null;

  // ---------- summary stats (all derived from the pulled OSM data) ----------
  const count = (f) => buildings.filter(f).length;
  const railLen = (line) => Math.round(rails.filter((r) => r.line === line && !r.service).reduce((s, r) => s + len(r.pts), 0));
  const ktmRouteLen = (n) => Math.round(rails.filter((r) => r.line === 'ktm' && r.route === n && !r.service).reduce((s, r) => s + len(r.pts), 0));
  const meta = {
    zones: zoneStats,
    source: 'OpenStreetMap via Overpass API', attribution: '© OpenStreetMap contributors (ODbL)',
    fetchedAt: raw.fetched_at || null, center: CENTER, halfSizeM: H, bbox: BBOX,
    levelHeightM: LEVEL_H, walkSpeedMPerMin: WALK_SPEED,
    counts: {
      rawElements: els.length, outlines: outlines.length, parts: parts.length, outlinesReplacedByParts: skippedOutlines,
      buildings: buildings.length, heightOsm: count((b) => b.heightSource === 'osm'), heightLevels: count((b) => b.heightSource === 'levels'), heightEstimate: count((b) => b.heightSource === 'estimate'), heightCited: count((b) => b.heightSource === 'cited'),
      heightInherited: count((b) => /inherited/.test(b.heightNote || '')), roads: roads.length, footways: new Set(footways.map((f) => f.id)).size,
      footbridges: new Set(footways.filter((f) => f.bridge).map((f) => f.id)).size, indoorCorridors: new Set(footways.filter((f) => f.indoor || f.kind === 'corridor').map((f) => f.id)).size,
      stations: stations.length,
    },
    railLengthsM: Object.fromEntries((rules.railLengths ?? [...new Set(rails.map((r) => r.line))].filter((l) => l !== 'other').sort()).map((l) => [l, railLen(l)])),
    ...(rules.ktmRoutes ? { ktmRouteM: { 1: ktmRouteLen(1), 2: ktmRouteLen(2) } } : {}),
    footwayLengthM: Math.round(footways.reduce((s, f) => s + len(f.pts), 0)),
    footbridgeLengthM: Math.round(footways.filter((f) => f.bridge).reduce((s, f) => s + len(f.pts), 0)),
    shelteredFootwayM: Math.round(footways.filter((f) => f.sheltered).reduce((s, f) => s + len(f.pts), 0)),
    exposedFootwayM: Math.round(footways.filter((f) => !f.sheltered).reduce((s, f) => s + len(f.pts), 0)),
    heightSourcesFetched: HS.fetched,
  };
  mkdirSync(at(dir('data')), { recursive: true });
  const w = (f, d) => writeFileSync(at(dir(`data/${f}`)), JSON.stringify(d));
  w('meta.json', meta);
  w('buildings.json', buildings);
  w('landmarks.json', landmarks);
  w('lines.json', { roads, rails, footways: footways.map((f) => ({ ...f, pts: rnd(f.pts) })), waterLines });
  w('areas.json', { waterAreas, green, precincts });
  w('stations.json', stations);
  w('named-outlines.json', outlineIndex);
  w('routes.json', { anchors, routes, walks });
  w('facilities.json', facilities);
  console.log(`[${id}]`, JSON.stringify(meta, null, 1));
  for (const r of [...routes, ...walks]) console.log(`[${id}]`, r.id, r.from, '->', r.to, r.error || `${r.length} m, ${r.minutes} min, snap ${r.snapFrom}/${r.snapTo}, sheltered ${r.shelteredPct}%`, JSON.stringify(r.byShare || {}));
  for (const c of citedLog) console.log(`[${id}] cited`, c.name, c.height, 'm ->', c.applied.length ? c.applied.map((a) => a.id + ' was ' + a.from).join('; ') : 'NOT MATCHED');
  console.log(`[${id}] facilities: ${Object.entries(facilities).map(([k, v]) => `${v.length} ${k}`).join(', ')}`);
  return { stations, rails };
}

// ---------- spot index + typed loaders (generated; one lazily loaded chunk per area) ----------
const FILES = [['meta', 'meta'], ['buildings', 'buildings'], ['lines', 'lines'], ['areas', 'areas'], ['stations', 'stations'], ['routes', 'routes'], ['namedOutlines', 'named-outlines'], ['landmarks', 'landmarks'], ['facilities', 'facilities']];
function writeIndex() {
  const ids = areaIds().filter((id) => existsSync(at(`areas/${id}/data/meta.json`)));
  const index = ids.map((id) => {
    const cfg = areaConfig(id);
    const stations = JSON.parse(readFileSync(at(`areas/${id}/data/stations.json`), 'utf8'));
    const lines = [...new Set(JSON.parse(readFileSync(at(`areas/${id}/data/lines.json`), 'utf8')).rails.map((r) => r.line))].filter((l) => l !== 'other').sort();
    return { id, name: cfg.name, kind: cfg.kind, summary: cfg.summary ?? null, center: cfg.center, halfSizeM: cfg.halfSizeM, bbox: cfg.bbox, stations: stations.map((s) => s.ref).filter(Boolean).sort(), lines };
  });
  writeFileSync(at('areas/index.json'), `${JSON.stringify(index, null, 1)}\n`);
  mkdirSync(at('src/areas'), { recursive: true });
  const head = '// Generated by pipeline/process-osm.mjs from areas/: do not edit (npm run data:process).\n';
  for (const id of ids) {
    const v = (f) => f.replace(/-/g, '_');
    writeFileSync(at(`src/areas/${id}.gen.ts`), head
      + FILES.map(([, f]) => `import ${v(f)} from '../../areas/${id}/data/${f}.json';\n`).join('')
      + `import rules from '../../areas/${id}/rules.json';\n`
      + (existsSync(at(`areas/${id}/sources/facts.json`)) ? `import facts from '../../areas/${id}/sources/facts.json';\n` : `const facts = { fetched: null, facts: {} };\n`)
      + `import type { RawArea } from '../data';\n\n`
      + `export default { ${FILES.map(([k, f]) => (k === v(f) ? k : `${k}: ${v(f)}`)).join(', ')}, rules, facts: facts.facts, factsFetched: facts.fetched } as unknown as RawArea;\n`);
  }
  writeFileSync(at('src/areas.gen.ts'), head
    + `import type { RawArea } from './data';\n\n`
    + `/** One loader per area; each area's data is its own chunk, fetched only when a site loads that area. */\n`
    + `export const AREA_LOADERS: Record<string, () => Promise<RawArea>> = {\n`
    + ids.map((id) => `  '${id}': () => import('./areas/${id}.gen').then((m) => m.default),\n`).join('')
    + `};\n`);
}

const only = process.argv[2];
for (const id of only ? [only] : areaIds()) processArea(id);
writeIndex();
