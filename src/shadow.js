// Core geometric shadow-casting logic. See PLAN section "Core algorithm"
// for the reasoning behind these choices (500m max ray, 0.5m footprint
// buffer, 3-tier height fallback, home-building exclusion, etc).
//
// Note: building geometry arrives from data/buildings.geojson ALREADY
// buffered by ~0.5m (see FOOTPRINT_BUFFER_METERS in scripts/fetch-data.js)
// — turf.buffer() on every building used to run lazily in the browser on
// first use, but once the terrace count grew past a few hundred, that
// still added up to a real 60-90s freeze on first load. Buffering is a
// pure function of the building's own geometry, so it's cheap to do once
// on this machine when the data is (re)generated instead, in scripts/
// fetch-data.js, and ship the already-buffered footprint. If the data was
// generated before that change, buildings will just be unbuffered by
// exactly this same small margin — harmless for a coarse shadow raycast.

const MAX_RAY_METERS = 500;
const HOME_BUILDING_THRESHOLD_METERS = 3;
const DEFAULT_BUILDING_HEIGHT_METERS = 15;
const METERS_PER_LEVEL = 3.0;

// Spatial grid cell size, in degrees (~100-110m at Malmo's latitude).
// A ray query is a *thin* 500m line, not a 500m x 500m area, so its
// bounding box is mostly empty space — with the original 500m cells
// (matched 1:1 to MAX_RAY_METERS) a single dense downtown cell held up to
// ~485 buildings, nearly all of them nowhere near the actual ray, and
// every one of them still had to be checked. Smaller cells mean a query
// touches more cells (up to ~10-25 instead of ~4), but each one holds far
// fewer buildings (measured ~75 average / ~485 max at 500m cells, vs a
// small fraction of that at this size) — the total candidate count per
// query drops substantially since the ray only ever crosses a narrow
// strip of these smaller cells. This is what took ~900 terraces from a
// ~60s load down to a few seconds.
const GRID_CELL_DEG = 0.001;

