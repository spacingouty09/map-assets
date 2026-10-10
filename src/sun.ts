// Solar position after the NOAA Solar Calculator equations (NOAA Global Monitoring Laboratory,
// "General Solar Position Calculations", based on Meeus, Astronomical Algorithms).
// Geometric altitude: atmospheric refraction is ignored (adds < 1° except right at the horizon).
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
export const MYT_OFFSET_MIN = 8 * 60; // Malaysia Time, UTC+8, no daylight saving

export interface SunPos { altitude: number; azimuth: number; declination: number; eotMin: number }

export function sunPosition(date: Date, lat: number, lon: number): SunPos {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const T = (jd - 2451545) / 36525;
  const L0 = (((280.46646 + T * (36000.76983 + T * 0.0003032)) % 360) + 360) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const Mr = rad(M);
  const C = Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * Mr) * (0.019993 - 0.000101 * T) + Math.sin(3 * Mr) * 0.000289;
  const omega = 125.04 - 1934.136 * T;
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(rad(omega));
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(rad(omega));
  const decl = deg(Math.asin(Math.sin(rad(eps)) * Math.sin(rad(lambda))));
  const y = Math.tan(rad(eps / 2)) ** 2; const L0r = rad(L0);
  const eot = 4 * deg(y * Math.sin(2 * L0r) - 2 * e * Math.sin(Mr) + 4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r) - 0.5 * y * y * Math.sin(4 * L0r) - 1.25 * e * e * Math.sin(2 * Mr));
  const utcMin = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const tst = (((utcMin + eot + 4 * lon) % 1440) + 1440) % 1440;
  const ha = rad(tst / 4 - 180); const la = rad(lat); const dr = rad(decl);
  const cosZ = Math.min(1, Math.max(-1, Math.sin(la) * Math.sin(dr) + Math.cos(la) * Math.cos(dr) * Math.cos(ha)));
  const altitude = 90 - deg(Math.acos(cosZ));
  const azimuth = (deg(Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(la) - Math.tan(dr) * Math.cos(la))) + 180 + 360) % 360;
  return { altitude, azimuth, declination: decl, eotMin: eot };
}

/** A Date for a local Malaysia-time wall clock reading. */
export const mytDate = (y: number, month: number, day: number, minutesOfDay: number) => new Date(Date.UTC(y, month - 1, day) + (minutesOfDay - MYT_OFFSET_MIN) * 60000);

/** Unit vector pointing at the sun in scene coordinates (x east, y up, z = -north). */
export const sunVector = (altitude: number, azimuth: number): [number, number, number] => {
  const a = rad(altitude), z = rad(azimuth);
  return [Math.sin(z) * Math.cos(a), Math.sin(a), -Math.cos(z) * Math.cos(a)];
};

/** Highest altitude of the day (solar noon), searched minute by minute in MYT. */
export function solarNoon(y: number, month: number, day: number, lat: number, lon: number) {
  let best = { minutes: 0, pos: sunPosition(mytDate(y, month, day, 0), lat, lon) };
  for (let m = 9 * 60; m <= 16 * 60; m++) { const pos = sunPosition(mytDate(y, month, day, m), lat, lon); if (pos.altitude > best.pos.altitude) best = { minutes: m, pos }; }
  return best;
}

/** 16-point compass label index (0 = N, 4 = E, ...). */
export const compassIndex = (az: number) => Math.round(az / 22.5) % 16;
