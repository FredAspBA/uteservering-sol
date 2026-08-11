// Fetches Malmö stad's detail page (`/Show/{id}`) for each serving-permit
// register entry that did NOT match anything in data/terraces.geojson —
// the fas 5 del B candidates. The list page alone (fetch-serving-
// permits.js) can't tell us which of those 353 unmatched places actually
// have an outdoor-seating permit; only the detail page's "Serveringstyp:
// Uteservering" row does. Also grabs "Servering till: Allmänheten" (vs.
// Slutet sällskap), since a permit that only covers closed events
// shouldn't count either — see PLAN-datakvalitet.md fas 5 for why both
// gates matter.
//
// One request per unmatched place *not already cached*, with a delay
// between them to be polite to a small municipal server. Writes
// data/serving-permit-details.json; never touches terraces.geojson/
// buildings.geojson. Data-gathering only — this does NOT build fas 5 del B
// (geocoding, map display, UI). That's a separate, larger piece of work.
//
// Cached by registerId in data/serving-permit-details-cache.json (same
// permanent-cache pattern as geocode-cache.json / geocode-forward-cache.json
// elsewhere in this project) — added when this script moved from a one-off
// manual run to a monthly automated one (refresh-data.yml): re-fetching up
// to ~350 detail pages every month for entries whose status essentially
// never changes would be needless load on a small municipal server. A
// registerId's uteservering/allmänhet flags are treated as effectively
// permanent once seen (same trust level as a street address never moving);
// if Malmö stad ever actually changes an existing permit's serving type,
// delete the cache file to force a full re-fetch, same as the other caches.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as cheerio from "cheerio";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, "..", "data");
const cachePath = join(dataDir, "serving-permit-details-cache.json");

const USER_AGENT = "uteservering-sol data sync (github.com/FredAspBA/uteservering-sol)";
const DELAY_MS = 300;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadCache() {
  try {
    return JSON.parse(await readFile(cachePath, "utf8"));
  } catch {
    return {};
  }
}

// Finds the <tr> whose first <td> has exactly this text, and returns
// whether its sibling <td> contains a checkmark icon. Both "Serveringstyp"
// and "Servering till" tables on the detail page share this exact shape.
function rowIsChecked($, label) {
  let found = false;
  $("tr").each((_, tr) => {
    const tds = $(tr).find("td");
    if (tds.length < 2) return;
    if ($(tds[0]).text().trim() === label) {
      found = $(tds[1]).find("svg.octicon-check").length > 0;
      return false; // stop .each
    }
  });
  return found;
}

async function fetchDetail(registerId) {
  const url = `https://restaurang.malmo.se/AlktWebbforms/Restaurants/Show/${registerId}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const $ = cheerio.load(await res.text());
  return {
    uteservering: rowIsChecked($, "Uteservering"),
    allmanheten: rowIsChecked($, "Allmänheten"),
  };
}

async function main() {
  const permits = JSON.parse(await readFile(join(dataDir, "serving-permits.json"), "utf8"));
  const candidates = permits.filter((r) => !r.matchedOsmId && r.registerId);
  console.log(`${candidates.length} omatchade registerställen att kontrollera ...`);

  const cache = await loadCache();
  const results = [];
  let errors = 0;
  let fromCache = 0;
  let fetched = 0;
  for (const [i, row] of candidates.entries()) {
    let detail = cache[row.registerId];
    if (detail) {
      fromCache++;
    } else {
      try {
        detail = await fetchDetail(row.registerId);
        cache[row.registerId] = detail;
        fetched++;
      } catch (err) {
        errors++;
        console.error(`  fel för ${row.name} (${row.registerId}): ${err.message}`);
      }
      await sleep(DELAY_MS); // only pace real requests, not cache hits
    }
    if (detail) results.push({ registerId: row.registerId, name: row.name, address: row.address, ...detail });
    if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${candidates.length} ...`);
  }

  if (fetched) await writeFile(cachePath, JSON.stringify(cache, null, 2) + "\n");
  await writeFile(join(dataDir, "serving-permit-details.json"), JSON.stringify(results, null, 2) + "\n");

  const withOutdoor = results.filter((r) => r.uteservering);
  const withOutdoorAndPublic = withOutdoor.filter((r) => r.allmanheten);
  console.log(`\n${results.length} detaljsidor tillgängliga (${fromCache} från cache, ${fetched} nya, ${errors} fel).`);
  console.log(`${withOutdoor.length} har "Serveringstyp: Uteservering".`);
  console.log(`${withOutdoorAndPublic.length} av dem serverar även till Allmänheten (inte bara Slutet sällskap).`);
  console.log(`\nSkrev data/serving-permit-details.json.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
