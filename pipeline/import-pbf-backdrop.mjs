// The coarse backdrop around a region (regions/<id>/raw/backdrop.json.gz), from an OpenStreetMap extract file (.osm.pbf),
// for rules.json "backdrop": { "marginKm", ... }: the region's box widened by marginKm on every side; the coastline,
// big forest and green areas, built-up areas, lakes and reservoirs, motorways and trunk roads. A preselection keeps the
// raw file small: areas under 0.1 km² are left out and every line is simplified to 20 m (region:process thins further).
// Needs osmium-tool. Usage: node pipeline/import-pbf-backdrop.mjs <region id> <extract.osm.pbf> [<source url>]
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, createReadStream } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { at } from './config.mjs';

const [id, pbf, url = null] = process.argv.slice(2);
if (!id || !pbf) { console.error('usage: node pipeline/import-pbf-backdrop.mjs <region id> <extract.osm.pbf> [<source url>]'); process.exit(1); }
const B0 = JSON.parse(readFileSync(at(`regions/${id}/region.json`), 'utf8')).bbox;
const cfg = JSON.parse(readFileSync(at(`regions/${id}/rules.json`), 'utf8')).backdrop;
if (!cfg) { console.error(`regions/${id}/rules.json has no "backdrop"`); process.exit(1); }
const dLat = cfg.marginKm / 111.32, dLon = cfg.marginKm / (111.32 * Math.cos(((B0.south + B0.north) / 2) * Math.PI / 180));
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const B = { south: r4(B0.south - dLat), west: r4(B0.west - dLon), north: r4(B0.north + dLat), east: r4(B0.east + dLon) };
const FILTERS = [
  'w/natural=coastline',
  'w/highway=motorway,trunk',
  'wr/natural=water,wood,wetland',
  'wr/landuse=forest,reservoir,residential,commercial,industrial,retail',
  'wr/leisure=nature_reserve',
];
const PRE_TOL = 20, PRE_MIN_AREA = 1e5; // m, m²
const osmium = (...a) => execFileSync('osmium', a, { stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 26 }).toString();
const tmp = mkdtempSync(join(tmpdir(), 'map-assets-pbf-'));
const t0 = Date.now(); const step = (s) => console.log(`[${id}] ${s} (${Math.round((Date.now() - t0) / 1000)} s)`);
// local metres around the box middle, for the preselection only
const lat0 = (B.south + B.north) / 2, kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110574;
const xy = ([lon, lat]) => [lon * kx, lat * ky];
function simplify(pts, tol) { // Douglas-Peucker on [lon, lat] with the tolerance in metres
  if (pts.length < 3) return pts; const P = pts.map(xy); const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) { const [a, b] = st.pop(); let m = -1, md = tol; const [ax, ay] = P[a], [bx, by] = P[b]; const L = Math.hypot(bx - ax, by - ay) || 1e-9;
    for (let i = a + 1; i < b; i++) { const d = L > 1e-6 ? Math.abs((bx - ax) * (ay - P[i][1]) - (ax - P[i][0]) * (by - ay)) / L : Math.hypot(P[i][0] - ax, P[i][1] - ay); if (d > md) { md = d; m = i; } }
    if (m > 0) { keep[m] = 1; st.push([a, m], [m, b]); } }
  return pts.filter((_, i) => keep[i]);
}
const area = (ring) => { let s = 0; const P = ring.map(xy); for (let i = 0, n = P.length; i < n; i++) { const [x1, y1] = P[i], [x2, y2] = P[(i + 1) % n]; s += x1 * y2 - x2 * y1; } return Math.abs(s / 2); };
const g = (c) => c.map(([lon, lat]) => ({ lat: +lat.toFixed(5), lon: +lon.toFixed(5) }));
try {
  const base = osmium('fileinfo', '-g', 'header.option.osmosis_replication_timestamp', pbf).trim() || null;
  step(`extract ${basename(pbf)} (OSM data as of ${base ?? '?'}) to ${B.south},${B.west} – ${B.north},${B.east}`);
  osmium('extract', '-b', `${B.west},${B.south},${B.east},${B.north}`, '--strategy', 'smart', '-o', join(tmp, 'box.osm.pbf'), '--overwrite', pbf);
  osmium('tags-filter', join(tmp, 'box.osm.pbf'), ...FILTERS, '-o', join(tmp, 'sel.osm.pbf'), '--overwrite');
  step('export geometries');
  osmium('export', join(tmp, 'sel.osm.pbf'), '-f', 'geojsonseq', '-x', 'print_record_separator=false', '--add-unique-id=type_id', '-o', join(tmp, 'sel.geojsonseq'), '--overwrite');
  const elements = []; let dropped = 0;
  for await (const line of createInterface({ input: createReadStream(join(tmp, 'sel.geojsonseq')) })) {
    if (!line.trim()) continue;
    const f = JSON.parse(line); const type = { n: 'node', w: 'way', r: 'relation', a: 'way' }[f.id[0]]; const oid = +f.id.slice(1); const t = f.properties || {};
    const geo = f.geometry;
    if (geo.type === 'LineString') { // coastline and roads (members of kept relations come along too: left out)
      if (t.natural !== 'coastline' && !(t.highway === 'motorway' || t.highway === 'trunk')) continue;
      const keep = t.natural === 'coastline' ? { natural: 'coastline' } : { highway: t.highway, ...(t.ref ? { ref: t.ref } : {}) };
      elements.push({ type: 'way', id: oid, tags: keep, geometry: g(simplify(geo.coordinates, PRE_TOL)) });
    } else if (geo.type === 'Polygon' || geo.type === 'MultiPolygon') {
      if (type === 'node') continue;
      const tags = Object.fromEntries(['natural', 'landuse', 'leisure', 'name'].filter((k) => t[k]).map((k) => [k, t[k]]));
      const polys = (geo.type === 'Polygon' ? [geo.coordinates] : geo.coordinates).map((rings) => rings.map((r) => simplify(r, PRE_TOL)).filter((r) => r.length >= 4))
        .filter((rings) => rings.length && area(rings[0]) >= PRE_MIN_AREA).map((rings) => [rings[0], ...rings.slice(1).filter((r) => area(r) >= PRE_MIN_AREA)]);
      if (!polys.length) { dropped++; continue; }
      elements.push({ type: 'relation', id: oid, osmType: type, tags, members: polys.flatMap((rings) => rings.map((r, i) => ({ type: 'way', role: i ? 'inner' : 'outer', geometry: g(r) }))) });
    }
  }
  const json = {
    version: 0.6, generator: `map-assets import-pbf-backdrop (osmium ${osmium('--version').split('\n')[0].split(' ').pop()})`,
    osm3s: { timestamp_osm_base: base, copyright: 'The data included in this document is from www.openstreetmap.org. The data is made available under ODbL.' },
    source: { file: basename(pbf), url, replicationTimestamp: base, filters: FILTERS, strategy: 'osmium extract --strategy smart', preselection: `areas under ${PRE_MIN_AREA / 1e6} km² left out, lines simplified to ${PRE_TOL} m, coordinates to 5 decimals` },
    elements, fetched_at: new Date().toISOString(), bbox: B,
  };
  mkdirSync(at(`regions/${id}/raw`), { recursive: true });
  const gz = gzipSync(JSON.stringify(json), { level: 9 });
  writeFileSync(at(`regions/${id}/raw/backdrop.json.gz`), gz);
  writeFileSync(at(`regions/${id}/raw/backdrop-import.txt`), [
    `Imported with pipeline/import-pbf-backdrop.mjs from ${basename(pbf)}${url ? ` (${url})` : ''}, OSM data as of ${base ?? 'unknown'}.`,
    `Box: the region box widened by ${cfg.marginKm} km: ${B.south},${B.west} – ${B.north},${B.east}`,
    `osmium extract -b ${B.west},${B.south},${B.east},${B.north} --strategy smart`,
    `osmium tags-filter ${FILTERS.join(' ')}`,
    `Preselection: areas under ${PRE_MIN_AREA / 1e6} km² left out, lines simplified to ${PRE_TOL} m, coordinates rounded to 5 decimals.`, '',
  ].join('\n'));
  step(`saved regions/${id}/raw/backdrop.json.gz (${(gz.length / 1e6).toFixed(1)} MB) with ${elements.length} elements (${dropped} small areas left out)`);
} finally { rmSync(tmp, { recursive: true, force: true }); }
