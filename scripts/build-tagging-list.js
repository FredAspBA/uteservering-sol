// Builds data/tagging-list.json — the flat list the collaborative tagging
// page (taggning.html) renders. Derived from data/terraces.geojson, so
// re-run this (via `npm run build-tagging-list`) whenever the terrace data
// is refreshed with `npm run fetch-data`.
//
// Places whose name occurs more than once (chains like Espresso House) get
// an `addr` string so branches are distinguishable in the list. The street
// comes free from OSM's addr:street tag where present; for duplicate-group
// places that lack it, we reverse-geocode the point via Nominatim (OSM's
// own geocoder) once and cache the result in data/geocode-cache.json so
// re-runs don't hammer the service.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, "..", "data");
const cachePath = join(dataDir, "geocode-cache.json");

const VENUE_LABELS = {
  restaurant: "Restaurang",
  cafe: "Kafé",
  fast_food: "Snabbmat",
  bakery: "Bageri",
  confectionery: "Konditori",
  ice_cream: "Glass",
  bar: "Bar",
  pub: "Pub",
  biergarten: "Ölträdgård",
  food_court: "Food court",
  outdoor_seating: "Uteservering",
  post_office: "Postombud",
};

function osmAlcohol(p, key) {
  if (p.alcohol === "no") return "no";
  if (p.alcohol === "yes" || key === "bar" || key === "pub" || key === "biergarten" || p.microbrewery === "yes") {
    return "yes";
  }
  return "unknown";
}

function tagAddress(p) {
  const street = p["addr:street"];
  if (!street) return "";
  const num = p["addr:housenumber"];
  return num ? `${street} ${num}` : street;
}

function pointOf(feature) {
  const g = feature.geometry;
  if (!g) return null;
  if (g.type === "Point") return g.coordinates; // [lon, lat]
  return null; // "out center" gives Points; anything else we just skip geocoding
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadCache() {
  try {
    return JSON.parse(await readFile(cachePath, "utf8"));
  } catch {
    return {};
  }
}

// Reverse-geocode [lon,lat] to a short human location (street or area),
// respecting Nominatim's 1 req/sec usage policy. Returns "" on any failure.
async function reverseGeocode(lon, lat) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "uteservering-sol/1.0 (personal hobby project)" },
    });
    if (!res.ok) return "";
    const a = (await res.json()).address || {};
    return a.road || a.pedestrian || a.footway || a.neighbourhood || a.suburb || a.city_district || "";
  } catch {
    return "";
  }
}

// Places Malmö stads serveringstillstånd-register has a permit for that
// weren't already known to have alcohol in OSM (fas 5, del A — see
// scripts/fetch-serving-permits.js and PLAN-datakvalitet.md fas 5). A
// *suggestion* shown next to the Ja/Nej toggle, never auto-applied — the
// human still confirms via the existing tagging flow. Missing file (script
// hasn't been run yet, or this is a fresh checkout) is not an error: the
// hint is additive, everything works fine without it.
async function loadRegisterAlcoholHints() {
  let rows;
  try {
    rows = JSON.parse(await readFile(join(dataDir, "serving-permits.json"), "utf8"));
  } catch {
    return new Set();
  }
  return new Set(rows.filter((r) => r.resolvesUnknownAlcohol).map((r) => r.matchedOsmId));
}

