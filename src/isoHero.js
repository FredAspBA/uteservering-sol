// Canvas isometric "hero" visualization for the MALMÖ URBAN GRID redesign
// (2026-08-15). Shows the real OSM buildings around the currently FOCUSED
// terrace (not all ~25 000 buildings — see RADIUS_M below), extruded by
// their real (measured-or-estimated, same as shadow.js) height, casting
// real geometric shadows from the exact sun altitude/bearing the rest of
// the page is using for that moment. This is the same physics
// computeShading() uses to decide sun/shade (shadow reach in meters =
// height / tan(altitude)) — just drawn, not only tested — so a card
// that says "Skuggas av X (42 m bort)" and this view should always agree
// on which building is casting the shadow that reaches the terrace. It is
// deliberately a small local scene, not a pannable replacement for the
// results list: the point is to make "stadsgeometri skapar skugga"
// legible for the one terrace in focus.

const RADIUS_M = 200; // how far out to gather real buildings for the scene
const MAX_BUILDINGS = 60; // dense city blocks can have more than this within RADIUS_M; nearest wins
const MAX_SHADOW_M = 260; // clamp low-sun shadows so a near-horizon moment doesn't blow the scene off-canvas
const PADDING_PX = 28;

/**
 * Same flat local-meters projection as shadow.js's toLocalMeters/
 * makeLocalProjector, reimplemented here rather than imported — shadow.js
 * doesn't export it, and it's a two-line formula, not worth widening that
 * module's public surface for.
 */
function makeLocalProjector(originLon, originLat) {
  const midLatRad = (originLat * Math.PI) / 180;
  const lonScale = 111320 * Math.cos(midLatRad);
  const latScale = 110540;
  return (lon, lat) => [(lon - originLon) * lonScale, (lat - originLat) * latScale];
}

/**
 * The outer ring of a building's footprint. For a MultiPolygon (rare —
 * disjoint or courtyard buildings), takes the ring with the most vertices
 * as a stand-in for "the main body" — a documented simplification in the
 * same spirit as prepareBuildings()'s height fallbacks: fine for a
 * legible illustration, not pretending to be a survey.
 */
function footprintOuterRing(feature) {
  const geom = feature.geometry;
  if (!geom) return null;
  if (geom.type === "Polygon") return geom.coordinates[0];
  if (geom.type === "MultiPolygon") {
    let best = null;
    for (const poly of geom.coordinates) {
      const ring = poly[0];
      if (!best || ring.length > best.length) best = ring;
    }
    return best;
  }
  return null;
}

/** Andrew's monotone chain convex hull. Used to turn "a footprint plus
 * that same footprint translated by the shadow vector" into one shadow
 * shape without a turf boolean-union call — buildings here are simple
 * (near-convex) OSM footprints, so the hull is visually equivalent to a
 * true extrusion and far cheaper, redone every recompute tick. */
