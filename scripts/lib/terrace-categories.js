// Shared definition of "which OSM venues count as a terrace worth showing".
//
// scripts/fetch-data.js (Overpass) embeds these lists straight into a
// regex inside the Overpass QL query string — Overpass does the filtering
// server-side. scripts/fetch-data-geofabrik.js (osmium) can't express the
// same "amenity IN (...) AND outdoor_seating != no" combination in osmium's
// simpler tags-filter grammar, so it filters client-side in Node using
// isEligibleTerrace() below instead. Both paths MUST agree on the venue
// list, so it lives here once rather than in either script.

// amenity types that commonly have outdoor seating in Malmo: cafes,
// restaurants, bars/pubs, ice cream places ("glasstallen"), fast food
// (food trucks/kiosks with picnic tables), biergartens and food courts.
export const OUTDOOR_SEATING_AMENITIES = [
  "cafe",
  "restaurant",
  "bar",
  "pub",
  "ice_cream",
  "fast_food",
  "biergarten",
  "food_court",
];

// Bakeries/confectioners often have a couple of outdoor tables too
// ("Deg Bageri" was one of the specific places this was missing).
export const OUTDOOR_SEATING_SHOPS = ["bakery", "confectionery"];

/**
 * Checked against a spot-sample of central Malmo venues (591 total in that
 * area): only 139 are explicitly tagged outdoor_seating=yes/only, 34 are
 * explicitly "no", and the remaining 418 simply have no outdoor_seating tag
 * at all either way — untagged is the OSM norm here, not a signal that the
 * place lacks a terrace. Real, well-known spots (Surf Shack Beach Diner,
 * Hygge Mat & Bar, Deg Bageri) all fell in that untagged bucket and were
 * being silently dropped by requiring an explicit "yes". So: include every
 * venue of these types EXCEPT the ones explicitly marked "no" — respect a
 * clear negative signal, but don't require an explicit positive one that
 * most real terraces in this dataset simply never got tagged with.
 *
 * Mirrors the Overpass query's shape exactly: three independent OR'd
 * clauses, not one blanket "outdoor_seating != no" gate. Only the
 * amenity/shop clauses carry that condition — the original query's
 * leisure=outdoor_seating clause never did (that tag already *is* the
 * positive signal, an outdoor_seating=no alongside it would be self-
 * contradictory and doesn't occur in practice, but the point of this
 * function is to match the existing query byte-for-byte in behaviour, not
 * to "clean it up").
 *
 * @param {object} properties - an OSM feature's tag object
 * @returns {boolean}
 */
export function isEligibleTerrace(properties = {}) {
  const outdoorSeating = properties.outdoor_seating;
  if (OUTDOOR_SEATING_AMENITIES.includes(properties.amenity) && outdoorSeating !== "no") return true;
  if (OUTDOOR_SEATING_SHOPS.includes(properties.shop) && outdoorSeating !== "no") return true;
  if (properties.leisure === "outdoor_seating") return true;
  return false;
}
