// Fetches terrace (outdoor seating) and building data for central Malmo from
// OpenStreetMap via the Overpass API, and writes them as GeoJSON into ../data/.
// Re-run this script manually whenever you want to refresh the data
// (it is not fetched live on page load, since Overpass is rate-limited/slow).

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import osmtogeojson from "osmtogeojson";
import * as turf from "@turf/turf";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, "..", "data");

// Bbox covering central Malmo plus Limhamn, Slottsstaden, Fridhem,
// Erikslust, Fagelbacken, Nobel and Dalaplan (south,west,north,east).
// Used only for the terraces query; the buildings query below uses a
// tighter bbox derived from where the terraces actually turned out to be,
// since "out geom" over the full area was too slow for Overpass (504s).
const SEARCH_BBOX = "55.558,12.895,55.615,13.035";

// How far buildings might realistically shade a terrace (matches
// MAX_RAY_METERS in src/shadow.js), plus a margin.
const BUILDING_PADDING_METERS = 600;

// Note: overpass.kumi.systems is unreachable from this machine (TLS
// connection resets immediately, 0 bytes read — looks like a network/proxy
// block rather than a server-side issue) so it's not worth listing as a
// fallback; it would just add multi-minute hangs per attempt. If it starts
// working again in your environment, add it back as a second entry.
const ENDPOINTS = ["https://overpass-api.de/api/interpreter"];

// amenity types that commonly have outdoor seating in Malmo: cafes,
// restaurants, bars/pubs, ice cream places ("glasstallen"), fast food
// (food trucks/kiosks with picnic tables), biergartens and food courts.
const OUTDOOR_SEATING_AMENITIES =
  "cafe|restaurant|bar|pub|ice_cream|fast_food|biergarten|food_court";

function terracesQuery(bbox) {
  return `
[out:json][timeout:60];
(
  node["amenity"~"^(${OUTDOOR_SEATING_AMENITIES})$"]["outdoor_seating"~"^(yes|only)$"](${bbox});
  way["amenity"~"^(${OUTDOOR_SEATING_AMENITIES})$"]["outdoor_seating"~"^(yes|only)$"](${bbox});
  node["leisure"="outdoor_seating"](${bbox});
  way["leisure"="outdoor_seating"](${bbox});
);
out center tags;
`;
}

function buildingsQuery(bbox) {
  return `
[out:json][timeout:120];
(
  way["building"](${bbox});
  relation["building"](${bbox});
);
out geom;
`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_ATTEMPTS = 5;
const FETCH_TIMEOUT_MS = 30000;
const RETRY_DELAYS_MS = [5000, 10000, 20000, 30000, 45000];

async function runQuery(query) {
  let lastErr;
  for (const endpoint of ENDPOINTS) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "text/plain",
            Accept: "application/json",
            "User-Agent": "uteservering-sol/1.0 (personal hobby project)",
          },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (res.status === 429 || res.status === 504) {
          lastErr = new Error(`${endpoint} responded ${res.status} after ${attempt} attempts`);
          const waitMs = RETRY_DELAYS_MS[attempt - 1] ?? 45000;
          console.warn(
            `${endpoint} responded ${res.status}, retrying in ${waitMs}ms (attempt ${attempt}/${MAX_ATTEMPTS})`
          );
          await sleep(waitMs);
          continue;
        }
        if (!res.ok) {
          throw new Error(`${endpoint} responded ${res.status} ${res.statusText}`);
        }
        return await res.json();
      } catch (err) {
        console.warn(`Overpass endpoint failed (${endpoint}): ${err.message}`);
        lastErr = err;
        await sleep(RETRY_DELAYS_MS[attempt - 1] ?? 45000);
      }
    }
  }
  throw lastErr;
}

/** [south, west, north, east] string bbox around the terraces' extent, padded. */
function bboxFromTerraces(terracesGeojson) {
  const fc = turf.featureCollection(
    terracesGeojson.features.filter((f) => f.geometry)
  );
  const [minX, minY, maxX, maxY] = turf.bbox(fc);
  const padded = turf.bbox(
    turf.buffer(turf.bboxPolygon([minX, minY, maxX, maxY]), BUILDING_PADDING_METERS, {
      units: "meters",
    })
  );
  return padded; // [west, south, east, north]
}