function resolveBuildingHeight(properties) {
  if (properties?.height) {
    // parseFloat naturally stops at the first non-numeric character, so it
    // degrades gracefully on odd tag formats (e.g. "12;15" from a disputed
    // OSM edit -> 12, or "12.5 m" -> 12.5). A previous version stripped all
    // non-digit/dot characters first, which mangled cases like "12;15" into
    // "1215" — a silently wrong height. Comma-decimals ("12,5") are
    // normalized to a dot first since parseFloat would otherwise stop at
    // the comma and lose the fraction.
    const parsed = parseFloat(String(properties.height).trim().replace(",", "."));
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

/** Expands a [minX, minY, maxX, maxY] bbox by `meters` in every direction,
 * without any turf call — plain arithmetic, so it's cheap enough to run
 * for every one of the ~20k buildings during indexing. */
function padBboxMeters([minX, minY, maxX, maxY], meters) {
  const midLatRad = (((minY + maxY) / 2) * Math.PI) / 180;
  const dLon = meters / (111320 * Math.cos(midLatRad));
  const dLat = meters / 110540;
  return [minX - dLon, minY - dLat, maxX + dLon, maxY + dLat];
}

/** Same idea as padBboxMeters, but starting from a single point rather
 * than an existing bbox — used in place of turf.buffer()+turf.bbox() for
 * the small search boxes around a terrace point. Those used to go
 * through turf's circle-polygon buffer just to get a bounding box out of
 * it, which is real (if small) overhead multiplied by every terrace on
 * every recompute — plain arithmetic is equivalent here and effectively free. */
function pointBboxMeters(point, meters) {
  const [lon, lat] = point.geometry.coordinates;
  return padBboxMeters([lon, lat, lon, lat], meters);
}

/** Converts a lon/lat into meters offset from an origin lon/lat, using a
 * flat local projection (fine over the ~500m distances this is used for).
 * Lets the ray-vs-building distance check below use plain Euclidean math
 * instead of a turf call. For one-off conversions (e.g. once per building
 * while indexing); see makeLocalProjector() for the hot-loop version. */
function toLocalMeters(lon, lat, originLon, originLat) {
  const midLatRad = (originLat * Math.PI) / 180;
  return [(lon - originLon) * 111320 * Math.cos(midLatRad), (lat - originLat) * 110540];
}

/** Same projection as toLocalMeters, but hoists the Math.cos() call out of
 * the loop: computeShading() calls this once per terrace, then reuses the
 * returned function for every one of the (possibly hundreds of) candidate
 * buildings checked against that terrace's ray — recomputing cos() that
 * many times per terrace across ~900 terraces was a real, avoidable cost. */
function makeLocalProjector(originLon, originLat) {
  const midLatRad = (originLat * Math.PI) / 180;
  const lonScale = 111320 * Math.cos(midLatRad);
  const latScale = 110540;
  return (lon, lat) => [(lon - originLon) * lonScale, (lat - originLat) * latScale];
}

/** Shortest distance from point (px,py) to the segment (ax,ay)-(bx,by), in
 * whatever linear unit the inputs are in (meters here). */
function pointToSegmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  let t = lengthSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
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
 * Indexes every building (whose geometry already arrived pre-buffered, see
 * the note above) by bbox and a spatial grid, so a query only needs to
 * check the handful of buildings actually near it instead of scanning the
 * full list.
 */
export function prepareBuildings(buildingsGeojson) {
  const list = [];
  for (const feature of buildingsGeojson.features) {
    if (!feature.geometry) continue;
    let bbox;
    try {
      bbox = padBboxMeters(turf.bbox(feature), 1); // small safety margin for float/rounding noise
    } catch {
      continue; // malformed geometry (rare in OSM extracts) — skip rather than crash
    }
    // Bbox center + "radius" (half the bbox diagonal, in meters), used as a
    // cheap circle approximation of the building for the ray pre-filter in
    // computeShading() — see the comment there for why this matters.
    const centerLon = (bbox[0] + bbox[2]) / 2;
    const centerLat = (bbox[1] + bbox[3]) / 2;
    const [halfWidthM, halfHeightM] = toLocalMeters(bbox[2], bbox[3], centerLon, centerLat);
    const radiusMeters = Math.hypot(halfWidthM, halfHeightM);
    list.push({
      feature,
      bbox,
      centerLon,
      centerLat,
      radiusMeters,
      height: resolveBuildingHeight(feature.properties),
      name:
        feature.properties?.name ||
        feature.properties?.["addr:street"] ||
        "okänd byggnad",
    });
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
  const searchBbox = pointBboxMeters(terracePoint, HOME_BUILDING_THRESHOLD_METERS + 5);
  const candidates = queryNearby(buildingIndex, searchBbox);

  let closest = null;
  let closestDist = Infinity;
  for (const b of candidates) {
    if (!bboxesOverlap(searchBbox, b.bbox)) continue;
    // A point strictly inside a building's footprint is distance 0 from it
    // (distanceToBoundary would otherwise measure to the nearest edge,
    // which can exceed the threshold even though the point is enclosed).
    const dist = turf.booleanPointInPolygon(terracePoint, b.feature)
      ? 0
      : distanceToBoundary(terracePoint, b.feature);
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

  const pointBbox = pointBboxMeters(terracePoint, 1);
  for (const b of queryNearby(buildingIndex, pointBbox)) {
    if (b === homeBuilding) continue;
    if (!bboxesOverlap(pointBbox, b.bbox)) continue; // was missing — every building in the grid cell was getting a full point-in-polygon test
    if (turf.booleanPointInPolygon(terracePoint, b.feature)) {
      return { status: "anomaly", blocker: b, sunInfo };
    }
  }

  const [terraceLon, terraceLat] = terracePoint.geometry.coordinates;
  const rayEnd = turf.destination(terracePoint, MAX_RAY_METERS, sunInfo.bearingDeg, {
    units: "meters",
  });
  const ray = turf.lineString([
    terracePoint.geometry.coordinates,
    rayEnd.geometry.coordinates,
  ]);
  const rayBbox = turf.bbox(ray);
  // One projector per terrace (not per candidate building) — see
  // makeLocalProjector()'s doc comment for why that matters here.
  const project = makeLocalProjector(terraceLon, terraceLat);
  // Ray endpoint in local meters (terrace point is the origin, so it's
  // just (0,0)) — used by the cheap per-building distance pre-filter below.
  const [rayEndX, rayEndY] = project(rayEnd.geometry.coordinates[0], rayEnd.geometry.coordinates[1]);

  const altitudeRad = (sunInfo.altitudeDeg * Math.PI) / 180;
  let closestBlocker = null;
  let closestDist = Infinity;

  for (const b of queryNearby(buildingIndex, rayBbox)) {
    if (b === homeBuilding) continue;
    if (!bboxesOverlap(rayBbox, b.bbox)) continue;

    // The ray's bbox is a wide rectangle spanning start to end, which in a
    // dense block can contain 50-100+ buildings nowhere near the actual
    // thin ray line itself (e.g. sitting in a corner of that rectangle).
    // Approximating each building as a circle (its bbox center + half-
    // diagonal "radius") and checking distance to the ray segment first is
    // orders of magnitude cheaper than turf.lineIntersect, and only lets
    // through buildings that could plausibly actually be crossed by the
    // ray — this is what turned ~900 terraces from ~70s into a much
    // shorter load.
    const [bx, by] = project(b.centerLon, b.centerLat);
    if (pointToSegmentDistance(bx, by, 0, 0, rayEndX, rayEndY) > b.radiusMeters) continue;

    let intersections;
    try {
      intersections = turf.lineIntersect(ray, b.feature);
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
