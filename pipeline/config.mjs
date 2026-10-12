// Study areas live in areas/<id>/: area.json (name, centre, half size), rules.json, raw/, sources/, data/.
// The study square is ±halfSizeM around the centre; its bbox is computed here.
import { readFileSync, readdirSync, existsSync } from 'node:fs';

/** A path inside the repo, whatever the working directory. */
export const at = (p) => new URL(`../${p}`, import.meta.url);
export const USER_AGENT = 'map-assets/0.2 (local site-analysis prototype)';

/** Ids of all areas (folders in areas/ with an area.json), sorted. */
export function areaIds() {
  return readdirSync(at('areas'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(at(`areas/${d.name}/area.json`)))
    .map((d) => d.name).sort();
}

/** area.json of one area plus its bbox; throws a readable error for an unknown id. */
export function areaConfig(id) {
  if (!id || !existsSync(at(`areas/${id}/area.json`))) throw new Error(`unknown area "${id}" (known: ${areaIds().join(', ')})`);
  const cfg = JSON.parse(readFileSync(at(`areas/${id}/area.json`), 'utf8'));
  const R = 6378137;
  const dLat = (cfg.halfSizeM / (Math.PI * R / 180));
  const dLon = (cfg.halfSizeM / (Math.PI * R / 180 * Math.cos(cfg.center.lat * Math.PI / 180)));
  const bbox = {
    south: +(cfg.center.lat - dLat).toFixed(6),
    west: +(cfg.center.lon - dLon).toFixed(6),
    north: +(cfg.center.lat + dLat).toFixed(6),
    east: +(cfg.center.lon + dLon).toFixed(6),
  };
  return { ...cfg, bbox };
}
