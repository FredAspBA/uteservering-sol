// Loads the pre-fetched local GeoJSON files and does the one-time
// preprocessing (building buffers/bboxes/heights, terrace representative
// points, home-building lookup) so that per-recompute work in app.js is cheap.

import { prepareBuildings, findHomeBuilding } from "./shadow.js";

/**
 * @returns {Promise<{ terraces: Array, buildings: {list: Array, grid: Map} }>}
 *   terraces: [{ id, name, point (turf Point feature), homeBuilding }]
 *   buildings: output of prepareBuildings() (a spatial-grid-indexed building list)
 */
export async function loadData() {
  const [terracesGeojson, buildingsGeojson] = await Promise.all([
    fetch("data/terraces.geojson").then((r) => {
      if (!r.ok) throw new Error(`Kunde inte hämta terraces.geojson: ${r.status}`);
      return r.json();
    }),
    fetch("data/buildings.geojson").then((r) => {
      if (!r.ok) throw new Error(`Kunde inte hämta buildings.geojson: ${r.status}`);
      return r.json();
    }),
  ]);

  const buildings = prepareBuildings(buildingsGeojson);

  const terraces = terracesGeojson.features
    .map((feature) => {
      const point = toRepresentativePoint(feature);
      if (!point) return null;
      const name =
        feature.properties?.name ||
        feature.properties?.["addr:street"] ||
        "Namnlös uteservering";
      const id = feature.id ?? feature.properties?.id ?? name;
      const homeBuilding = findHomeBuilding(point, buildings);
      return { id, name, point, feature, homeBuilding };
    })
    .filter(Boolean);

  return { terraces, buildings };
}

function toRepresentativePoint(feature) {
  if (!feature.geometry) return null;
  if (feature.geometry.type === "Point") {
    return turf.point(feature.geometry.coordinates, feature.properties);
  }
  try {
    return turf.centroid(feature, { properties: feature.properties });
  } catch {
    return null;
  }
}
