// Cloud-cover forecast from SMHI's open meteorological forecast API, used
// to add a "is the sky actually clear?" caveat to a "Sol" verdict — the
// shadow calculation only knows the sun's geometric position, not whether
// clouds would block it. See PLAN-datakvalitet.md's "Förbättringsförslag"
// section (2026-08-11) for the reasoning behind adding this.
//
// Endpoint verified live 2026-08-12 (not assumed from training data, which
// would have pointed at the old "pmp3g" API — that was discontinued
// 2026-03-31 and replaced by "snow1g"; the two aren't drop-in compatible,
// see docs.smhi.se's changelog). No API key needed.
//
// Licence: SMHI's open data is CC BY 4.0 (attribution required, unlike the
// CC0 Lantmäteriet sources elsewhere in this project) — see the footer
// credit in index.html.

const FORECAST_URL = (lat, lon) =>
  `https://opendata-download-metfcst.smhi.se/api/category/snow1g/version/1/geotype/point/lon/${lon}/lat/${lat}/data.json`;

let forecastPromise = null;

/**
 * Fetches the cloud-cover forecast once per page load and caches the
 * promise — a single request covers the entire ~10-day forecast window
 * (verified: 80 timesteps, hourly near-term thinning to 12-hourly by the
 * end), so there's no need to refetch as the user moves the time slider
 * or changes date; findClosestForecast() below just looks up the nearest
 * already-fetched timestep. Never throws: a failed/slow fetch degrades to
 * "no cloud badge shown", the same "optional, app works without it"
 * pattern as fetchExcludedKeys() in cloudVotes.js.
 *
 * @returns {Promise<Array<{time: string, cloudAreaFraction: number}>|null>}
 */
export function fetchCloudForecast(lat, lon) {
  if (!forecastPromise) {
    forecastPromise = (async () => {
      try {
        // Bounded, like fetch-data.js's Overpass calls — this must never be
        // able to hang the app waiting on a slow/stuck connection. Kept
        // short (this is a "nice to have" badge, called eagerly at page
        // load, not something worth making the user wait on at all).
        const res = await fetch(FORECAST_URL(lat, lon), { signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error(`SMHI svarade ${res.status}`);
        const body = await res.json();
        return body.timeSeries.map((step) => ({
          time: step.time, // ISO 8601 UTC
          // cloud_area_fraction is in oktas (0-8, WMO's standard cloud-cover
          // scale: 0 = clear sky, 8 = fully overcast) — verified against a
          // real response, not assumed from the parameter name alone.
          cloudAreaFraction: step.data.cloud_area_fraction,
        }));
      } catch (err) {
        console.warn("Kunde inte hämta molnprognos från SMHI:", err);
        return null;
      }
    })();
  }
  return forecastPromise;
}

// How close a forecast timestep must be to the requested date to still be
// considered relevant, in milliseconds. Matches the forecast's own coarsest
// resolution (12h, reached ~7 days out) plus a little slack — a timestep
// further away than this isn't really "the forecast for that moment", it's
// a forecast for sometime else nearby, and showing it would overstate
// precision. This is also what naturally excludes past dates and anything
// beyond the ~10-day forecast horizon: nothing within the array is ever
// that close to them.
const MAX_RELEVANT_GAP_MS = 13 * 60 * 60 * 1000;

/**
 * Finds the forecast timestep closest to `date`, or null if none is close
 * enough to be meaningful (see MAX_RELEVANT_GAP_MS) — the caller's signal
 * to simply not show a cloud badge. Linear scan: the array is at most ~80
 * entries, not worth a binary search over.
 *
 * @param {Array<{time: string, cloudAreaFraction: number}>|null} forecast
 * @param {Date} date
 * @returns {{ clearPercent: number, forecastTime: Date } | null}
 */
export function findClosestForecast(forecast, date) {
  if (!forecast || !forecast.length) return null;
  const target = date.getTime();
  let closest = null;
  let closestGap = Infinity;
  for (const step of forecast) {
    const gap = Math.abs(new Date(step.time).getTime() - target);
    if (gap < closestGap) {
      closestGap = gap;
      closest = step;
    }
  }
  if (!closest || closestGap > MAX_RELEVANT_GAP_MS) return null;
  return {
    // 0 oktas (clear) -> 100%, 8 oktas (fully overcast) -> 0%.
    clearPercent: Math.round(((8 - closest.cloudAreaFraction) / 8) * 100),
    forecastTime: new Date(closest.time),
  };
}
