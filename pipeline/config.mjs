// Study area: ~1 km x 1 km centred between Abdullah Hukum LRT and Mid Valley KTM.
// Centre derived from Nominatim geocodes (2026-10-10) of the five named places.
export const CENTER = { lat: 3.118, lon: 101.6758 };
export const HALF_SIZE_M = 500;
const R = 6378137;
const dLat = (HALF_SIZE_M / (Math.PI * R / 180));
const dLon = (HALF_SIZE_M / (Math.PI * R / 180 * Math.cos(CENTER.lat * Math.PI / 180)));
export const BBOX = {
  south: +(CENTER.lat - dLat).toFixed(6),
  west: +(CENTER.lon - dLon).toFixed(6),
  north: +(CENTER.lat + dLat).toFixed(6),
  east: +(CENTER.lon + dLon).toFixed(6),
};
export const USER_AGENT = 'map-assets/0.1 (local site-analysis prototype)';
