// Fetches Malmö stad's publika serveringstillstånd-register (restaurang.
// malmo.se) and matches it against data/terraces.geojson, to resolve
// `alcohol=unknown` OSM places with a real government signal instead of a
// guess. Fas 5, del A, in PLAN-datakvalitet.md — read that section for the
// full reasoning (why the list page alone is enough, the PII boundary,
// the matching strategy). Writes data/serving-permits.json; never touches
// terraces.geojson/buildings.geojson.
//
// One HTTP request. The site's own alcohol-type breakdown (Sprit/Vin/
// Starköl/AJA/ALP) collapses to a single boolean here, because that's all
// the app itself understands (see venueInfo() in src/app.js) — a permit of
// ANY type is treated as "serves alcohol".
//
// Deliberately does NOT write into tagging-list.json or touch the taggning
// UI yet — that's a follow-up once these match numbers are in. This script
// only produces the raw matched data.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as cheerio from "cheerio";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, "..", "data");

const LIST_URL = "https://restaurang.malmo.se/AlktWebbforms/Restaurants";
const USER_AGENT = "uteservering-sol data sync (github.com/FredAspBA/uteservering-sol)";

// ---------- normalization for matching ----------

// Legal-form suffixes and generic words that make two names for the same
// place fail an exact-string match ("Hygge Mat & Bar AB" vs "Hygge Mat &
// Bar"). Kept short and specific rather than a broad stopword list — the
// goal is removing noise, not merging genuinely different names.
const NAME_NOISE = /\b(ab|hb|kb|ek\.?\s*för(ening)?|enskild firma|restaurang|restaurant)\b/g;

