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

async function main() {
  const geo = JSON.parse(await readFile(join(dataDir, "terraces.geojson"), "utf8"));

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
        _point: pointOf(f), // temporary, stripped before writing
      };
    })
    .filter(Boolean);

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
    JSON.stringify({ generatedFrom: "terraces.geojson", count: items.length, items })
  );
  console.log(`Wrote data/tagging-list.json (${items.length} places)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
