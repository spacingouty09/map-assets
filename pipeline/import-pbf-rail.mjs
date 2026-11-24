// The rail network of a region (regions/<id>/raw/overpass.json) from an OpenStreetMap extract file (.osm.pbf) instead of
// the Overpass API: the same elements and shape as `region:fetch -- <id>` (route relations of trains, metro, light rail
// and monorail with their member ways and stops, the stations, motorways and trunk roads, rivers, the Kuala Lumpur and
// Putrajaya boundaries), so `region:process` reads it unchanged. Needs osmium-tool (brew install osmium-tool).
// Usage: node pipeline/import-pbf-rail.mjs <region id> <extract.osm.pbf> [<source url>]
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, createReadStream } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { at } from './config.mjs';

const [id, pbf, url = null] = process.argv.slice(2);
if (!id || !pbf) { console.error('usage: node pipeline/import-pbf-rail.mjs <region id> <extract.osm.pbf> [<source url>]'); process.exit(1); }
const B = JSON.parse(readFileSync(at(`regions/${id}/region.json`), 'utf8')).bbox;
const FILTERS = ['r/route=train,subway,light_rail,monorail', 'n/railway=station,halt', 'n/public_transport=station', 'w/highway=motorway,trunk', 'w/waterway=river', 'r/boundary=administrative'];
const osmium = (...a) => execFileSync('osmium', a, { stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 26 }).toString();
const tmp = mkdtempSync(join(tmpdir(), 'map-assets-pbf-'));
try {
  const base = osmium('fileinfo', '-g', 'header.option.osmosis_replication_timestamp', pbf).trim() || null;
  // routes are kept whole (their track beyond the box too, as Overpass returns it); the processor cuts them at the box
  osmium('extract', '-b', `${B.west},${B.south},${B.east},${B.north}`, '--strategy', 'smart', '-S', 'types=multipolygon,route', '-o', join(tmp, 'box.osm.pbf'), '--overwrite', pbf);
  osmium('tags-filter', join(tmp, 'box.osm.pbf'), ...FILTERS, '-o', join(tmp, 'sel.osm.pbf'), '--overwrite');
  osmium('add-locations-to-ways', '-n', join(tmp, 'sel.osm.pbf'), '-o', join(tmp, 'sel.opl'), '-f', 'opl,add_metadata=false', '--overwrite');
  // OPL: one object per line; text is escaped as %<hex code point>%
  const un = (s) => s.replace(/%([0-9a-fA-F]+)%/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
  const tagsOf = (s) => (s ? Object.fromEntries(s.split(',').map((kv) => { const i = kv.indexOf('='); return [un(kv.slice(0, i)), un(kv.slice(i + 1))]; })) : {});
  const nodes = new Map(), ways = new Map(), rels = new Map();
  for await (const line of createInterface({ input: createReadStream(join(tmp, 'sel.opl')) })) {
    if (!line) continue; const f = Object.fromEntries(line.split(' ').slice(1).map((p) => [p[0], p.slice(1)])); const t = line[0], oid = +line.slice(1, line.indexOf(' '));
    if (t === 'n') nodes.set(oid, { type: 'node', id: oid, lat: +f.y, lon: +f.x, tags: tagsOf(f.T) });
    else if (t === 'w') ways.set(oid, { type: 'way', id: oid, tags: tagsOf(f.T), geometry: (f.N ? f.N.split(',') : []).map((n) => { const m = /x(-?[\d.]+)y(-?[\d.]+)/.exec(n); return m && { lat: +m[2], lon: +m[1] }; }).filter(Boolean) });
    else if (t === 'r') rels.set(oid, { type: 'relation', id: oid, tags: tagsOf(f.T), members: (f.M ? f.M.split(',') : []).map((m) => { const i = m.indexOf('@'); return { type: { n: 'node', w: 'way', r: 'relation' }[m[0]], ref: +m.slice(1, i), role: un(m.slice(i + 1)) }; }) });
  }
  const isRoute = (r) => r.tags.type === 'route' && /^(train|subway|light_rail|monorail)$/.test(r.tags.route);
  const isBoundary = (r) => r.tags.boundary === 'administrative' && r.tags.admin_level === '4' && /Kuala Lumpur|Putrajaya/.test(r.tags.name || '');
  const keptRels = [...rels.values()].filter((r) => isRoute(r) || isBoundary(r));
  const used = { node: new Set(), way: new Set() };
  for (const r of keptRels) for (const m of r.members) if (used[m.type]) used[m.type].add(m.ref);
  for (const r of keptRels.filter(isBoundary)) for (const m of r.members) if (m.type === 'way' && ways.has(m.ref)) m.geometry = ways.get(m.ref).geometry;
  const inside = (n) => n.lat >= B.south && n.lat <= B.north && n.lon >= B.west && n.lon <= B.east;
  const elements = [
    ...keptRels,
    ...[...ways.values()].filter((w) => used.way.has(w.id) || ((w.tags.highway === 'motorway' || w.tags.highway === 'trunk' || w.tags.waterway === 'river') && w.geometry.length > 1)),
    ...[...nodes.values()].filter((n) => used.node.has(n.id) || (inside(n) && (/^(station|halt)$/.test(n.tags.railway || '') || (n.tags.public_transport === 'station' && n.tags.railway)))),
  ];
  const json = {
    version: 0.6, generator: 'map-assets import-pbf-rail (osmium)',
    osm3s: { timestamp_osm_base: base, copyright: 'The data included in this document is from www.openstreetmap.org. The data is made available under ODbL.' },
    source: { file: basename(pbf), url, replicationTimestamp: base, filters: FILTERS, strategy: 'osmium extract --strategy smart -S types=multipolygon,route' },
    elements, fetched_at: new Date().toISOString(), bbox: B,
  };
  mkdirSync(at(`regions/${id}/raw`), { recursive: true });
  writeFileSync(at(`regions/${id}/raw/overpass.json`), JSON.stringify(json));
  console.log(`[${id}] saved regions/${id}/raw/overpass.json: ${keptRels.filter(isRoute).length} routes, ${elements.length} elements (OSM data as of ${base})`);
} finally { rmSync(tmp, { recursive: true, force: true }); }