/**
 * Splits a [west, south, east, north] bbox into a cols x rows grid of
 * "south,west,north,east" strings for Overpass. The full-extent buildings
 * query times out (504) on the public Overpass instance, since terraces
 * span a wide area of Malmo and "out geom" over the whole extent is too
 * much work for one request — smaller tiles complete reliably.
 */
function tileBbox([west, south, east, north], cols, rows) {
  const tiles = [];
  const dx = (east - west) / cols;
  const dy = (north - south) / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const w = west + c * dx;
      const e = west + (c + 1) * dx;
      const s = south + r * dy;
      const n = south + (r + 1) * dy;
      tiles.push(`${s},${w},${n},${e}`);
    }
  }
  return tiles;
}

// Target tile size that reliably avoids Overpass 504 timeouts (empirically
// ~1.5-2 km^2 tiles completed fine; bigger tiles started timing out).
const TARGET_TILE_KM2 = 1.8;

/** Picks a cols x rows grid sized so each tile is roughly TARGET_TILE_KM2,
 * matching the grid's aspect ratio to the bbox's aspect ratio. */
function pickTileGrid([west, south, east, north]) {
  const midLatRad = (((south + north) / 2) * Math.PI) / 180;
  const widthKm = (east - west) * 111 * Math.cos(midLatRad);
  const heightKm = (north - south) * 111;
  const areaKm2 = widthKm * heightKm;
  const totalTiles = Math.max(4, Math.ceil(areaKm2 / TARGET_TILE_KM2));
  const aspect = widthKm / heightKm;
  const rows = Math.max(1, Math.round(Math.sqrt(totalTiles / aspect)));
  const cols = Math.max(1, Math.round(totalTiles / rows));
  return { cols, rows, areaKm2 };
}

async function main() {
  console.log("Fetching terraces (outdoor seating) from Overpass...");
  const terracesOsm = await runQuery(terracesQuery(SEARCH_BBOX));
  const terracesGeojson = osmtogeojson(terracesOsm);
  console.log(`  -> ${terracesGeojson.features.length} terrace features`);

  await writeFile(
    join(dataDir, "terraces.geojson"),
    JSON.stringify(terracesGeojson, null, 2)
  );
  console.log("Wrote data/terraces.geojson");

  const sampleNames = terracesGeojson.features
    .map((f) => f.properties?.name)
    .filter(Boolean)
    .slice(0, 10);
  console.log("Sample terrace names:", sampleNames);

  const paddedBbox = bboxFromTerraces(terracesGeojson);
  const { cols, rows, areaKm2 } = pickTileGrid(paddedBbox);
  const tiles = tileBbox(paddedBbox, cols, rows);
  console.log(
    `Fetching buildings from Overpass across ${tiles.length} tiles (${cols}x${rows} grid, ~${areaKm2.toFixed(1)} km^2 total)...`
  );

  const buildingsById = new Map();
  const failedTiles = [];
  for (const [i, tile] of tiles.entries()) {
    console.log(`  tile ${i + 1}/${tiles.length} (${tile})`);
    try {
      const osm = await runQuery(buildingsQuery(tile));
      const geojson = osmtogeojson(osm);
      for (const feature of geojson.features) {
        buildingsById.set(feature.id ?? JSON.stringify(feature.geometry), feature);
      }
    } catch (err) {
      // Overpass's public instance is occasionally flaky (429/504/socket
      // errors) even per-tile. Skip the tile rather than losing every
      // already-fetched tile's data — re-run this script later to retry
      // just the missing coverage (buildingsById re-merges by osm id).
      console.warn(`  tile ${i + 1} failed permanently, skipping: ${err.message}`);
      failedTiles.push(tile);
    }
    await sleep(3000); // be polite to the shared public Overpass instance
  }
  const buildingsGeojson = {
    type: "FeatureCollection",
    features: [...buildingsById.values()],
  };
  console.log(`  -> ${buildingsGeojson.features.length} unique building features`);
  if (failedTiles.length) {
    console.warn(
      `  WARNING: ${failedTiles.length}/${tiles.length} tiles failed and were skipped — building coverage has gaps in those areas. Re-run this script to retry.`
    );
  }

  await writeFile(
    join(dataDir, "buildings.geojson"),
    JSON.stringify(buildingsGeojson, null, 2)
  );
  console.log("Wrote data/buildings.geojson");
}

main().catch((err) => {
  console.error("fetch-data failed:", err);
  process.exit(1);
});
