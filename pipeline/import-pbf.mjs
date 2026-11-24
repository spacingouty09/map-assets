// The street map of a region (regions/<id>/raw/basemap.json.gz) from an OpenStreetMap extract file (.osm.pbf, e.g. a
// Geofabrik country extract) instead of the Overpass API: the same elements and the same shape as `region:fetch -- <id>
// basemap` (roads from residential up, water and green areas, named places), so `region:process` reads it unchanged.
// For a box too big for the public Overpass servers, or when they are down. Needs osmium-tool (brew install osmium-tool).
// Usage: node pipeline/import-pbf.mjs <region id> <extract.osm.pbf> [<source url>]
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, createReadStream } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { at } from './config.mjs';

const [id, pbf, url = null] = process.argv.slice(2);
if (!id || !pbf) { console.error('usage: node pipeline/import-pbf.mjs <region id> <extract.osm.pbf> [<source url>]'); process.exit(1); }
const cfg = JSON.parse(readFileSync(at(`regions/${id}/region.json`), 'utf8')); const B = cfg.bbox;
// the same selection as the Overpass street-map query (pipeline/fetch-region.mjs)
const FILTERS = [
  'w/highway=motorway,motorway_link,trunk,trunk_link,primary,primary_link,secondary,secondary_link,tertiary,tertiary_link,residential,unclassified,living_street',
  'wr/natural=water,wetland,wood,scrub,grassland',
  'wr/landuse=reservoir,basin,forest,grass,meadow,recreation_ground,cemetery,village_green',
  'wr/waterway=riverbank',
  'wr/leisure=park,garden,golf_course,nature_reserve,recreation_ground',
  'n/place=town,suburb,quarter,neighbourhood',
];
const osmium = (...a) => execFileSync('osmium', a, { stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 26 }).toString();
const tmp = mkdtempSync(join(tmpdir(), 'map-assets-pbf-'));
const t0 = Date.now(); const step = (s) => console.log(`[${id}] ${s} (${Math.round((Date.now() - t0) / 1000)} s)`);
try {
  const base = osmium('fileinfo', '-g', 'header.option.osmosis_replication_timestamp', pbf).trim() || null;
  step(`extract ${basename(pbf)} (OSM data as of ${base ?? '?'}) to the box`);
  // smart: ways crossing the box are kept whole, multipolygon relations complete, like Overpass's out geom
  osmium('extract', '-b', `${B.west},${B.south},${B.east},${B.north}`, '--strategy', 'smart', '-o', join(tmp, 'box.osm.pbf'), '--overwrite', pbf);
  step('keep the street-map elements');
  osmium('tags-filter', join(tmp, 'box.osm.pbf'), ...FILTERS, '-o', join(tmp, 'sel.osm.pbf'), '--overwrite');
  step('export geometries');
  osmium('export', join(tmp, 'sel.osm.pbf'), '-f', 'geojsonseq', '-x', 'print_record_separator=false', '--add-unique-id=type_id', '-o', join(tmp, 'sel.geojsonseq'), '--overwrite');
  // back to Overpass elements: nodes with lat / lon, ways and relations with their geometry as lat / lon lists
  const g = (c) => c.map(([lon, lat]) => ({ lat, lon }));
  const elements = [];
  for await (const line of createInterface({ input: createReadStream(join(tmp, 'sel.geojsonseq')) })) {
    if (!line.trim()) continue;
    const f = JSON.parse(line); const type = { n: 'node', w: 'way', r: 'relation', a: 'way' }[f.id[0]]; const oid = +f.id.slice(1); const tags = f.properties || {};
    const geo = f.geometry;
    // tags-filter also brings the nodes of the ways and the members of the relations it keeps: only what the street
    // map query would have returned goes on (places, roads, areas)
    if (geo.type === 'Point') { if (tags.place) elements.push({ type: 'node', id: oid, lat: geo.coordinates[1], lon: geo.coordinates[0], tags }); }
    else if (geo.type === 'LineString') { if (tags.highway) elements.push({ type: 'way', id: oid, tags, geometry: g(geo.coordinates) }); }
    else if (geo.type === 'Polygon' || geo.type === 'MultiPolygon') {
      const polys = geo.type === 'Polygon' ? [geo.coordinates] : geo.coordinates;
      if (type === 'way' && polys.length === 1 && polys[0].length === 1) elements.push({ type: 'way', id: oid, tags, geometry: g(polys[0][0]) });
      else elements.push({ type: 'relation', id: oid, tags, members: polys.flatMap((rings) => rings.map((r, i) => ({ type: 'way', role: i ? 'inner' : 'outer', geometry: g(r) }))) });
    }
  }
  const json = {
    version: 0.6, generator: `map-assets import-pbf (osmium ${osmium('--version').split('\n')[0].split(' ').pop()})`,
    osm3s: { timestamp_osm_base: base, copyright: 'The data included in this document is from www.openstreetmap.org. The data is made available under ODbL.' },
    source: { file: basename(pbf), url, replicationTimestamp: base, filters: FILTERS, strategy: 'osmium extract --strategy smart' },
    elements, fetched_at: new Date().toISOString(), bbox: B,
  };
  mkdirSync(at(`regions/${id}/raw`), { recursive: true });
  const gz = gzipSync(JSON.stringify(json), { level: 9 });
  writeFileSync(at(`regions/${id}/raw/basemap.json.gz`), gz);
  writeFileSync(at(`regions/${id}/raw/basemap-import.txt`), [
    `Imported with pipeline/import-pbf.mjs from ${basename(pbf)}${url ? ` (${url})` : ''}, OSM data as of ${base ?? 'unknown'}.`,
    `osmium extract -b ${B.west},${B.south},${B.east},${B.north} --strategy smart`,
    `osmium tags-filter ${FILTERS.join(' ')}`,
    'osmium export -f geojsonseq --add-unique-id=type_id, then back to Overpass JSON elements (nodes, ways, multipolygon relations with member geometry)',
    '',
  ].join('\n'));
  step(`saved regions/${id}/raw/basemap.json.gz (${(gz.length / 1e6).toFixed(1)} MB) with ${elements.length} elements`);
} finally { rmSync(tmp, { recursive: true, force: true }); }
