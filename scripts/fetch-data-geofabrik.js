// Fetches terrace and building data for Malmo via Geofabrik's Sweden
// extract + osmium-tool, instead of tiled Overpass queries. Meant to run
// in the GitHub Actions workflow (.github/workflows/refresh-data.yml),
// where osmium-tool is installed via apt and bandwidth is generous — see
// PLAN-datakvalitet.md, fas 3, for why (no more Overpass tiling, 504s, or
// hastighetsbegränsning, and it runs unattended).
//
// scripts/fetch-data.js (Overpass) remains the manual fallback and is
// untouched by this file except for importing the two modules under
// scripts/lib/ that MUST stay identical between both paths (building
// slimming, terrace category rules) — see those files' own comments.
//
// IMPORTANT — testing status (read before debugging a failed Actions run):
// osmium-tool isn't installable in this development environment (no apt,
// no WSL distro, no Docker — verified 2026-08-08), so the four osmium/
// download steps below (downloadSwedenExtract, osmiumExtract,
// osmiumTagsFilter, osmiumExport) could NOT be run end-to-end before this
// first shipped. Their exact flag syntax was checked against osmium-tool's
// current docs (docs.osmcode.org) rather than guessed, but "checked docs"
// is not "ran it". Everything AFTER export — restoreOsmId,
// reduceToRepresentativePoint, the terrace/building filtering, slimming,
// and writing — runs on plain GeoJSON and WAS tested locally against real
// data and hand-built fixtures shaped like osmium's documented output.
// If the first real run fails, it is overwhelmingly likely to be in one of
// those four osmium-calling functions — start there.

import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import * as turf from "@turf/turf";
import { slimBuilding } from "./lib/slim-building.js";
import { OUTDOOR_SEATING_AMENITIES, OUTDOOR_SEATING_SHOPS, isEligibleTerrace } from "./lib/terrace-categories.js";
import { geojsonLinesString, compareByOsmId } from "./lib/write-geojson-lines.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, "..", "data");
const tmpDir = join(__dirname, "..", ".data-tmp"); // gitignored scratch space, see below

// Same bbox as fetch-data.js's SEARCH_BBOX, kept as the single source of
// truth there — this file imports nothing from fetch-data.js (it has no
// exports, being a `main()`-runs-on-import script), so the value is
// duplicated here. If you change one, change both; a mismatch would just
// mean the two fetch paths cover slightly different areas, not a crash.
const SEARCH_BBOX_OVERPASS = "55.558,12.895,55.615,13.035"; // south,west,north,east

const SWEDEN_PBF_URL = "https://download.geofabrik.de/europe/sweden-latest.osm.pbf";

/**
 * Converts Overpass's "south,west,north,east" bbox string into osmium
 * extract's "-b" format, "LONG1,LAT1,LONG2,LAT2" (i.e. west,south,east,north
 * — two opposite corners, verified against docs.osmcode.org/osmium/latest/
 * osmium-extract.html since the two tools use different orders and mixing
 * them up would silently extract the wrong part of Sweden, not error out).
 */
export function osmiumBboxFromOverpassBbox(overpassBbox) {
  const [south, west, north, east] = overpassBbox.split(",").map(Number);
  return `${west},${south},${east},${north}`;
}

/**
 * Reconstructs the `way/12345`-style id the rest of the codebase expects
 * (dataLoad.js, tagging.js, build-tagging-list.js, and cloudVotes.js's
 * Firebase-key derivation all split/replace on that exact shape) from the
 * `@id`/`@type` properties osmium export writes when run with
 * `--attributes=id,type`. Those attributes carry the ORIGINAL, unmodified
 * OSM id/type — deliberately used instead of `--add-unique-id=type_id`,
 * whose ids for polygons are 2x/2x+1 the original way/relation id and
 * would need an error-prone reversal to recover the real id (see
 * docs.osmcode.org/osmium/latest/osmium-export.html, "Feature ID
 * Formatting" vs "Attributes").
 *
 * @returns {{id: string, properties: object} | null} null if the feature
 *   is missing the attributes (shouldn't happen given -a id,type, but a
 *   missing id is a skip-this-feature situation, not a crash-the-run one).
 */
