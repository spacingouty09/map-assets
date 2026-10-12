// Re-pull raw OpenStreetMap data for the study area from the Overpass API.
// Usage: npm run data:fetch   (then: npm run data:process)
import { writeFileSync, mkdirSync } from 'node:fs';
import { BBOX, USER_AGENT } from './config.mjs';

const at = (p) => new URL(`../${p}`, import.meta.url);

const ENDPOINT = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
const b = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;
const query = `[out:json][timeout:90];
(
  way["building"](${b});
  relation["building"](${b});
  way["building:part"](${b});
  way["railway"~"^(light_rail|rail|subway|monorail|platform)$"](${b});
  node["railway"~"^(station|halt|stop)$"](${b});
  node["public_transport"="station"](${b});
  way["public_transport"="station"](${b});
  way["waterway"~"^(river|canal|stream)$"](${b});
  way["natural"="water"](${b});
  relation["natural"="water"](${b});
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|residential|unclassified|service)$"](${b});
  way["highway"~"^(footway|pedestrian|steps|path|corridor)$"](${b});
  way["man_made"="bridge"](${b});
  way["leisure"~"^(park|garden)$"](${b});
  way["landuse"~"^(grass|recreation_ground)$"](${b});
  way["landuse"]["name"](${b});
  relation["landuse"]["name"](${b});
  way["amenity"="parking"]["building"!~"."](${b});
);
out body geom;`;

mkdirSync(at('raw'), { recursive: true });
writeFileSync(at('raw/overpass-query.overpassql'), query);
const ENDPOINTS = [ENDPOINT, 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
let res;
for (let attempt = 0; attempt < 6; attempt++) {
  const url = ENDPOINTS[attempt % ENDPOINTS.length];
  console.log(`Querying ${url} bbox ${b} (attempt ${attempt + 1})`);
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query),
      signal: AbortSignal.timeout(150000),
    });
    if (res.ok) break;
    console.warn('  HTTP', res.status);
  } catch (err) { console.warn('  failed', err.message); }
  await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
}
if (!res || !res.ok) { console.error('Overpass failed after retries'); process.exit(1); }
const json = await res.json();
json.fetched_at = new Date().toISOString();
json.bbox = BBOX;
writeFileSync(at('raw/overpass.json'), JSON.stringify(json));
console.log('Saved raw/overpass.json with', json.elements.length, 'elements');
