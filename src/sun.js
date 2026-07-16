// Thin wrapper around SunCalc so the rest of the app works with plain
// degrees and standard compass bearings instead of SunCalc's radians /
// south-origin azimuth convention.

/**
 * @param {number} lat
 * @param {number} lon
 * @param {Date} date
 * @returns {{ altitudeDeg: number, bearingDeg: number }}
 *   altitudeDeg: sun height above horizon in degrees (<=0 means night/below horizon)
 *   bearingDeg: standard compass bearing to the sun (0=N, 90=E, 180=S, 270=W)
 */
export function getSunInfo(lat, lon, date) {
  const pos = SunCalc.getPosition(date, lat, lon);
  const altitudeDeg = (pos.altitude * 180) / Math.PI;
  // SunCalc azimuth: radians, measured from south, positive towards west.
  const bearingDeg = (((pos.azimuth * 180) / Math.PI + 180) % 360 + 360) % 360;
  return { altitudeDeg, bearingDeg };
}
