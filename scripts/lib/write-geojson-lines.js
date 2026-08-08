// Writes a GeoJSON FeatureCollection with exactly one feature per output
// line, instead of a single-line JSON.stringify() blob (osmtogeojson's
// default) or a deeply pretty-printed multi-line-per-feature format
// (JSON.stringify(x, null, 2)).
//
// Why this matters (see PLAN-datakvalitet.md, fas 3, "repo-uppsvällning"):
// data/buildings.geojson is ~9 MB. Written as one line, a single changed
// building rewrites the entire line, so git can't delta-compress against
// the previous version — every scheduled run would add a full new ~9 MB
// blob to .git forever. Written with deeply nested pretty-printing, a
// change to one feature can shift indentation/brackets on neighbouring
// lines too. One feature per line means "feature N changed" is "line N
// changed" — a change to 50 of 23,000 buildings is a ~50-line diff, and
// git's delta compression sees mostly-unchanged content and stores the
// difference, not a whole new copy.
//
// The output is still a single valid JSON document — a JSON parser
// doesn't care about whitespace between array elements — so
// dataLoad.js's plain fetch(...).then(r => r.json()) keeps working
// unmodified.

/**
 * @param {{type: string, features: Array, [key: string]: any}} collection
 * @param {(a: object, b: object) => number} compareFeatures - sort
 *   comparator applied before writing, so re-runs of the same input
 *   produce byte-identical output regardless of upstream ordering
 *   (osmium/Overpass don't guarantee a stable order). Deterministic order
 *   is what makes the "one line per feature" diff property actually hold —
 *   without it, an unrelated reordering would touch every line.
 * @returns {string} the full file contents to write
 */
export function geojsonLinesString(collection, compareFeatures) {
  const { type, features, ...rest } = collection;
  const sorted = [...features].sort(compareFeatures);

  const headerParts = [`"type":${JSON.stringify(type)}`];
  for (const [key, value] of Object.entries(rest)) {
    headerParts.push(`${JSON.stringify(key)}:${JSON.stringify(value)}`);
  }
  headerParts.push(`"features":[`);

  const lines = [`{${headerParts.join(",")}`];
  sorted.forEach((feature, i) => {
    const suffix = i < sorted.length - 1 ? "," : "";
    lines.push(JSON.stringify(feature) + suffix);
  });
  lines.push("]}");

  return lines.join("\n") + "\n";
}

/**
 * Comparator for OSM-sourced features: sorts by the numeric id portion of
 * an `osmType/osmId` string id (e.g. "way/12345"), falling back to a plain
 * string compare for anything that doesn't match that shape. Numeric (not
 * lexicographic) so "way/9" sorts before "way/10" — lexicographic would
 * put "way/10" first and make the order harder to reason about, though
 * either is equally stable for the diff property above.
 */
export function compareByOsmId(a, b) {
  const idA = String(a.id ?? "");
  const idB = String(b.id ?? "");
  const numA = Number(idA.split("/")[1]);
  const numB = Number(idB.split("/")[1]);
  if (!Number.isNaN(numA) && !Number.isNaN(numB)) return numA - numB;
  return idA.localeCompare(idB);
}
