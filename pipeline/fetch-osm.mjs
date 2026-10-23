// Re-pull raw OpenStreetMap data for one study area from the Overpass API into areas/<id>/raw/.
// Usage: npm run data:fetch -- <area id>   (then: npm run data:process -- <area id>)
// The query is the same for every area; it rewrites raw/, so the area's data changes on the next data:process.
import { writeFileSync, mkdirSync } from 'node:fs';
import { at, areaConfig, USER_AGENT } from './config.mjs';

const id = process.argv[2];
if (!id) { console.error('Usage: npm run data:fetch -- <area id>   (a fetch rewrites that area\'s raw/; there is no "all")'); process.exit(1); }
const { bbox: BBOX } = areaConfig(id);
const dir = (p) => `areas/${id}/${p}`;

const ENDPOINT = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
const b = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;
const query = `[out:json][timeout:120];
(
  way["building"](${b});
  relation["building"](${b});
  way["building:part"](${b});
  way["railway"~"^(light_rail|rail|subway|monorail|platform)$"](${b});
  node["railway"~"^(station|halt|stop|subway_entrance|train_station_entrance)$"](${b});
  way["railway"="station"](${b});
  node["public_transport"="station"](${b});
  way["public_transport"="station"](${b});
  way["waterway"~"^(river|canal|stream)$"](${b});
  way["natural"="water"](${b});
  relation["natural"="water"](${b});
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|residential|unclassified|service)$"](${b});
  way["highway"~"^(footway|pedestrian|steps|path|corridor)$"](${b});
  way["man_made"="bridge"](${b});
  way["leisure"~"^(park|garden|pitch|track)$"](${b});
  relation["leisure"~"^(pitch|track)$"](${b});
  way["landuse"~"^(grass|recreation_ground)$"](${b});
  way["landuse"]["name"](${b});
  relation["landuse"]["name"](${b});
  way["amenity"="parking"]["building"!~"."](${b});
  nwr["amenity"="parking"](${b});
  node["amenity"="parking_entrance"](${b});
  nwr["tourism"~"^(hotel|apartment|hostel|guest_house|motel)$"](${b});
  node["highway"="bus_stop"](${b});
  node["public_transport"="platform"]["bus"="yes"](${b});
);
out body geom;`;

mkdirSync(at(dir('raw')), { recursive: true });
writeFileSync(at(dir('raw/overpass-query.overpassql')), query);
const ENDPOINTS = [ENDPOINT, 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
let res;
for (let attempt = 0; attempt < 6; attempt++) {
  const url = ENDPOINTS[attempt % ENDPOINTS.length];
  console.log(`[${id}] Querying ${url} bbox ${b} (attempt ${attempt + 1})`);
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query),
      signal: AbortSignal.timeout(180000),
    });
    if (res.ok && (res.headers.get('content-type') || '').includes('json')) break;
    console.warn('  HTTP', res.status, res.headers.get('content-type'));
    res = null;
  } catch (err) { console.warn('  failed', err.message); }
  await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
}
if (!res || !res.ok) { console.error('Overpass failed after retries'); process.exit(1); }
const json = await res.json();
json.fetched_at = new Date().toISOString();
json.bbox = BBOX;
writeFileSync(at(dir('raw/overpass.json')), JSON.stringify(json));
console.log(`[${id}] Saved ${dir('raw/overpass.json')} with`, json.elements.length, 'elements');
