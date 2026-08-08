// Shared building post-processing: which tags to keep, and the
// simplify+buffer treatment applied to every building's geometry.
//
// Used by BOTH data-fetch paths (scripts/fetch-data.js via Overpass, and
// scripts/fetch-data-geofabrik.js via Geofabrik+osmium) so the two can
// never quietly drift apart in what a "building" looks like once it lands
// in data/buildings.geojson. If this changes, both paths change with it.

import * as turf from "@turf/turf";

// Only these OSM tags are ever read by src/shadow.js (height resolution)
// or the popup UI (blocker name) — everything else (wikidata, source,
// ref:*, ...) is dead weight once shipped to the browser. Across ~20k
// buildings, dropping unused tags is most of the payload-size win.
//
// The roof:*/est_height/min_height group is kept because ~80% of Malmo's
// buildings carry no height or building:levels at all, so any additional
// real signal beats the estimated fallback in shadow.js. They cost very
// little: only a small minority of buildings have them tagged.
export const BUILDING_PROPS_TO_KEEP = [
  "height",
  "building:levels",
  "building",
  "name",
  "addr:street",
  "roof:levels",
  "roof:height",
  "roof:shape",
  "est_height",
  "min_height",
  "building:min_level",
];

// Douglas-Peucker tolerance in degrees (~0.9m at Malmo's latitude). Building
// footprints have far more vertices (bay windows, rounded corners) than the
// coarse shadow raycast needs; simplifying shrinks both file size and the
// per-building turf.lineIntersect() cost in the browser.
export const SIMPLIFY_TOLERANCE_DEG = 0.000008;

// Must match FOOTPRINT_BUFFER_METERS' consumer assumption in src/shadow.js
// (buildings arrive pre-buffered). Buffering here instead of there means the
// ~500-1000ms-per-building turf.buffer() cost runs once when the data is
// (re)generated, not in every visitor's browser on every first page load.
export const FOOTPRINT_BUFFER_METERS = 0.5;

/**
 * Strips a raw OSM building feature down to the tags shadow.js/the popup UI
 * actually use, and simplifies+buffers its geometry once so the browser
 * never has to. Returns null for geometry-less input (skip rather than crash
 * — rare in OSM extracts either way).
 */
export function slimBuilding(feature) {
  if (!feature.geometry) return null;
  const properties = {};
  for (const key of BUILDING_PROPS_TO_KEEP) {
    if (feature.properties?.[key] != null) properties[key] = feature.properties[key];
  }
  let geometry = feature.geometry;
  try {
    const simplified = turf.simplify(feature, {
      tolerance: SIMPLIFY_TOLERANCE_DEG,
      highQuality: false,
    });
    const buffered = turf.buffer(simplified, FOOTPRINT_BUFFER_METERS, { units: "meters" });
    // Buffering can add vertices back (rounding corners) — simplify once
    // more to keep the shipped file size/complexity down.
    geometry = turf.simplify(buffered, {
      tolerance: SIMPLIFY_TOLERANCE_DEG,
      highQuality: false,
    }).geometry;
  } catch {
    // Keep the original (unbuffered) geometry if buffer/simplify chokes on
    // unusual input (e.g. a degenerate ring) rather than dropping the
    // building. A very small number of buildings shipped unbuffered is a
    // negligible accuracy loss for the shadow raycast.
  }
  return { type: "Feature", id: feature.id, properties, geometry };
}
