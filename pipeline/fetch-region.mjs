// Re-pull the raw OpenStreetMap data of a region (regions/<id>/region.json: bbox) from the Overpass API into
// regions/<id>/raw/: the rail route relations (KTM Komuter, LRT, MRT, monorail, ERL) with their ways and stops, the
// stations, and a light base map (motorways and trunk roads, rivers, the Federal Territory boundaries).
// With `basemap`: the flat street map of the region's own box into regions/<id>/raw/basemap.json.gz (gzipped, it is
// tens of MB): roads from residential up, water and green areas, and named places (suburbs, quarters, neighbourhoods).
// Usage: npm run region:fetch [-- <region id> [basemap]]   (default klang-valley; then: npm run region:process)
import { writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { at, USER_AGENT } from './config.mjs';

const id = process.argv[2] || 'klang-valley';
const kind = process.argv[3] === 'basemap' ? 'basemap' : 'rail';
const cfg = JSON.parse(readFileSync(at(`regions/${id}/region.json`), 'utf8'));
const B = cfg.bbox; const b = `${B.south},${B.west},${B.north},${B.east}`;
const AREA = (k, v) => `way["${k}"~"^(${v})$"](${b});relation["${k}"~"^(${v})$"](${b});`;
const ROADS = (v, box) => `[out:json][timeout:300];
way["highway"~"^(${v})$"](${box});
out geom qt;`;
// the street map comes in tiles: one request for all of it is too heavy for the public Overpass servers (504s, or a
// slow mirror cut off mid-stream); a way crossing tiles comes back in each, and the processor keeps it once
const tiles = (nx, ny) => Array.from({ length: nx * ny }, (_, i) => {
  const [x, y] = [i % nx, Math.floor(i / nx)]; const f = (v) => +v.toFixed(5);
  const s = f(B.south + ((B.north - B.south) * y) / ny), n = f(B.south + ((B.north - B.south) * (y + 1)) / ny);
  const w = f(B.west + ((B.east - B.west) * x) / nx), e = f(B.west + ((B.east - B.west) * (x + 1)) / nx);
  return { label: `${y * nx + x + 1}/${nx * ny}`, box: `${s},${w},${n},${e}` };
});
const parts = kind === 'basemap' ? [
  ...tiles(2, 2).map((t) => ({ name: `main roads ${t.label}`, q: ROADS('motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link', t.box) })),
  ...tiles(3, 3).map((t) => ({ name: `streets ${t.label}`, q: ROADS('residential|unclassified|living_street', t.box) })),
  { name: 'water and green areas', q: `[out:json][timeout:300];
(
  ${AREA('natural', 'water|wetland|wood|scrub|grassland')}
  ${AREA('landuse', 'reservoir|basin|forest|grass|meadow|recreation_ground|cemetery|village_green')}
  ${AREA('waterway', 'riverbank')}
  ${AREA('leisure', 'park|garden|golf_course|nature_reserve|recreation_ground')}
);
out geom qt;` },
  { name: 'place names', q: `[out:json][timeout:120];
node["place"~"^(town|suburb|quarter|neighbourhood)$"](${b});
out qt;` },
] : [{ name: 'rail network and base map', q: `[out:json][timeout:300];
relation["type"="route"]["route"~"^(train|subway|light_rail|monorail)$"](${b})->.r;
.r out body;
way(r.r)->.w;
.w out geom;
node(r.r)->.n;
.n out body;
(
  node["railway"~"^(station|halt)$"](${b});
  node["public_transport"="station"]["railway"](${b});
);
out body;
way["highway"~"^(motorway|trunk)$"](${b});
out geom;
way["waterway"="river"](${b});
out geom;
relation["boundary"="administrative"]["admin_level"="4"]["name"~"Kuala Lumpur|Putrajaya"](${b});
out geom;` }];
// the query on record: the rail pull as sent; the street map's parts one after another
const query = kind === 'basemap' ? parts.map((p) => `/* ${p.name} */\n${p.q}`).join('\n\n') : parts[0].q;

const dir = (p) => `regions/${id}/${p}`;
mkdirSync(at(dir('raw')), { recursive: true });
const rawName = kind === 'basemap' ? 'basemap' : 'overpass';
writeFileSync(at(dir(`raw/${rawName}-query.overpassql`)), query);
const ENDPOINTS = [process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter', 'https://overpass.openstreetmap.fr/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const MAX_LAG_DAYS = 7; // a mirror whose OSM base is older than a week is skipped like a failed one
// on a terminal: one status line, redrawn in place: the part (as a %), then bytes and time (Overpass sends no size)
const t0 = Date.now(); const tty = process.stdout.isTTY;
let part = 0; let attemptNo = 0;
const head = () => `[${id}] ${Math.round((part / parts.length) * 100)}% · part ${part + 1}/${parts.length} ${parts[part]?.name ?? ''} · attempt ${attemptNo + 1}/6`;
const status = (msg) => { if (tty) process.stdout.write(`\r\x1b[2K${msg.slice(0, (process.stdout.columns || 100) - 1)}`); };
// a request is given up when the server says nothing for a while, not after a fixed total: a slow mirror can take
// many minutes to stream a tile, and that is fine as long as data keeps coming
const WAIT_MS = 400000; const IDLE_MS = 90000;
async function readWithProgress(res, alive) {
  const chunks = []; let n = 0; const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    alive(); chunks.push(value); n += value.length;
    status(`${head()} · receiving ${(n / 1e6).toFixed(1)} MB · ${Math.round((Date.now() - t0) / 1000)} s`);
  }
  if (tty) process.stdout.write('\n');
  return Buffer.concat(chunks).toString('utf8');
}
const waiting = tty ? setInterval(() => status(`${head()} · waiting for the server · ${Math.round((Date.now() - t0) / 1000)} s`), 1000) : null;
const log = (...a) => { if (tty) process.stdout.write("\r\x1b[2K"); console.log(...a); };
async function pull(q) {
  for (attemptNo = 0; attemptNo < 6; attemptNo++) {
    const url = ENDPOINTS[attemptNo % ENDPOINTS.length];
    log(`[${id}] ${parts[part].name}: querying ${url} (attempt ${attemptNo + 1})`);
    const ctl = new AbortController(); let timer;
    const arm = (ms) => { clearTimeout(timer); timer = setTimeout(() => ctl.abort(new Error(`no data for ${ms / 1000} s`)), ms); };
    try {
      arm(WAIT_MS);
      const res = await fetch(url, { method: 'POST', headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q), signal: ctl.signal });
      if (res.ok && (res.headers.get('content-type') || '').includes('json')) {
        const body = JSON.parse(await readWithProgress(res, () => arm(IDLE_MS))); clearTimeout(timer); const base = body.osm3s?.timestamp_osm_base;
        const lagDays = base ? (Date.now() - Date.parse(base)) / 86400000 : 0;
        if (lagDays <= MAX_LAG_DAYS && !body.remark) { log(`  ${body.elements.length} elements, OSM data as of ${base ?? '?'}`); return body; }
        log(body.remark ? `  remark: ${body.remark}` : `  stale: OSM data as of ${base} (${Math.round(lagDays)} days old)`);
      } else log('  HTTP', res.status, res.headers.get('content-type'));
    } catch (err) { log('  failed', err.message); }
    clearTimeout(timer);
    await new Promise((r) => setTimeout(r, 5000 * (attemptNo + 1)));
  }
  return null;
}
// each finished part is kept in the system temp folder until the whole pull is saved, so a run that fails on a later
// part picks up where it stopped (keyed by the part's query: a changed query is fetched again)
const cacheDir = join(tmpdir(), 'map-assets-fetch'); mkdirSync(cacheDir, { recursive: true });
const cacheOf = (q) => join(cacheDir, `${id}-${createHash('sha1').update(q).digest('hex').slice(0, 16)}.json`);
let json = null;
for (part = 0; part < parts.length; part++) {
  const file = cacheOf(parts[part].q);
  const body = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : await pull(parts[part].q);
  if (!body) { json = null; break; }
  if (!existsSync(file)) writeFileSync(file, JSON.stringify(body)); else log(`[${id}] ${parts[part].name}: from the last run`);
  if (!json) json = body; else json.elements.push(...body.elements); // a way in two parts is kept once by the processor
}
if (waiting) clearInterval(waiting);
if (!json) { console.error(`\nOverpass failed after retries (${parts[Math.min(part, parts.length - 1)].name})`); process.exit(1); }
status(`[${id}] 100% · ${parts.length} parts · ${Math.round((Date.now() - t0) / 1000)} s`); if (tty) process.stdout.write('\n');
json.fetched_at = new Date().toISOString();
json.bbox = B;
if (kind === 'basemap') {
  const gz = gzipSync(JSON.stringify(json), { level: 9 });
  writeFileSync(at(dir('raw/basemap.json.gz')), gz);
  console.log(`[${id}] Saved ${dir('raw/basemap.json.gz')} (${(gz.length / 1e6).toFixed(1)} MB) with`, json.elements.length, 'elements');
} else {
  writeFileSync(at(dir('raw/overpass.json')), JSON.stringify(json));
  console.log(`[${id}] Saved ${dir('raw/overpass.json')} with`, json.elements.length, 'elements');
}
for (const p of parts) rmSync(cacheOf(p.q), { force: true });