export function restoreOsmId(properties) {
  const type = properties?.["@type"];
  const id = properties?.["@id"];
  if (!type || id == null) return null;
  const { "@id": _id, "@type": _type, ...rest } = properties;
  return { id: `${type}/${id}`, properties: rest };
}

/**
 * Reduces a feature to a single representative Point, exactly matching
 * src/dataLoad.js's toRepresentativePoint() (which runs client-side on
 * whatever terraces.geojson already contains). Kept as a separate,
 * intentionally-duplicated implementation here rather than a shared
 * import: dataLoad.js uses the browser-global `turf` from the CDN
 * <script> tag in index.html, this script uses the @turf/turf npm
 * package — different module systems, not worth bridging for six lines.
 * If the representative-point logic ever needs to change, change both.
 *
 * Today's Overpass path never actually exercises the centroid branch
 * (Overpass's "out center tags" already hands back a point per terrace,
 * see fetch-data.js), but the osmium path here can genuinely receive
 * polygon geometry for a way-tagged venue, so this branch is live here.
 */
export function reduceToRepresentativePoint(feature) {
  if (!feature.geometry) return null;
  if (feature.geometry.type === "Point") return feature;
  try {
    return turf.centroid(feature, { properties: feature.properties });
  } catch {
    return null;
  }
}