function normalizeName(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[.,''"&-]/g, " ")
    .replace(NAME_NOISE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Strips a trailing house number (with optional letter suffix or a range
// like "25 - 27") so "Södra Förstadsgatan 25 - 27" and "Södra
// Förstadsgatan 27" both normalize to the same street, tolerating the two
// sources formatting house numbers differently.
function normalizeStreet(s) {
  return (s || "")
    .toLowerCase()
    .replace(/\s+\d+\s*[a-z]?\s*(-\s*\d+\s*[a-z]?)?\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------- OSM side (data/terraces.geojson) ----------

// Same three-state model as src/app.js's venueInfo() / scripts/build-
// tagging-list.js's osmAlcohol() — duplicated on purpose (small, and
// keeping a shared import isn't worth it for four lines used by three
// independent scripts; see PLAN-datakvalitet.md fas 3 for why this
// project prefers documented duplication over premature shared modules
// for pieces this small).
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

async function loadOsmTerraces() {
  const geo = JSON.parse(await readFile(join(dataDir, "terraces.geojson"), "utf8"));
  return geo.features
    .map((f) => {
      const id = f.id || f.properties?.id;
      if (!id) return null;
      const p = f.properties || {};
      const key = p.amenity || p.shop || p.leisure || "";
      const addr = tagAddress(p);
      return {
        id,
        name: p.name || "",
        addr,
        normName: normalizeName(p.name),
        normStreet: normalizeStreet(addr),
        alcohol: osmAlcohol(p, key),
      };
    })
    .filter((it) => it && it.name);
}

// ---------- register side (the live HTML) ----------

async function fetchListPage() {
  const res = await fetch(LIST_URL, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Malmö stad list page: HTTP ${res.status}`);
  return res.text();
}

function parseListPage(html) {
  const $ = cheerio.load(html);
  const rows = [];
  $("tbody tr").each((_, tr) => {
    const tds = $(tr).find("td");
    if (tds.length < 8) return; // defensive: skip anything that isn't a real data row
    const nameCell = $(tds[0]);
    const href = nameCell.find("a").attr("href") || "";
    const idMatch = href.match(/\/Show\/(\d+)/);
    const hasCheck = (td) => $(td).find("svg.octicon-check").length > 0;
    rows.push({
      registerId: idMatch ? idMatch[1] : null,
      name: nameCell.text().trim(),
      address: $(tds[1]).text().trim(),
      sprit: hasCheck(tds[2]),
      vin: hasCheck(tds[3]),
      starkol: hasCheck(tds[4]),
      aja: hasCheck(tds[5]),
      alp: hasCheck(tds[6]),
      servingTimes: $(tds[7])
        .text()
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    });
  });
  return rows;
}

// ---------- matching ----------

function matchAgainstOsm(registerRows, osmTerraces) {
  // Index OSM terraces by (normName, normStreet) so a lookup is O(1) per
  // register row instead of O(register x osm).
  const byNameAndStreet = new Map();
  const byNameOnly = new Map(); // for the weak fallback when OSM has no addr:street
  const addTo = (map, key, value) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(value);
  };
  for (const t of osmTerraces) {
    if (!t.normName) continue;
    if (t.normStreet) addTo(byNameAndStreet, `${t.normName}|${t.normStreet}`, t);
    else addTo(byNameOnly, t.normName, t);
  }

  return registerRows.map((row) => {
    const hasAlcoholPermit = row.sprit || row.vin || row.starkol || row.aja || row.alp;
    const normName = normalizeName(row.name);
    const normStreet = normalizeStreet(row.address);

    let match = null;
    let matchConfidence = null;

    const strongCandidates = byNameAndStreet.get(`${normName}|${normStreet}`) || [];
    if (strongCandidates.length === 1) {
      match = strongCandidates[0];
      matchConfidence = "strong"; // name AND street both matched, unambiguously
    } else if (strongCandidates.length === 0) {
      const weakCandidates = byNameOnly.get(normName) || [];
      if (weakCandidates.length === 1) {
        match = weakCandidates[0];
        matchConfidence = "weak"; // name matched, but OSM has no addr:street to confirm against
      }
    }
    // strongCandidates.length > 1 (two OSM terraces, same name+street) or
    // weakCandidates.length > 1 (name-only match is ambiguous) both fall
    // through as unmatched rather than guessing wrong — exactly the
    // "write uncertain matches to a review list instead of guessing"
    // rule from PLAN-datakvalitet.md fas 5.

    return {
      ...row,
      hasAlcoholPermit,
      matchedOsmId: match ? match.id : null,
      matchConfidence,
      // Only meaningful when matched: was this OSM place's alcohol status
      // actually unknown before the register resolved it? That's the
      // number that says how much this run is actually worth.
      resolvesUnknownAlcohol: Boolean(match && match.alcohol === "unknown" && hasAlcoholPermit),
    };
  });
}

// ---------- main ----------

async function main() {
  console.log(`Hämtar ${LIST_URL} ...`);
  const html = await fetchListPage();
  const registerRows = parseListPage(html);
  console.log(`${registerRows.length} tillståndshavare i registret.`);

  const osmTerraces = await loadOsmTerraces();
  const matched = matchAgainstOsm(registerRows, osmTerraces);

  await writeFile(join(dataDir, "serving-permits.json"), JSON.stringify(matched, null, 2) + "\n");

  const strong = matched.filter((r) => r.matchConfidence === "strong").length;
  const weak = matched.filter((r) => r.matchConfidence === "weak").length;
  const unmatched = matched.length - strong - weak;
  const resolves = matched.filter((r) => r.resolvesUnknownAlcohol).length;

  console.log(`\nMatchning mot data/terraces.geojson (${osmTerraces.length} OSM-ställen):`);
  console.log(`  ${strong} starka matchningar (namn + gata)`);
  console.log(`  ${weak} svaga matchningar (bara namn, OSM saknar addr:street)`);
  console.log(`  ${unmatched} omatchade (finns i registret, ingen säker OSM-motsvarighet)`);
  console.log(`\n${resolves} av matchningarna löser ett tidigare alcohol=unknown OSM-ställe till alkohol: ja.`);
  console.log(`\nSkrev data/serving-permits.json (${matched.length} rader).`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
