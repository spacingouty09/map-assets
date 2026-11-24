// The rail beyond a region's backdrop that rules.json "backdrop.exits" route over (regions/<id>/raw/exits.json.gz), from
// an OpenStreetMap extract file (.osm.pbf): main-line track (railway=rail with no service=*) and the stations and halts
// in each exit's "trackBox", so region:process can follow the line to the terminus where OSM has no route relation for
// the service (e.g. the ETS south of Gemas). Needs osmium-tool.
// Usage: node pipeline/import-pbf-exits.mjs <region id> <extract.osm.pbf> [<source url>]
import { readFileSync, writeFileSync, mkdtempSync, rmSync, createReadStream } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { at } from './config.mjs';

const [id, pbf, url = null] = process.argv.slice(2);
if (!id || !pbf) { console.error('usage: node pipeline/import-pbf-exits.mjs <region id> <extract.osm.pbf> [<source url>]'); process.exit(1); }
const exits = (JSON.parse(readFileSync(at(`regions/${id}/rules.json`), 'utf8')).backdrop?.exits ?? []).filter((e) => e.trackBox);
const osmium = (...a) => execFileSync('osmium', a, { stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 26 }).toString();
const tmp = mkdtempSync(join(tmpdir(), 'map-assets-pbf-'));
const un = (s) => s.replace(/%([0-9a-fA-F]+)%/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
const tagsOf = (s) => (s ? Object.fromEntries(s.split(',').map((kv) => { const i = kv.indexOf('='); return [un(kv.slice(0, i)), un(kv.slice(i + 1))]; })) : {});
try {
  const base = osmium('fileinfo', '-g', 'header.option.osmosis_replication_timestamp', pbf).trim() || null;
  const out = { generator: 'map-assets import-pbf-exits', source: { file: basename(pbf), url, replicationTimestamp: base }, fetched_at: new Date().toISOString(), exits: {} };
  for (const e of exits) {
    const B = e.trackBox;
    osmium('extract', '-b', `${B.west},${B.south},${B.east},${B.north}`, '--strategy', 'complete_ways', '-o', join(tmp, 'box.osm.pbf'), '--overwrite', pbf);
    osmium('tags-filter', join(tmp, 'box.osm.pbf'), 'w/railway=rail', 'nw/railway=station,halt', '-o', join(tmp, 'sel.osm.pbf'), '--overwrite');
    osmium('add-locations-to-ways', '-n', join(tmp, 'sel.osm.pbf'), '-o', join(tmp, 'sel.opl'), '-f', 'opl,add_metadata=false', '--overwrite');
    const nodes = []; const ways = [];
    for await (const line of createInterface({ input: createReadStream(join(tmp, 'sel.opl')) })) {
      if (!line) continue; const f = Object.fromEntries(line.split(' ').slice(1).map((p) => [p[0], p.slice(1)])); const t = tagsOf(f.T); const oid = +line.slice(1, line.indexOf(' '));
      const keepTags = () => Object.fromEntries(['name', 'name:en', 'railway', 'station', 'usage', 'operator', 'disused', 'construction'].filter((k) => t[k]).map((k) => [k, t[k]]));
      if (line[0] === 'n' && (t.railway === 'station' || t.railway === 'halt') && t.name) nodes.push({ id: oid, lat: +(+f.y).toFixed(6), lon: +(+f.x).toFixed(6), tags: keepTags() });
      if (line[0] === 'w' && (t.railway === 'station' || t.railway === 'halt') && t.name && f.N) { // mapped as an area: its middle
        const ps = f.N.split(',').map((q) => q.match(/x([-\d.]+)y([-\d.]+)/)).filter(Boolean).map((m) => [+m[1], +m[2]]);
        if (ps.length) nodes.push({ id: -oid, lat: +(ps.reduce((a, p) => a + p[1], 0) / ps.length).toFixed(6), lon: +(ps.reduce((a, p) => a + p[0], 0) / ps.length).toFixed(6), tags: keepTags() });
      }
      if (line[0] === 'w' && t.railway === 'rail' && !t.service && f.N && f.N.includes('x')) ways.push({ id: oid, tags: Object.fromEntries(['usage', 'name', 'electrified'].filter((k) => t[k]).map((k) => [k, t[k]])), nodes: f.N.split(',').map((s) => { const m = s.match(/^n(\d+)x([-\d.]+)y([-\d.]+)$/); return [+m[1], +(+m[2]).toFixed(6), +(+m[3]).toFixed(6)]; }) });
    }
    out.exits[e.id] = { trackBox: B, stations: nodes, ways };
    console.log(`[${id}] exit ${e.id}: ${ways.length} track ways, ${nodes.length} stations and halts`);
  }
  writeFileSync(at(`regions/${id}/raw/exits.json.gz`), gzipSync(JSON.stringify(out), { level: 9 }));
} finally { rmSync(tmp, { recursive: true, force: true }); }
