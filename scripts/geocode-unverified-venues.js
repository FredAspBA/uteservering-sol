// Fas 5, del B: geocodes the Malmö stad register places that have an
// outdoor-seating permit, serve the general public, and don't exist in
// OSM at all — building on del A's data (see scripts/fetch-serving-
// permits.js and scripts/fetch-serving-permit-details.js). Writes
// data/unverified-venues.geojson, in the same Feature shape as
// terraces.geojson, so src/dataLoad.js can merge it in unchanged. Never
// touches terraces.geojson itself — that file stays purely OSM-derived.
//
// Caveat found while building this (worth knowing before trusting the
// output): Sweden's OSM address-point coverage is sparse — Nominatim
// usually can't resolve a specific house number here, only the street it
// sits on (verified live against several addresses; no addr:interpolation
// ways either). So most geocoded points land "somewhere on the right
// street", not at the exact building. Good enough to get a venue on the
// map and sun-checkable, not good enough to claim precision — the app
// must present these as approximate, not equivalent to an OSM-sourced
// point.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, "..", "data");
const cachePath = join(dataDir, "geocode-forward-cache.json");

const USER_AGENT = "uteservering-sol/1.0 (personal hobby project)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadCache() {
  try {
    return JSON.parse(await readFile(cachePath, "utf8"));
  } catch {
    return {};
  }
}

// Forward-geocodes one address via Nominatim's structured search,
// respecting its 1 req/sec usage policy (caller sleeps between calls).
// Returns {lat, lon} or null if nothing matched.
async function geocode(address) {
  const url =
    `https://nominatim.openstreetmap.org/search?format=jsonv2&street=${encodeURIComponent(address)}` +
    `&city=Malm%C3%B6&country=Sweden&limit=1`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) return null;
    const results = await res.json();
    if (!results.length) return null;
    return { lat: Number(results[0].lat), lon: Number(results[0].lon) };
  } catch {
    return null;
  }
}

async function loadCandidates() {
  const permits = JSON.parse(await readFile(join(dataDir, "serving-permits.json"), "utf8"));
  const details = JSON.parse(await readFile(join(dataDir, "serving-permit-details.json"), "utf8"));
  const permitsById = new Map(permits.map((p) => [p.registerId, p]));

  // The three independent gates, all required: has an outdoor-seating
  // permit, serves the general public (not just closed events), AND
  // actually holds an alcohol permit of some type (true for all of them
  // in practice — this register is specifically an alcohol-serving
  // register — but checked explicitly rather than assumed).
  return details
    .filter((d) => d.uteservering && d.allmanheten)
    .map((d) => ({ ...d, hasAlcoholPermit: permitsById.get(d.registerId)?.hasAlcoholPermit }))
    .filter((d) => d.hasAlcoholPermit);
}

async function main() {
  const candidates = await loadCandidates();
  console.log(`${candidates.length} kandidater att geokoda ...`);

  const cache = await loadCache();
  const features = [];
  let cached = 0;
  let geocoded = 0;
  let failed = 0;

  for (const [i, c] of candidates.entries()) {
    let coords = cache[c.registerId];
    if (coords === undefined) {
      coords = await geocode(c.address);
      cache[c.registerId] = coords; // cache misses too (null), so a
      // permanently-ungeocodable address isn't retried every run.
      geocoded++;
      await sleep(1100); // stay under Nominatim's 1 req/sec
    } else {
      cached++;
    }

    if (!coords) {
      failed++;
      continue;
    }

    features.push({
      type: "Feature",
      id: `malmo-register/${c.registerId}`,
      properties: {
        name: c.name,
        alcohol: "yes", // confirmed by the register's own permit, not a guess
        verified: false, // NOT from OSM — see popup treatment in app.js
        registerId: c.registerId,
        registerAddress: c.address,
      },
      geometry: { type: "Point", coordinates: [coords.lon, coords.lat] },
    });

    if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${candidates.length} ...`);
  }

  await writeFile(cachePath, JSON.stringify(cache, null, 2) + "\n");
  await writeFile(
    join(dataDir, "unverified-venues.geojson"),
    JSON.stringify({ type: "FeatureCollection", features }, null, 2) + "\n"
  );

  console.log(`\n${features.length} geokodade och skrivna (${cached} från cache, ${geocoded} nya, ${failed} misslyckades).`);
  console.log(`Skrev data/unverified-venues.geojson.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
