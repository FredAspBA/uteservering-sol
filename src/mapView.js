// src/mapView.js — top-down canvas map for the "Karta" hero view (sibling
// to src/isoHero.js, which stays the isometric local shadow scene). See
// docs/superpowers/specs/2026-08-18-map-view-toggle-design.md for the full
// design decisions this module implements.
//
// Factory pattern matches createIsoHero exactly: app.js pushes data in as
// parameters (setData/render/panTo), this module never reads app.js's
// internal state directly (see spec §1's post-critique correction).

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
  let scene = null; // filled in by setData() — task 4

  function setData({ buildings, entries, focusedTerraceId }) {
    scene = { buildings, entries, focusedTerraceId };
  }

  function hasScene() {
    return scene !== null;
  }

  function panTo(terraceId) {
    // Real pan/zoom-to-neighborhood logic lands in task 5.
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

  function render() {
    resizeForDpr();
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(214, 214, 206, 0.55)";
    ctx.font = "13px 'IBM Plex Mono', ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(scene ? "Kartan ritas i nästa steg …" : "Väljer en uteservering …", w / 2, h / 2);
  }

  return { setData, render, panTo, hasScene };
}