// Fas 5, del B (see scripts/geocode-unverified-venues.js and PLAN-
// datakvalitet.md fas 5): places Malmö stads serveringstillstånd-register
// confirms have an outdoor-seating permit and aren't in OSM at all. Given
// tagging-list rows here, distinct from normal OSM-derived rows in every
// field that matters — see src/tagging.js's buildRow(), which branches on
// `unverified` early rather than trying to route these through the
// per-OSM-tag Ja/Nej toggle machinery built for a different kind of place.
// Missing file (script hasn't run yet) is not an error, same pattern as
// loadRegisterAlcoholHints() above — the whole feature is additive.
async function loadUnverifiedVenues() {
  let geo;
  try {
    geo = JSON.parse(await readFile(join(dataDir, "unverified-venues.geojson"), "utf8"));
  } catch {
    return [];
  }
  return geo.features
    .map((f) => {
      const p = f.properties || {};
      if (!f.id || !p.name || !f.geometry) return null;
      return {
        id: f.id,
        key: String(f.id).replace("/", "_"), // matches app.js's exclusion-key derivation exactly — "Dölj i appen" works via the same Firebase mechanism as any other place, no app.js changes needed
        name: p.name,
        named: true,
        cat: "Ej i OSM",
        catKey: null, // deliberately absent from the "Typ" dropdown — that filter is for real OSM venue categories; these are reachable via search and the dedicated quick-filter instead
        osmAlcohol: "yes", // confirmed by the register, not a guess — chosen specifically so the normal Ja/Nej-toggle logic (which only fires on "unknown"/"") never engages for these
        osmOutdoor: "yes", // same reasoning
        addr: p.registerAddress || "",
        unverified: true,
        registerId: p.registerId,
        point: f.geometry.coordinates, // [lon, lat] — kept (not stripped like _point) so tagging.js can link straight to "add this in OSM here"
      };
    })
    .filter(Boolean);
}

async function main() {
  const geo = JSON.parse(await readFile(join(dataDir, "terraces.geojson"), "utf8"));
  const registerAlcoholHints = await loadRegisterAlcoholHints();
  const unverifiedVenues = await loadUnverifiedVenues();

  const items = geo.features
    .map((f) => {
      const id = f.id || f.properties?.id;
      if (!id || !id.includes("/")) return null;
      const p = f.properties || {};
      const key = p.amenity || p.shop || p.leisure || "";
      const [osmType, osmNum] = id.split("/");
      return {
        id,
        key: id.replace("/", "_"),
        osmUrl: `https://www.openstreetmap.org/${osmType}/${osmNum}`,
        name: p.name || `(namnlöst: ${VENUE_LABELS[key] || key || "ställe"})`,
        named: Boolean(p.name),
        cat: VENUE_LABELS[key] || key || "?",
        catKey: key,
        osmAlcohol: osmAlcohol(p, key),
        osmOutdoor: p.outdoor_seating || "",
        addr: tagAddress(p),
        registerAlcoholHint: registerAlcoholHints.has(id),
        _point: pointOf(f), // temporary, stripped before writing
      };
    })
    .filter(Boolean);

  items.push(...unverifiedVenues);
  console.log(`${unverifiedVenues.length} platser från Malmö stads register (ej i OSM) tillagda i listan.`);

  // Which names occur more than once → their branches need disambiguating.
  const nameCounts = new Map();
  for (const it of items) if (it.named) nameCounts.set(it.name, (nameCounts.get(it.name) || 0) + 1);

  const toGeocode = items.filter(
    (it) => it.named && nameCounts.get(it.name) > 1 && !it.addr && it._point
  );
  console.log(`${nameCounts.size ? [...nameCounts.values()].filter((n) => n > 1).length : 0} chain names; ${toGeocode.length} branches need geocoding for a street.`);

  const cache = await loadCache();
  let fetched = 0;
  for (const it of toGeocode) {
    if (cache[it.id] !== undefined) {
      it.addr = cache[it.id];
      continue;
    }
    const [lon, lat] = it._point;
    const loc = await reverseGeocode(lon, lat);
    cache[it.id] = loc;
    it.addr = loc;
    fetched++;
    if (fetched % 10 === 0) console.log(`  geocoded ${fetched}/${toGeocode.length}…`);
    await sleep(1100); // stay under Nominatim's 1 req/sec
  }
  if (fetched) await writeFile(cachePath, JSON.stringify(cache, null, 2));
  console.log(`Geocoded ${fetched} new (rest from cache).`);

  // Strip temp field, then sort (named alphabetical first, nameless last).
  for (const it of items) delete it._point;
  items.sort((a, b) => {
    if (a.named !== b.named) return a.named ? -1 : 1;
    return a.name.localeCompare(b.name, "sv");
  });

  await writeFile(
    join(dataDir, "tagging-list.json"),
    JSON.stringify({
      generatedFrom: unverifiedVenues.length
        ? "terraces.geojson + unverified-venues.geojson"
        : "terraces.geojson",
      count: items.length,
      items,
    })
  );
  console.log(`Wrote data/tagging-list.json (${items.length} places)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
