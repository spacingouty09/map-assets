// The spot index and per-area loading. A site lists the areas, then loads only the ones it shows:
//   listAreas()            -> every area's id, name, kind, centre, bounds, stations and lines (areas/index.json)
//   await loadArea('klcc') -> one Area; each area's data is its own chunk, fetched on first use and cached
import indexJ from '../areas/index.json';
import { AREA_LOADERS } from './areas.gen';
import { buildArea, type Area, type AreaInfo } from './data';

const INDEX = indexJ as unknown as AreaInfo[];
const cache = new Map<string, Promise<Area>>();

/** Every area in map-assets (the spot index), optionally only one kind ('signature' spots or 'site' areas). */
export function listAreas(kind?: AreaInfo['kind']): AreaInfo[] {
  return INDEX.filter((a) => !kind || a.kind === kind);
}

/** One area's data, typed and with derived lookups and stats. Rejects for an unknown id. */
export function loadArea(id: string): Promise<Area> {
  const info = INDEX.find((a) => a.id === id); const load = AREA_LOADERS[id];
  if (!info || !load) return Promise.reject(new Error(`unknown area "${id}" (known: ${INDEX.map((a) => a.id).join(', ')})`));
  let p = cache.get(id);
  if (!p) { p = load().then((raw) => buildArea(info, raw)); cache.set(id, p); }
  return p;
}
