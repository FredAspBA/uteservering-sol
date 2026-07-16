// Core geometric shadow-casting logic. See PLAN section "Core algorithm"
// for the reasoning behind these choices (500m max ray, 0.5m footprint
// buffer, 3-tier height fallback, home-building exclusion, etc).

const MAX_RAY_METERS = 500;
const FOOTPRINT_BUFFER_METERS = 0.5;
const HOME_BUILDING_THRESHOLD_METERS = 3;
const DEFAULT_BUILDING_HEIGHT_METERS = 15;
const METERS_PER_LEVEL = 3.0;

// Spatial grid cell size, in degrees (~500-550m at Malmo's latitude).
// Chosen to match MAX_RAY_METERS so a single query rarely needs more than
// a handful of cells. Without this grid, checking every terrace against
// every building linearly (thousands of buildings once the covered area
// grew past central Malmo) took multiple seconds per recompute — far too
// slow for a live time slider.
const GRID_CELL_DEG = 0.005;

function resolveBuildingHeight(properties) {
  if (properties?.height) {
    const parsed = parseFloat(String(properties.height).replace(/[^\d.]/g, ""));
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  const levels = properties?.["building:levels"];
  if (levels) {
    const parsedLevels = parseFloat(levels);
    if (!Number.isNaN(parsedLevels) && parsedLevels > 0) {
      return parsedLevels * METERS_PER_LEVEL;
    }
  }
  return DEFAULT_BUILDING_HEIGHT_METERS;
}

function bboxesOverlap(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function cellRange(bbox) {
  const [minX, minY, maxX, maxY] = bbox;
  return {
    colMin: Math.floor(minX / GRID_CELL_DEG),
    colMax: Math.floor(maxX / GRID_CELL_DEG),
    rowMin: Math.floor(minY / GRID_CELL_DEG),
    rowMax: Math.floor(maxY / GRID_CELL_DEG),
  };
}

function buildGrid(list) {
  const grid = new Map();
  list.forEach((building, index) => {
    const { colMin, colMax, rowMin, rowMax } = cellRange(building.bbox);
    for (let c = colMin; c <= colMax; c++) {
      for (let r = rowMin; r <= rowMax; r++) {
        const key = `${c},${r}`;
        let bucket = grid.get(key);
        if (!bucket) grid.set(key, (bucket = []));
        bucket.push(index);
      }
    }
  });
  return grid;
}

/**
 * Returns buildings whose bbox overlaps the query bbox, using the grid to
 * avoid scanning the full building list. May include a few extra buildings
 * from coarse cell overlap — callers that need exact overlap should still
 * bbox-check the returned candidates (cheap, since the candidate set is
 * now small).
 */
function queryNearby(index, bbox) {
  const { colMin, colMax, rowMin, rowMax } = cellRange(bbox);
  const seen = new Set();
  const result = [];
  for (let c = colMin; c <= colMax; c++) {
    for (let r = rowMin; r <= rowMax; r++) {
      const bucket = index.grid.get(`${c},${r}`);
      if (!bucket) continue;
      for (const i of bucket) {
        if (!seen.has(i)) {
          seen.add(i);
          result.push(index.list[i]);
        }
      }
    }
  }
  return result;
}

/**
 * Precomputes buffered polygons, bboxes, resolved heights and a spatial
 * grid index for every building feature. Call this once after loading
 * buildings.geojson.
 */
export function prepareBuildings(buildingsGeojson) {
  const list = [];
  for (const feature of buildingsGeojson.features) {
    if (!feature.geometry) continue;
    try {
      const buffered = turf.buffer(feature, FOOTPRINT_BUFFER_METERS, {
        units: "meters",
      });
      if (!buffered) continue;
      list.push({
        feature,
        buffered,
        bbox: turf.bbox(buffered),
        height: resolveBuildingHeight(feature.properties),
        name:
          feature.properties?.name ||
          feature.properties?.["addr:street"] ||
          "okänd byggnad",
      });
    } catch {
      // Skip malformed geometries (rare in OSM extracts) rather than crash the app.
    }
  }
  return { list, grid: buildGrid(list) };
}

/**
 * Distance from a point to a polygon's boundary, in meters. Handles
 * MultiPolygon buildings (common for complex/courtyard footprints), whose
 * boundary is a MultiLineString — turf.pointToLineDistance only accepts a
 * plain LineString, so each ring is measured separately and the minimum
 * is taken.
 */
function distanceToBoundary(point, polygon) {
  const boundary = turf.polygonToLine(polygon);
  const lines =
    boundary.type === "FeatureCollection" ? boundary.features : [boundary];
  let min = Infinity;
  for (const line of lines) {
    const rings =
      line.geometry.type === "MultiLineString"
        ? line.geometry.coordinates.map((coords) => turf.lineString(coords))
        : [line];
    for (const ring of rings) {
      const d = turf.pointToLineDistance(point, ring, { units: "meters" });
      if (d < min) min = d;
    }
  }
  return min;
}

/**
 * Finds the building the terrace is directly attached to (if any), so it
 * can be excluded from candidate blockers (a terrace shouldn't be "shaded"
 * by its own wall when the sun happens to be behind it).
 *
 * This depends only on geometry (not time), so callers should compute it
 * once per terrace at load time and pass the result into computeShading()
 * on every recompute, rather than re-scanning all buildings per call.
 *
 * @param {GeoJSON.Point} terracePoint
 * @param {{list: Array, grid: Map}} buildingIndex - output of prepareBuildings()
 */
export function findHomeBuilding(terracePoint, buildingIndex) {
  const searchBbox = turf.bbox(
    turf.buffer(terracePoint, HOME_BUILDING_THRESHOLD_METERS + 5, { units: "meters" })
  );
  const candidates = queryNearby(buildingIndex, searchBbox);

  let closest = null;
  let closestDist = Infinity;
  for (const b of candidates) {
    if (!bboxesOverlap(searchBbox, b.bbox)) continue;
    // A point strictly inside a building's footprint is distance 0 from it
    // (distanceToBoundary would otherwise measure to the nearest edge,
    // which can exceed the threshold even though the point is enclosed).
    const dist = turf.booleanPointInPolygon(terracePoint, b.buffered)
      ? 0
      : distanceToBoundary(terracePoint, b.buffered);
    if (dist < closestDist) {
      closestDist = dist;
      closest = b;
    }
  }
  return closestDist <= HOME_BUILDING_THRESHOLD_METERS ? closest : null;
}

/**
 * @param {GeoJSON.Point} terracePoint - turf point feature for the terrace
 * @param {{list: Array, grid: Map}} buildingIndex - output of prepareBuildings()
 * @param {{altitudeDeg: number, bearingDeg: number}} sunInfo
 * @param {object|null} homeBuilding - precomputed via findHomeBuilding(), or null
 * @returns {{ status: 'night'|'sun'|'shade'|'anomaly', blocker: object|null, sunInfo: object }}
 */
export function computeShading(terracePoint, buildingIndex, sunInfo, homeBuilding = null) {
  if (sunInfo.altitudeDeg <= 0) {
    return { status: "night", blocker: null, sunInfo };
  }

  const pointBbox = turf.bbox(turf.buffer(terracePoint, 1, { units: "meters" }));
  for (const b of queryNearby(buildingIndex, pointBbox)) {
    if (b === homeBuilding) continue;
    if (turf.booleanPointInPolygon(terracePoint, b.buffered)) {
      return { status: "anomaly", blocker: b, sunInfo };
    }
  }

  const rayEnd = turf.destination(terracePoint, MAX_RAY_METERS, sunInfo.bearingDeg, {
    units: "meters",
  });
  const ray = turf.lineString([
    terracePoint.geometry.coordinates,
    rayEnd.geometry.coordinates,
  ]);
  const rayBbox = turf.bbox(ray);

  const altitudeRad = (sunInfo.altitudeDeg * Math.PI) / 180;
  let closestBlocker = null;
  let closestDist = Infinity;

  for (const b of queryNearby(buildingIndex, rayBbox)) {
    if (b === homeBuilding) continue;
    if (!bboxesOverlap(rayBbox, b.bbox)) continue;

    let intersections;
    try {
      intersections = turf.lineIntersect(ray, b.buffered);
    } catch {
      continue;
    }
    if (!intersections.features.length) continue;

    let dMin = Infinity;
    for (const ip of intersections.features) {
      const d = turf.distance(terracePoint, ip, { units: "meters" });
      if (d < dMin) dMin = d;
    }
    if (dMin === 0) continue; // avoid div-by-zero / self-touching edge noise

    const requiredHeight = dMin * Math.tan(altitudeRad);
    if (b.height >= requiredHeight && dMin < closestDist) {
      closestDist = dMin;
      closestBlocker = {
        name: b.name,
        distanceMeters: dMin,
        requiredHeightMeters: requiredHeight,
        actualHeightMeters: b.height,
      };
    }
  }

  if (closestBlocker) {
    return { status: "shade", blocker: closestBlocker, sunInfo };
  }
  return { status: "sun", blocker: null, sunInfo };
}
