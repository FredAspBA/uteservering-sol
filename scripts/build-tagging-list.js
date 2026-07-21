// Builds data/tagging-list.json — the flat list the collaborative tagging
// page (taggning.html) renders. Derived from data/terraces.geojson, so
// re-run this (via `npm run build-tagging-list`) whenever the terrace data
// is refreshed with `npm run fetch-data`.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, "..", "data");

// Same Swedish labels the app popup uses (keep in sync with src/app.js).
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

// Same definitional alcohol logic as the app: bars/pubs/biergartens sell
// alcohol by OSM definition; explicit alcohol=/microbrewery= tags honoured.
function osmAlcohol(p, key) {
  if (p.alcohol === "no") return "no";
  if (p.alcohol === "yes" || key === "bar" || key === "pub" || key === "biergarten" || p.microbrewery === "yes") {
    return "yes";
  }
  return "unknown";
}

async function main() {
  const geo = JSON.parse(await readFile(join(dataDir, "terraces.geojson"), "utf8"));

  const items = geo.features
    .map((f) => {
      const id = f.id || f.properties?.id;
      if (!id || !id.includes("/")) return null; // need a real OSM id to link/key on
      const p = f.properties || {};
      const key = p.amenity || p.shop || p.leisure || "";
      const [osmType, osmNum] = id.split("/");
      return {
        id, // "node/123"
        key: id.replace("/", "_"), // Firebase-safe key "node_123"
        osmUrl: `https://www.openstreetmap.org/${osmType}/${osmNum}`,
        name: p.name || `(namnlöst: ${VENUE_LABELS[key] || key || "ställe"})`,
        named: Boolean(p.name),
        cat: VENUE_LABELS[key] || key || "?",
        catKey: key,
        osmAlcohol: osmAlcohol(p, key),
        osmOutdoor: p.outdoor_seating || "", // "yes" | "only" | "no" | ""
      };
    })
    .filter(Boolean)
    // Named places first (alphabetical), nameless ones grouped at the end —
    // they're the hardest to identify so they shouldn't head the worklist.
    .sort((a, b) => {
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
