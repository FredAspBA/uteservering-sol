// ±20% sanity gate, run in the Actions workflow between fetching new data
// and committing it (PLAN-datakvalitet.md, fas 3, "tyst sönderkörning").
//
// scripts/fetch-data-geofabrik.js never overwrites data/*.geojson directly
// — it writes data/terraces.geojson.new and data/buildings.geojson.new
// alongside the untouched originals. This script compares feature counts
// between each old/new pair and exits non-zero (failing the whole job,
// before anything is committed) if either count moved by more than the
// threshold in either direction. A silently broken filter — an empty
// result, or a bbox typo that only catches a corner of Malmo — produces a
// wildly different count and gets caught here instead of reaching the live
// app. The .new files are left in place on failure so the workflow logs
// (and a human, if needed) can inspect exactly what was fetched.
//
// A real, deliberate change that legitimately moves the count by more than
// 20% (e.g. widening SEARCH_BBOX on purpose) is expected to fail this gate
// too — that's fine. It's meant to require a human to raise the threshold
// or update the baseline consciously, not to be silently absorbed.

import { readFile } from "node:fs/promises";

const DRIFT_THRESHOLD = 0.2; // ±20%, per the plan

// [old committed file, newly fetched candidate file, human label]
const CHECKS = [
  ["data/terraces.geojson", "data/terraces.geojson.new", "terrasser"],
  ["data/buildings.geojson", "data/buildings.geojson.new", "byggnader"],
];

async function featureCount(path) {
  const raw = await readFile(path, "utf8");
  const geo = JSON.parse(raw);
  if (!Array.isArray(geo.features)) {
    throw new Error(`${path}: saknar en "features"-array — inte en giltig FeatureCollection`);
  }
  return geo.features.length;
}

async function main() {
  let failed = false;

  for (const [oldPath, newPath, label] of CHECKS) {
    const oldCount = await featureCount(oldPath);
    const newCount = await featureCount(newPath);
    const relativeChange = oldCount === 0 ? Infinity : (newCount - oldCount) / oldCount;
    const pct = (relativeChange * 100).toFixed(1);
    const withinBounds = Math.abs(relativeChange) <= DRIFT_THRESHOLD;

    console.log(
      `${label}: ${oldCount} -> ${newCount} (${relativeChange >= 0 ? "+" : ""}${pct}%) ${
        withinBounds ? "OK" : "AVVIKER FÖR MYCKET"
      }`
    );

    if (!withinBounds) failed = true;
  }

  if (failed) {
    console.error(
      `\nEn eller flera filer avviker mer än ±${(DRIFT_THRESHOLD * 100).toFixed(
        0
      )}% från det som redan ligger i repot. Avbryter innan commit — de nya ` +
        `.new-filerna lämnas kvar i data/ för felsökning i körloggen, men ` +
        `skrivs INTE över data/*.geojson. Om ändringen är avsiktlig (t.ex. en ` +
        `medvetet utökad bbox), höj DRIFT_THRESHOLD eller committa manuellt.`
    );
    process.exit(1);
  }

  console.log("\nBåda filerna inom ±20% — OK att gå vidare.");
}

main().catch((err) => {
  console.error("check-data-drift misslyckades:", err.message);
  process.exit(1);
});