function run(cmd, args, { label }) {
  return new Promise((resolve, reject) => {
    console.log(`  $ ${cmd} ${args.join(" ")}`);
    // stdout is "inherit" (osmium's own progress/info output, if any, just
    // flows straight through to the Actions log) rather than "pipe" — a
    // piped stream that nobody reads fills its OS pipe buffer and can make
    // the child process block on its own writes. stderr IS piped, but
    // drained on every "data" event below, so the same risk doesn't apply
    // there; it's captured (for the error message) *and* forwarded live.
    const proc = spawn(cmd, args, { stdio: ["ignore", "inherit", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk); // stream live into the Actions log
    });
    proc.on("error", (err) => reject(new Error(`${label}: failed to start (${err.message})`)));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label}: exited with code ${code}\n${stderr.slice(-2000)}`));
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Downloads the Sweden extract with a small retry — this runs unattended
 * (monthly schedule, no one watching to just click "rerun"), and a ~775 MB
 * transfer has more surface area for a transient network blip than a quick
 * API call. Geofabrik's static-file server is far more reliable than the
 * public Overpass instance fetch-data.js has to work around, so this is
 * deliberately simpler than that file's backoff — just enough to not fail
 * the whole month's run over one dropped connection.
 */
async function downloadSwedenExtract(destPath) {
  const attempts = 3;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      console.log(`Downloading Sweden extract from ${SWEDEN_PBF_URL} (~775 MB, attempt ${attempt}/${attempts})...`);
      const res = await fetch(SWEDEN_PBF_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await finished(Readable.fromWeb(res.body).pipe(createWriteStream(destPath)));
      console.log(`  -> saved to ${destPath}`);
      return;
    } catch (err) {
      if (attempt === attempts) throw new Error(`Geofabrik download failed after ${attempts} attempts: ${err.message}`);
      console.warn(`  download attempt ${attempt} failed (${err.message}), retrying in 10s...`);
      await sleep(10000);
    }
  }
}

/** osmium extract: Sweden -> Malmo bbox, complete_ways so no way is cut at
 * the boundary (matches Overpass's "keep the whole way if any node is in
 * the bbox" behaviour used by fetch-data.js today). */
async function osmiumExtract(inputPbf, outputPbf) {
  const bbox = osmiumBboxFromOverpassBbox(SEARCH_BBOX_OVERPASS);
  console.log(`Extracting Malmo bbox (${bbox}) via osmium extract...`);
  await run(
    "osmium",
    ["extract", "-b", bbox, "-s", "complete_ways", inputPbf, "-o", outputPbf, "--overwrite"],
    { label: "osmium extract" }
  );
}

/** osmium tags-filter: broad category filter only (amenity/shop/leisure
 * IN (...) for terraces, building=* for buildings). The outdoor_seating!=no
 * exclusion isn't expressed here — osmium's filter grammar can't combine
 * "key A is one of these values" AND "key B is not this other value" in a
 * single OR'd expression list — so it's applied afterward in JS via
 * isEligibleTerrace(), imported from the same module fetch-data.js's
 * Overpass query string is built from, so the two can't drift apart on
 * which venues qualify. */
async function osmiumTagsFilter(inputPbf, outputPbf, expressions, label) {
  console.log(`Filtering ${label} via osmium tags-filter...`);
  await run("osmium", ["tags-filter", inputPbf, ...expressions, "-o", outputPbf, "--overwrite"], {
    label: `osmium tags-filter (${label})`,
  });
}

/** osmium export: pbf -> GeoJSON, with the ORIGINAL osm id/type attached
 * as @id/@type properties (see restoreOsmId's doc comment for why that
 * option was chosen over --add-unique-id). */
async function osmiumExport(inputPbf, outputGeojson, geometryTypes) {
  console.log(`Exporting ${inputPbf} -> GeoJSON (${geometryTypes})...`);
  await run(
    "osmium",
    [
      "export",
      inputPbf,
      "-o",
      outputGeojson,
      "-f",
      "geojson",
      "--attributes=id,type",
      `--geometry-types=${geometryTypes}`,
      "--overwrite",
    ],
    { label: "osmium export" }
  );
}

/** Turns the broad OUTDOOR_SEATING_AMENITIES/SHOPS lists into osmium
 * tags-filter expressions. `nw/` matches nodes AND ways in one expression
 * (osmium-tool syntax, verified against docs.osmcode.org/osmium/latest/
 * osmium-tags-filter.html) — Overpass needs separate node[...]/way[...]
 * clauses for the same thing, hence fetch-data.js's query looks busier for
 * an equivalent selection. */
function terraceFilterExpressions() {
  return [
    `nw/amenity=${OUTDOOR_SEATING_AMENITIES.join(",")}`,
    `nw/shop=${OUTDOOR_SEATING_SHOPS.join(",")}`,
    "nw/leisure=outdoor_seating",
  ];
}

/**
 * Post-processes a raw osmium-export GeoJSON FeatureCollection of terrace
 * candidates into the shape data/terraces.geojson has always had: id
 * restored to `type/num`, outdoor_seating=no excluded (the one thing the
 * osmium filter step above couldn't express), and every feature reduced to
 * a single representative Point. Exported for local testing against
 * hand-built fixtures — see the doc comment at the top of this file for
 * why that matters here.
 */
export function processTerraces(rawFeatureCollection) {
  if (!Array.isArray(rawFeatureCollection?.features)) {
    // A missing/non-array `features` means osmium export produced something
    // other than a real FeatureCollection — a more specific signal than
    // letting this fall through to an opaque "938 -> 0" from the ±20% gate
    // downstream, which would look like a legitimate empty result rather
    // than a malformed one.
    throw new Error("processTerraces: raw input has no features array — osmium export likely failed or produced unexpected output");
  }
  const out = [];
  for (const feature of rawFeatureCollection.features) {
    const restored = restoreOsmId(feature.properties);
    if (!restored) continue;
    if (!isEligibleTerrace(restored.properties)) continue;
    const point = reduceToRepresentativePoint({ ...feature, properties: restored.properties });
    if (!point) continue;
    out.push({ type: "Feature", id: restored.id, properties: restored.properties, geometry: point.geometry });
  }
  return { type: "FeatureCollection", features: out };
}

/**
 * Same idea for buildings: restore the id, then hand off to the SAME
 * slimBuilding() the Overpass path uses, so tag-keeping and geometry
 * simplify/buffer treatment is identical regardless of which fetch path
 * produced the raw data.
 */
export function processBuildings(rawFeatureCollection) {
  if (!Array.isArray(rawFeatureCollection?.features)) {
    throw new Error("processBuildings: raw input has no features array — osmium export likely failed or produced unexpected output");
  }
  const out = [];
  for (const feature of rawFeatureCollection.features) {
    const restored = restoreOsmId(feature.properties);
    if (!restored) continue;
    const slim = slimBuilding({ type: "Feature", id: restored.id, properties: restored.properties, geometry: feature.geometry });
    if (slim) out.push(slim);
  }
  return { type: "FeatureCollection", features: out };
}

async function main() {
  await mkdir(tmpDir, { recursive: true });
  const swedenPbf = join(tmpDir, "sweden-latest.osm.pbf");
  const malmoPbf = join(tmpDir, "malmo.osm.pbf");
  const terracesRawPbf = join(tmpDir, "terraces-raw.osm.pbf");
  const buildingsRawPbf = join(tmpDir, "buildings-raw.osm.pbf");
  const terracesRawGeojson = join(tmpDir, "terraces-raw.geojson");
  const buildingsRawGeojson = join(tmpDir, "buildings-raw.geojson");

  await downloadSwedenExtract(swedenPbf);
  await osmiumExtract(swedenPbf, malmoPbf);

  await osmiumTagsFilter(malmoPbf, terracesRawPbf, terraceFilterExpressions(), "terraces");
  // way["building"] + relation["building"] — mirrors fetch-data.js's
  // buildingsQuery() exactly (no value restriction on the building tag).
  // Node excluded on purpose: a `building` tag on a bare node isn't valid
  // OSM (buildings are areas), so "w/" + "r/" alone already covers every
  // real building — no point widening the intermediate pbf with "n/" too.
  await osmiumTagsFilter(malmoPbf, buildingsRawPbf, ["w/building", "r/building"], "buildings");

  // Terraces: node-tagged venues (points) and way-tagged venues (usually
  // polygons, e.g. a cafe mapped as its building outline) both occur in
  // this dataset (825 node / 113 way today) — export both geometry types,
  // processTerraces() below reduces polygons to a representative point.
  await osmiumExport(terracesRawPbf, terracesRawGeojson, "point,polygon");
  // Buildings: polygon only. A `building` tag on a bare node or open way
  // isn't valid OSM (buildings are areas), so nothing meaningful is lost.
  await osmiumExport(buildingsRawPbf, buildingsRawGeojson, "polygon");

  console.log("Post-processing (id restoration, filtering, slimming)...");
  const terracesRaw = JSON.parse(await readFile(terracesRawGeojson, "utf8"));
  const buildingsRaw = JSON.parse(await readFile(buildingsRawGeojson, "utf8"));

  const terraces = processTerraces(terracesRaw);
  const buildings = processBuildings(buildingsRaw);
  console.log(`  -> ${terraces.features.length} terrace features, ${buildings.features.length} building features`);

  // Written as .new — never overwrites the committed data/*.geojson
  // directly. scripts/check-data-drift.js gates the swap; the workflow
  // only renames .new -> real once that gate passes. See that script's
  // top comment for the full reasoning.
  await writeFile(join(dataDir, "terraces.geojson.new"), geojsonLinesString(terraces, compareByOsmId));
  await writeFile(join(dataDir, "buildings.geojson.new"), geojsonLinesString(buildings, compareByOsmId));
  console.log("Wrote data/terraces.geojson.new and data/buildings.geojson.new");

  await rm(tmpDir, { recursive: true, force: true });
}

// Guarded so importing this module's exported helpers for testing (see the
// top-of-file comment on testing status) never accidentally triggers the
// real ~775 MB download + osmium pipeline — only running it directly
// (`node scripts/fetch-data-geofabrik.js`) does. Found the hard way: an
// early test import ran the whole thing before this guard existed.
// pathToFileURL (not a manual string template) so this compares correctly
// on both Windows (drive letters, backslashes, space-encoding) and the
// Linux Actions runner this actually ships to.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("fetch-data-geofabrik failed:", err);
    process.exit(1);
  });
}