function convexHull(points) {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

function pointInPolygon([px, py], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function depthOf(ring) {
  let sum = 0;
  for (const [mx, my] of ring) sum += mx + my;
  return sum / ring.length;
}

function resizeForDpr(canvas, ctx) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const targetW = Math.max(1, Math.round(w * dpr));
  const targetH = Math.max(1, Math.round(h * dpr));
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawPlaceholder(ctx, w, h, text) {
  ctx.fillStyle = "rgba(214, 214, 206, 0.55)";
  ctx.font = "13px 'IBM Plex Mono', ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, w / 2, h / 2);
}

function drawGroundRings(ctx, toScreen, radii) {
  ctx.save();
  ctx.setLineDash([2, 4]);
  ctx.strokeStyle = "rgba(212, 175, 55, 0.18)";
  ctx.lineWidth = 1;
  for (const r of radii) {
    ctx.beginPath();
    for (let i = 0; i <= 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      const p = toScreen(Math.cos(a) * r, Math.sin(a) * r, 0);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawGroundPoly(ctx, toScreen, ring) {
  ctx.beginPath();
  ring.forEach(([mx, my], i) => {
    const p = toScreen(mx, my, 0);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.closePath();
  ctx.fill();
}

function drawBuilding(ctx, toScreen, shape, highlighted) {
  const { ring, height } = shape;
  const n = ring.length;
  const wallFill = highlighted ? "rgba(212, 175, 55, 0.5)" : "rgba(214, 214, 206, 0.16)";
  const wallFillDark = highlighted ? "rgba(212, 175, 55, 0.3)" : "rgba(214, 214, 206, 0.08)";
  const wallStroke = highlighted ? "rgba(212, 175, 55, 0.9)" : "rgba(214, 214, 206, 0.28)";

  for (let i = 0; i < n - 1; i++) {
    const [mx1, my1] = ring[i];
    const [mx2, my2] = ring[i + 1];
    const b1 = toScreen(mx1, my1, 0);
    const b2 = toScreen(mx2, my2, 0);
    const t1 = toScreen(mx1, my1, height);
    const t2 = toScreen(mx2, my2, height);
    // Two-tone wall shading by edge direction (a stable graphic
    // convention, not a physical light model — see module comment).
    const light = mx2 - mx1 - (my2 - my1) >= 0;
    ctx.beginPath();
    ctx.moveTo(b1.x, b1.y);
    ctx.lineTo(b2.x, b2.y);
    ctx.lineTo(t2.x, t2.y);
    ctx.lineTo(t1.x, t1.y);
    ctx.closePath();
    ctx.fillStyle = light ? wallFill : wallFillDark;
    ctx.fill();
    ctx.strokeStyle = wallStroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.beginPath();
  ring.forEach(([mx, my], i) => {
    const p = toScreen(mx, my, height);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.closePath();
  ctx.fillStyle = highlighted ? "rgba(212, 175, 55, 0.7)" : "rgba(214, 214, 206, 0.38)";
  ctx.fill();
  ctx.strokeStyle = highlighted ? "#d4af37" : "rgba(214, 214, 206, 0.55)";
  ctx.lineWidth = highlighted ? 1.5 : 1;
  ctx.stroke();
}

function drawTerraceMarker(ctx, toScreen, statusColor) {
  const p = toScreen(0, 0, 0);
  ctx.beginPath();
  ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = statusColor || "#d4af37";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.beginPath();
  ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
  ctx.fillStyle = statusColor || "#d4af37";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#141414";
  ctx.stroke();
}

function drawCompass(ctx, w, sunInfo, isNight) {
  const cx = w - 34;
  const cy = 34;
  const r = 20;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(214, 214, 206, 0.35)";
  ctx.lineWidth = 1;
  ctx.stroke();
  if (isNight) return;
  const bearingRad = (sunInfo.bearingDeg * Math.PI) / 180;
  const ex = cx + Math.sin(bearingRad) * r * 0.85;
  const ey = cy - Math.cos(bearingRad) * r * 0.85;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(ex, ey);
  ctx.strokeStyle = "#d4af37";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(ex, ey, 3, 0, Math.PI * 2);
  ctx.fillStyle = "#d4af37";
  ctx.fill();
}

/**
 * @param {HTMLCanvasElement} canvas
 * @returns {{ setFocus: (terrace: object, buildingIndex: object) => void, render: (frame: { sunInfo: object, statusColor: string }) => void, hasScene: () => boolean }}
 */
export function createIsoHero(canvas) {
  const ctx = canvas.getContext("2d");
  let scene = null;

  /**
   * Gathers real buildings within RADIUS_M of `terrace`, in local meters
   * relative to it. Only called when the focused terrace changes (a card
   * click, or a new "closest" result) — NOT on every time-slider tick —
   * since the set of nearby buildings doesn't depend on the time, only
   * their shadow length/direction does (that's recomputed in render()).
   */
  function setFocus(terrace, buildingIndex) {
    const [lon, lat] = terrace.point.geometry.coordinates;
    const project = makeLocalProjector(lon, lat);
    const candidates = [];
    for (const b of buildingIndex.list) {
      const [bx, by] = project(b.centerLon, b.centerLat);
      const edgeDist = Math.hypot(bx, by) - b.radiusMeters;
      if (edgeDist > RADIUS_M) continue;
      const ring = footprintOuterRing(b.feature);
      if (!ring || ring.length < 3) continue;
      candidates.push({
        height: b.height,
        name: b.name,
        ring: ring.map(([flon, flat]) => project(flon, flat)),
        dist: Math.hypot(bx, by),
      });
    }
    candidates.sort((a, b) => a.dist - b.dist);
    scene = { terraceId: terrace.id, buildings: candidates.slice(0, MAX_BUILDINGS) };
  }

  function hasScene() {
    return scene !== null;
  }

  /**
   * Redrawn on every recompute() tick (cheap — at most MAX_BUILDINGS
   * shapes) with the CURRENT sun position for the focused terrace, so
   * dragging the time slider visibly rotates the sun-direction compass
   * and grows/shrinks every shadow in real time — the signature
   * interaction from the shaped contract.
   */
  function render({ sunInfo, statusColor }) {
    resizeForDpr(canvas, ctx);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);

    if (!scene) {
      drawPlaceholder(ctx, w, h, "Väljer en uteservering …");
      return;
    }
    if (!scene.buildings.length) {
      drawGroundRings(ctx, (mx, my, z) => ({ x: w / 2 + mx, y: h / 2 + my - z }), [50, 100, 150, 200]);
      drawTerraceMarker(ctx, (mx, my, z) => ({ x: w / 2 + mx, y: h / 2 + my - z }), statusColor);
      drawPlaceholder(ctx, w, h - 14, "Inga byggnader i kartdatan inom 200 m");
      return;
    }

    const isNight = sunInfo.altitudeDeg <= 0;
    const altRad = (Math.max(sunInfo.altitudeDeg, 0.5) * Math.PI) / 180;
    const dirRad = (((sunInfo.bearingDeg + 180) % 360) * Math.PI) / 180;
    const shadowDx = Math.sin(dirRad);
    const shadowDy = Math.cos(dirRad);

    const shapes = scene.buildings.map((b) => {
      const shadowLen = isNight ? 0 : Math.min(MAX_SHADOW_M, b.height / Math.tan(altRad));
      const shadowRing = shadowLen > 0.1 ? b.ring.map(([mx, my]) => [mx + shadowDx * shadowLen, my + shadowDy * shadowLen]) : b.ring;
      const hull = shadowLen > 0.1 ? convexHull([...b.ring, ...shadowRing]) : b.ring;
      return { ...b, shadowLen, hull };
    });

    // The building whose real shadow (same formula computeShading() uses)
    // actually reaches the terrace point right now — highlighted gold so
    // a viewer can match it against the focused card's "Skuggas av X".
    const blocking = shapes.find((s) => s.shadowLen > 0.1 && pointInPolygon([0, 0], s.hull));

    const groundPts = [[0, 0], ...shapes.flatMap((s) => s.hull)];
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [mx, my] of groundPts) {
      const gx = mx - my;
      const gy = mx + my;
      if (gx < minX) minX = gx;
      if (gx > maxX) maxX = gx;
      if (gy < minY) minY = gy;
      if (gy > maxY) maxY = gy;
    }
    const maxHeight = Math.max(3, ...shapes.map((s) => s.height));
    const spanX = Math.max(1, maxX - minX);
    const spanY = Math.max(1, (maxY - minY) * 0.5 + maxHeight);
    const scale = Math.min((w - PADDING_PX * 2) / spanX, (h - PADDING_PX * 2) / spanY, 3.2);
    const originX = w / 2 - ((minX + maxX) / 2) * scale;
    const originY = h - PADDING_PX - maxY * 0.5 * scale;

    const toScreen = (mx, my, z = 0) => ({
      x: originX + (mx - my) * scale,
      y: originY + (mx + my) * 0.5 * scale - z * scale,
    });

    drawGroundRings(ctx, toScreen, [50, 100, 150, 200].filter((r) => r <= RADIUS_M));

    ctx.fillStyle = "rgba(6, 6, 6, 0.55)";
    for (const s of shapes) {
      if (s.shadowLen <= 0.1) continue;
      drawGroundPoly(ctx, toScreen, s.hull);
    }

    const ordered = shapes.slice().sort((a, b) => depthOf(a.ring) - depthOf(b.ring));
    for (const s of ordered) drawBuilding(ctx, toScreen, s, s === blocking);

    drawTerraceMarker(ctx, toScreen, statusColor);
    drawCompass(ctx, w, sunInfo, isNight);
  }

  return { setFocus, render, hasScene };
}
