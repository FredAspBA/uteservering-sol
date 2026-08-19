// src/mapView.js — top-down canvas map for the "Karta" hero view (sibling
// to src/isoHero.js, which stays the isometric local shadow scene). See
// docs/superpowers/specs/2026-08-18-map-view-toggle-design.md for the full
// design decisions this module implements.
//
// Factory pattern matches createIsoHero exactly: app.js pushes data in as
// parameters (setData/render/panTo), this module never reads app.js's
// internal state directly (see spec §1's post-critique correction).

import { buildGrid, queryNearby, pointBboxMeters } from "./shadow.js";

// Same Malmö-center flat local-meters projection origin app.js uses for its
// own MALMO_CENTER constant — duplicated rather than imported, same call
// isoHero.js already made for its own local projector (a two-line formula,
// not worth widening a module's public surface for).
const MALMO_CENTER = [55.605, 13.0038];

const NEIGHBOURHOOD_RADIUS_M = 1000; // spec §2 "Standardvy": ~1 km, not full coverage
const MIN_RADIUS_M = 200; // tightest zoom-in
const MAX_RADIUS_M = 6000; // zoomed out to roughly the whole coverage area
const ZOOM_STEP = 0.85;
const CLICK_HIT_RADIUS_PX = 14;
const PADDING_PX = 20;

function makeProjector(originLon, originLat) {
  const midLatRad = (originLat * Math.PI) / 180;
  const lonScale = 111320 * Math.cos(midLatRad);
  const latScale = 110540;
  return {
    toMeters: (lon, lat) => [(lon - originLon) * lonScale, (lat - originLat) * latScale],
    metersToDeg: (mx, my) => [originLon + mx / lonScale, originLat + my / latScale],
  };
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLElement} controlsEl - empty container this module populates
 *   with its own "Visa mig" button + status text (task 6).
 * @param {{ onSelectTerrace: (terraceId: string) => void }} callbacks
 * @returns {{
 *   setData: (data: { buildings: object, entries: Array, focusedTerraceId: string|null }) => void,
 *   render: (frame: { statusColorFor: (status: string) => string }) => void,
 *   panTo: (terraceId: string) => void,
 *   hasScene: () => boolean,
 * }}
 */
export function createMapView(canvas, controlsEl, { onSelectTerrace } = {}) {
  const ctx = canvas.getContext("2d");
  let scene = null; // { buildings, entries, focusedTerraceId, terraceIndex }
  let viewport = { lon: MALMO_CENTER[1], lat: MALMO_CENTER[0], radiusMeters: NEIGHBOURHOOD_RADIUS_M };

  function terraceBbox(terrace) {
    return pointBboxMeters(terrace.point, 1); // 1m pad, same margin prepareBuildings() uses for buildings
  }

  function buildTerraceIndex(entries) {
    const list = entries.map((entry) => ({
      entry,
      bbox: terraceBbox(entry.terrace),
    }));
    return { list, grid: buildGrid(list) };
  }

  function setData({ buildings, entries, focusedTerraceId }) {
    scene = {
      buildings,
      entries,
      focusedTerraceId,
      terraceIndex: buildTerraceIndex(entries),
    };
  }

  function hasScene() {
    return scene !== null;
  }

  function panTo(terraceId) {
    if (!scene) return;
    const entry = scene.entries.find((e) => e.terrace.id === terraceId);
    if (!entry) return;
    const [lon, lat] = entry.terrace.point.geometry.coordinates;
    viewport = { lon, lat, radiusMeters: NEIGHBOURHOOD_RADIUS_M };
  }

  function viewportBboxDeg() {
    return pointBboxMeters({ geometry: { coordinates: [viewport.lon, viewport.lat] } }, viewport.radiusMeters);
  }

  function drawBuildingOutline(ctx, toScreen, feature) {
    const geom = feature.geometry;
    if (!geom) return;
    const rings = geom.type === "Polygon" ? [geom.coordinates[0]] : geom.type === "MultiPolygon" ? geom.coordinates.map((p) => p[0]) : [];
    for (const ring of rings) {
      ctx.beginPath();
      ring.forEach(([lon, lat], i) => {
        const p = toScreen(lon, lat);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
      ctx.stroke();
    }
  }

  function drawTerracePoint(ctx, toScreen, entry, statusColorFor, isFocused) {
    const [lon, lat] = entry.terrace.point.geometry.coordinates;
    const p = toScreen(lon, lat);
    const color = statusColorFor(entry.lastResult?.status) || statusColorFor("night");
    if (isFocused) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
      ctx.strokeStyle = "#d4af37";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#141412";
    ctx.stroke();
  }

  function resizeForDpr() {
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

  function render({ statusColorFor }) {
    resizeForDpr();
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);

    if (!scene) {
      drawPlaceholder(ctx, w, h, "Väljer en uteservering …");
      return;
    }

    const projector = makeProjector(viewport.lon, viewport.lat);
    const scale = Math.min(w, h) / (viewport.radiusMeters * 2) * (1 - PADDING_PX * 2 / Math.min(w, h));
    const toScreen = (lon, lat) => {
      const [mx, my] = projector.toMeters(lon, lat);
      return { x: w / 2 + mx * scale, y: h / 2 - my * scale };
    };

    const bbox = viewportBboxDeg();

    ctx.strokeStyle = getComputedStyle(canvas).getPropertyValue("--color-surface-border").trim() || "#3c3c35";
    ctx.lineWidth = 1;
    const nearbyBuildings = queryNearby(scene.buildings, bbox);
    for (const b of nearbyBuildings) drawBuildingOutline(ctx, toScreen, b.feature);

    const nearbyTerraces = queryNearby(scene.terraceIndex, bbox);
    for (const item of nearbyTerraces) {
      drawTerracePoint(ctx, toScreen, item.entry, statusColorFor, item.entry.terrace.id === scene.focusedTerraceId);
    }

    if (!nearbyBuildings.length && !nearbyTerraces.length) {
      drawPlaceholder(ctx, w, h, "Inga ställen i det här kartutsnittet");
    }
  }

  return { setData, render, panTo, hasScene };
}
