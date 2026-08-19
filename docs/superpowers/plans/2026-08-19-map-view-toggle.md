# Kart-/byggnadsvy-växling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a map ↔ building-view toggle above the hero canvas (a new top-down `mapView.js` for geographic overview, sibling to the untouched isometric `isoHero.js`), plus independent navigation helpers (street name, Maps link, distance) in the expanded card detail.

**Architecture:** `src/mapView.js` exports `createMapView(canvas, controlsEl, { onSelectTerrace })`, a factory mirroring `createIsoHero`'s call/parameter pattern exactly — `app.js` pushes data in via `setData()`/`render()`/`panTo()`, `mapView.js` never reads `app.js`'s module state. Viewport culling reuses two newly-exported `shadow.js` grid functions on a second, terrace-only grid instance. A `heroMode` toggle in `app.js` swaps which canvas is visible and which `render()` gets called each tick; the results list underneath is untouched in both modes.

**Tech Stack:** Vanilla JS (ES modules, no bundler), Canvas 2D, Turf.js (global, loaded via `<script>`), no test framework in this repo — verification is manual E2E in the Browser pane (`npm start` → `http://localhost:5500`), the same convention the 2026-08-15/16 redesign and this spec's own "Testning" section already committed to.

**Spec:** [`docs/superpowers/specs/2026-08-18-map-view-toggle-design.md`](../specs/2026-08-18-map-view-toggle-design.md) (revised 2026-08-19 post-`/impeccable critique`, commit `607da45`) — read it alongside this plan; this plan argues from it and does not repeat its reasoning, only its exact decisions.

## Global Constraints

- All UI text is Swedish (PRODUCT.md Brand Commitments — binding, not a placeholder standard).
- No new emoji-icon UI (DESIGN.md Do's and Don'ts — the existing 📍🍷⭐👍👎☁️⚠️➕ set is inherited, frozen, not extended).
- Gold (`--color-sun` / `--color-sun-strong`) is reserved for the sun, the primary action, and "this is selected/focused" (DESIGN.md "The One Gold Rule") — never used for the new position-dot color.
- `--font-mono` only for real measurements (distance, time, degrees) — never for button/label text (DESIGN.md "The Mono-Is-Measurement Rule").
- No `box-shadow` blur anywhere (DESIGN.md "The Flat Paper Rule") — depth via a lighter surface tone or a gold ring only.
- All new interactive controls get ≥44×44px touch targets (PRODUCT.md Accessibility & Inclusion, confirmed 2026-08-19 — matches `.card-summary`'s existing 44px).
- `src/isoHero.js` stays completely untouched (spec §1) — it remains the local 200m shadow scene for the focused card.
- No new geojson, no new pipeline step, no road-geometry rendering (spec "Beslut").
- No `watchPosition` — geolocation is one-shot per button press, never stored (spec §4).
- `taggning.html` / `taggning.css` / `taggning-tokens.css` are not touched by this feature (spec YAGNI list).

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/shadow.js` | Modify | Export `buildGrid`, `queryNearby` (already-generic grid functions), `pointBboxMeters` — no behavior change, just visibility, so `mapView.js` can build a second grid index for terraces. |
| `src/app.js` | Modify | Export `STATUS_COLORS`. Add `heroMode` state + localStorage memory, view-toggle wiring, `mapView` instantiation and the `setData`/`render`/`panTo` call sites. Add the three navigation-helper lines to `cardDetailHtml()`. |
| `src/mapView.js` | Create | New module. Top-down canvas renderer: building outlines, status-colored terrace points, viewport-culled via a terrace grid built from the exported `shadow.js` functions, pan/zoom, click-to-select, and its own "Visa mig" geolocation control + position dot. |
| `index.html` | Modify | Add the view-toggle button row, a second `<canvas id="map-canvas">` + `<div id="map-controls">` inside `.iso-hero-canvas-wrap`. |
| `style.css` | Modify | View-toggle button styles (44px, gold-when-active), `#map-canvas`/`.map-controls`/`#map-locate-button`/`#map-locate-status` styles, new `--color-position` token, `.card-nav-line` styles for the new card-detail row. |
| `DESIGN.md` | Modify | Add `--color-position` to the color table (spec §4 commitment). |

`PRODUCT.md`'s 44px confirmation is already committed (2026-08-19, prior session) — no further change needed there.

---

### Task 1: Export the reusable grid functions from `shadow.js`

**Files:**
- Modify: `src/shadow.js` (the three function declarations at lines ~182, ~195, ~245, ~268 in the current file — grep for `function padBboxMeters`, `function pointBboxMeters`, `function buildGrid`, `function queryNearby` rather than trusting line numbers, which drift)
- Test: manual (browser console import check, see Step 3)

**Interfaces:**
- Produces: `export function buildGrid(list)` — `list` is any array of objects with a `.bbox` (`[minLon, minLat, maxLon, maxLat]`) property; returns a `Map` keyed by grid-cell string.
- Produces: `export function queryNearby(index, bbox)` — `index` is `{ list, grid }`; `bbox` is `[minLon, minLat, maxLon, maxLat]`; returns the subset of `index.list` whose bbox overlaps `bbox` (grid-approximate, caller may need an exact bbox check for tight cases — not needed here since terrace points are single-pixel targets).
- Produces: `export function pointBboxMeters(point, meters)` — `point` is a turf Point feature; `meters` is padding radius; returns `[minLon, minLat, maxLon, maxLat]`.
- Consumes: nothing new — these three functions already exist as private helpers, this task only adds `export`.

- [ ] **Step 1: Add `export` to the three function declarations**

In `src/shadow.js`, change:
```js
function buildGrid(list) {
```
to:
```js
export function buildGrid(list) {
```

Change:
```js
function queryNearby(index, bbox) {
```
to:
```js
export function queryNearby(index, bbox) {
```

Change:
```js
function pointBboxMeters(point, meters) {
```
to:
```js
export function pointBboxMeters(point, meters) {
```

Also add one line to each function's existing doc comment noting the new external consumer, e.g. above `buildGrid`:
```js
/**
 * Indexes any list of objects with a `.bbox` [minLon, minLat, maxLon, maxLat]
 * into a spatial grid for fast bbox-overlap queries. Originally built for
 * prepareBuildings() below; exported 2026-08-19 so src/mapView.js can build
 * a second, terrace-only grid instance with the same function — see that
 * module's `buildTerraceIndex()`.
 */
function buildGrid(list) {
```
(Keep `queryNearby`'s and `pointBboxMeters`'s existing comments, just append one sentence each noting the new consumer, same style.)

- [ ] **Step 2: Confirm no other code broke**

Run: `grep -n "^function buildGrid\|^function queryNearby\|^function pointBboxMeters\|^export function buildGrid\|^export function queryNearby\|^export function pointBboxMeters" src/shadow.js`
Expected: all three show as `export function ...` — three matches, no bare `function` matches left for those three names.

- [ ] **Step 3: Manual smoke test — the app still loads and computes shading**

Start the server:
```bash
npm start
```
Open `http://localhost:5500` in the Browser pane, wait for the status line to read something like "… solhöjd i Malmö: …° i sol, … i skugga … av 939 uteserveringar" (not an error). This confirms `prepareBuildings()`/`computeShading()` still work after the export changes (pure syntax addition, but this is the cheapest possible regression check before building on top of it).

Check the browser console for errors:
```
read_console_messages (onlyErrors: true)
```
Expected: empty.

- [ ] **Step 4: Commit**

```bash
git add src/shadow.js
git commit -m "refactor: export buildGrid/queryNearby/pointBboxMeters from shadow.js

Pure visibility change, no behavior difference — prepares for
src/mapView.js (task 3+) to build a second grid index for terraces,
reusing the same generic grid functions rather than duplicating them.
Part of the map-view-toggle feature, see
docs/superpowers/specs/2026-08-18-map-view-toggle-design.md §5."
```

---

### Task 2: Export `STATUS_COLORS` from `app.js`

**Files:**
- Modify: `src/app.js` (the `const STATUS_COLORS = {...}` declaration, currently right after `cssVar()`)
- Test: manual (Step 2 below)

**Interfaces:**
- Consumes: nothing new.
- Produces: `export const STATUS_COLORS: { sun: string, shade: string, night: string, anomaly: string }` — resolved hex/CSS-color-string values read from the CSS custom properties at module load. `mapView.js` (task 4+) imports this directly instead of receiving a per-call color string the way `isoHero.render({statusColor})` does — see spec §1's correction: this closes the gap where the card list, `isoHero.js`, and the new map view could each end up with a different idea of "what does sun-yellow actually mean."

- [ ] **Step 1: Add `export` to the declaration**

In `src/app.js`, change:
```js
const STATUS_COLORS = {
  sun: cssVar("--color-sun"),
  shade: cssVar("--color-shade"),
  night: cssVar("--color-night"),
  anomaly: cssVar("--color-anomaly"),
};
```
to:
```js
export const STATUS_COLORS = {
  sun: cssVar("--color-sun"),
  shade: cssVar("--color-shade"),
  night: cssVar("--color-night"),
  anomaly: cssVar("--color-anomaly"),
};
```

- [ ] **Step 2: Manual smoke test**

Reload `http://localhost:5500`, confirm the page still renders (status line populates, cards appear, `isoHero` canvas draws a scene once a card is focused). This is a one-line addition with zero behavior change; the check is purely "did I typo the export keyword."

- [ ] **Step 3: Commit**

```bash
git add src/app.js
git commit -m "refactor: export STATUS_COLORS from app.js

Lets src/mapView.js (task 4+) import the same status-color source of
truth instead of threading a per-call color string the way
isoHero.render({statusColor}) does today — see spec §1's correction
about the previous 'already shared' claim being overstated."
```

---

### Task 3: View-toggle scaffold — HTML, CSS, `app.js` state, and a placeholder `mapView.js`

**Files:**
- Create: `src/mapView.js` (skeleton only — placeholder canvas, no real rendering yet)
- Modify: `index.html` (add toggle buttons + second canvas + controls container)
- Modify: `style.css` (toggle button styles, `#map-canvas` sizing, `.map-controls` base styles)
- Modify: `src/app.js` (import `createMapView`, add `heroMode` state/localStorage, wire toggle click handlers, hide/show canvases)
- Test: manual (Steps 6–7 below)

**Interfaces:**
- Produces (from `mapView.js`, skeleton version): `export function createMapView(canvas, controlsEl, { onSelectTerrace }) → { setData({buildings, entries, focusedTerraceId}), render({statusColorFor}), panTo(terraceId), hasScene() }`. This task's `render()` only draws a placeholder ("Väljer en uteservering …", mirroring `isoHero`'s own placeholder text and pattern) — real building/terrace rendering is task 4.
- Consumes: `STATUS_COLORS` is available (task 2) but not yet used by this skeleton.
- Produces (from `app.js`): `heroMode` (`"map" | "buildings"`), `HERO_VIEW_STORAGE_KEY`, `readHeroMode()`, `writeHeroMode(mode)`, `applyHeroMode()`, `setHeroMode(mode)`, `renderHero()` — later tasks (4–6) build on these names, so get them exactly right here.

- [ ] **Step 1: Add the toggle buttons and second canvas to `index.html`**

In `index.html`, replace the `#iso-hero` section:
```html
  <section id="iso-hero" aria-label="Skuggkarta för valt resultat">
    <div class="iso-hero-head">
      <p class="iso-hero-focus" id="iso-hero-focus">Väljer en uteservering …</p>
      <p class="iso-hero-meta" id="iso-hero-meta"></p>
    </div>
    <div class="iso-hero-canvas-wrap">
      <canvas id="iso-canvas"></canvas>
    </div>
    <p class="iso-hero-caption" id="iso-hero-caption">
      Byggnader inom 200 m runt det fokuserade resultatet, i verklig höjd. Dra i tidsreglaget — skuggorna räknas om i realtid, med samma metod som betyget nedan.
    </p>
  </section>
```
with:
```html
  <section id="iso-hero" aria-label="Skuggkarta för valt resultat">
    <div class="iso-hero-head">
      <p class="iso-hero-focus" id="iso-hero-focus">Väljer en uteservering …</p>
      <p class="iso-hero-meta" id="iso-hero-meta"></p>
    </div>
    <div class="hero-view-toggle" role="group" aria-label="Visningsläge">
      <button type="button" id="hero-view-buildings-button" class="hero-view-toggle-button" aria-pressed="true">Byggnader</button>
      <button type="button" id="hero-view-map-button" class="hero-view-toggle-button" aria-pressed="false">Karta</button>
    </div>
    <div class="iso-hero-canvas-wrap">
      <canvas id="iso-canvas"></canvas>
      <canvas id="map-canvas" hidden></canvas>
      <div id="map-controls" class="map-controls" hidden></div>
    </div>
    <p class="iso-hero-caption" id="iso-hero-caption">
      Byggnader inom 200 m runt det fokuserade resultatet, i verklig höjd. Dra i tidsreglaget — skuggorna räknas om i realtid, med samma metod som betyget nedan.
    </p>
  </section>
```

Note: `#map-controls` is an empty container — `mapView.js` populates it with the "Visa mig" button and status text itself in task 6 (spec §4 frames that button as living "i mapView.js's kontrollrad"; giving `createMapView` the container element and letting it own that DOM keeps the whole map feature, including its own location trigger, in one file).

- [ ] **Step 2: Add toggle + map CSS to `style.css`**

Add after the `#near-me-button:hover, #near-me-alcohol-button:hover` block (before `#search-status`):
```css
.hero-view-toggle {
  display: flex;
  gap: 0.4rem;
  margin-bottom: 0.55rem;
}

.hero-view-toggle-button {
  flex: 1;
  min-height: 44px;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--color-surface-border);
  background: var(--color-bg);
  color: var(--color-ink-muted);
  border-radius: var(--radius);
  cursor: pointer;
  font-size: 0.82rem;
  font-weight: 600;
}

.hero-view-toggle-button:hover {
  border-color: var(--color-sun);
  color: var(--color-sun-strong);
}

.hero-view-toggle-button[aria-pressed="true"] {
  border-color: var(--color-sun);
  color: var(--color-sun-strong);
  background: color-mix(in srgb, var(--color-sun) 12%, var(--color-bg));
}
```

Add after the existing `#iso-canvas { ... }` block:
```css
#map-canvas {
  display: block;
  width: 100%;
  height: 280px;
  cursor: grab;
}

#map-canvas:active {
  cursor: grabbing;
}

.map-controls {
  position: absolute;
  top: 0.6rem;
  left: 0.6rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  z-index: 1;
}
```

`.map-controls` needs `.iso-hero-canvas-wrap` to be a positioning context — it already is (`position: relative`, set in the existing `.iso-hero-canvas-wrap` rule), so no change needed there.

Add to the existing `@media (max-width: 640px)` block, right after the `#iso-canvas { height: 220px; }` rule:
```css
  #map-canvas {
    height: 220px;
  }

  .hero-view-toggle-button {
    font-size: 0.78rem;
    padding: 0.6rem 0.5rem;
  }
```

- [ ] **Step 3: Create the `mapView.js` skeleton**

```js
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
```

- [ ] **Step 4: Wire `heroMode` state and toggle handlers into `app.js`**

Add the import, right after the `createIsoHero` import:
```js
import { createIsoHero } from "./isoHero.js";
import { createMapView } from "./mapView.js";
```

Add DOM refs, right after the existing `isoHeroCaptionEl` line:
```js
const isoHeroCaptionEl = document.getElementById("iso-hero-caption");
const heroViewBuildingsButton = document.getElementById("hero-view-buildings-button");
const heroViewMapButton = document.getElementById("hero-view-map-button");
const mapCanvas = document.getElementById("map-canvas");
const mapControlsEl = document.getElementById("map-controls");
```

Add the `mapView` instantiation right after `const isoHero = createIsoHero(isoCanvas);`:
```js
const isoHero = createIsoHero(isoCanvas);
const mapView = createMapView(mapCanvas, mapControlsEl, {
  onSelectTerrace: (terraceId) => {
    const entry = entries.find((e) => e.terrace.id === terraceId);
    if (!entry) return;
    focusEntry(entry, { scroll: true });
    if (entry.card && !entry.expanded) toggleExpand(entry);
  },
});
```

Add hero-mode state and localStorage helpers, right after the `INITIAL_VISIBLE`/`LOAD_MORE_STEP` constants:
```js
const INITIAL_VISIBLE = 24;
const LOAD_MORE_STEP = 24;

// ---------- Hero view mode (map vs. buildings) ----------
const HERO_VIEW_STORAGE_KEY = "uteservering-sol:hero-view-mode";

function readHeroMode() {
  try {
    return localStorage.getItem(HERO_VIEW_STORAGE_KEY) === "map" ? "map" : "buildings";
  } catch {
    return "buildings";
  }
}

function writeHeroMode(mode) {
  try {
    localStorage.setItem(HERO_VIEW_STORAGE_KEY, mode);
  } catch {
    // localStorage unavailable — the choice just won't persist, harmless.
  }
}

let heroMode = readHeroMode();

function applyHeroMode() {
  const isMap = heroMode === "map";
  isoCanvas.hidden = isMap;
  mapCanvas.hidden = !isMap;
  mapControlsEl.hidden = !isMap;
  heroViewMapButton.setAttribute("aria-pressed", String(isMap));
  heroViewBuildingsButton.setAttribute("aria-pressed", String(!isMap));
  renderHero();
}

function setHeroMode(mode) {
  if (mode === heroMode) return;
  heroMode = mode;
  writeHeroMode(mode);
  applyHeroMode();
}

heroViewMapButton.addEventListener("click", () => setHeroMode("map"));
heroViewBuildingsButton.addEventListener("click", () => setHeroMode("buildings"));
```

- [ ] **Step 5: Add `renderHero()` and route the existing `renderIsoHero()` call sites through it**

Rename the function `renderIsoHero` to keep it doing exactly what it does today (draw the isometric scene), but stop calling it directly from `focusEntry()`/`recompute()`. Instead, add a new `renderHero()` right after the existing `renderIsoHero` function definition:
```js
function renderHero() {
  if (!focusedEntry?.lastResult) return;
  if (heroMode === "buildings") {
    renderIsoHero();
  } else {
    mapView.render({ statusColorFor: (status) => STATUS_COLORS[status] ?? STATUS_COLORS.night });
  }
}
```

Then change the two existing call sites:

In `focusEntry()`, change:
```js
  isoHero.setFocus(entry.terrace, buildings);
  renderIsoHero();
```
to:
```js
  isoHero.setFocus(entry.terrace, buildings);
  mapView.panTo(entry.terrace.id);
  renderHero();
```

In `recompute()`, change:
```js
  if (focusedEntry) renderIsoHero();
```
to:
```js
  if (focusedEntry) renderHero();
```

- [ ] **Step 6: Call `mapView.setData()` whenever `filteredSorted` changes**

In `applyFilters()`, right after the `filteredSorted = entries.filter(...).sort(compareEntries);` assignment, add:
```js
  mapView.setData({ buildings, entries: filteredSorted, focusedTerraceId: focusedEntry?.terrace.id ?? null });
```

- [ ] **Step 7: Apply the saved hero mode once data is loaded**

In `init()`, right after the existing `applyFilters();` call, add:
```js
  applyHeroMode();
```
(`applyHeroMode()` calls `renderHero()` internally, so this is the one call that both shows/hides the right canvas AND draws the initial frame — no separate initial-render call needed.)

- [ ] **Step 8: Manual verification**

```bash
npm start
```
In the Browser pane, navigate to `http://localhost:5500`.

Check initial state:
```
read_page (filter: interactive)
```
Expected: `#hero-view-buildings-button` has `aria-pressed="true"`, `#hero-view-map-button` has `aria-pressed="false"`, `#map-canvas` and `#map-controls` are hidden.

Click "Karta":
```
computer left_click on the "Karta" button
```
Then:
```
read_page (ref_id of #map-canvas's wrapper, or filter: all near the hero section)
```
Expected: `#iso-canvas` now hidden, `#map-canvas` visible showing "Kartan ritas i nästa steg …" (or "Väljer en uteservering …" if no card is focused yet), `#hero-view-map-button` now `aria-pressed="true"`.

Reload the page:
```
navigate (same URL, force reload)
```
Expected: opens directly in "Karta" mode (localStorage remembered it) — confirm via the same `read_page` check as above.

Click "Byggnader" to switch back, confirm the isometric scene reappears and still animates correctly when dragging the time slider (regression check — task 3 rewired `renderIsoHero()`'s call sites, so this proves that rewiring didn't break the existing feature).

Take a screenshot as final proof:
```
computer screenshot
```

- [ ] **Step 9: Commit**

```bash
git add index.html style.css src/app.js src/mapView.js
git commit -m "feat: view-toggle scaffold for map/building hero (spec §2)

Adds the Karta/Byggnader toggle buttons, a second canvas + controls
container, and src/mapView.js as a skeleton (placeholder render only).
heroMode is remembered in localStorage per spec §2's 'Minne' decision.
Real map rendering lands in the next task."
```

---

### Task 4: Real map rendering — building outlines, terrace points, viewport culling, "Standardvy" default zoom

**Files:**
- Modify: `src/mapView.js` (replace the placeholder `render()`/`setData()`/`panTo()` with real implementations)
- Test: manual (Step 5 below)

**Interfaces:**
- Consumes: `buildGrid`, `queryNearby`, `pointBboxMeters` from `src/shadow.js` (task 1). `STATUS_COLORS` shape via the `statusColorFor` callback (task 2/3).
- Consumes: `entry.lastResult.status`, `entry.terrace.{id, name, point}` — same entry/terrace shape `app.js` already uses everywhere else.
- Consumes: `buildings.list[i]` shape from `prepareBuildings()` (see `src/shadow.js`): `{ feature, bbox, centerLon, centerLat, radiusMeters, height, name }`.
- Produces (unchanged signatures from task 3, now with real bodies): `setData`, `render`, `panTo`, `hasScene`.

- [ ] **Step 1: Add the imports and shared constants**

At the top of `src/mapView.js`, add:
```js
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
```

- [ ] **Step 2: Add the local-meters projector and viewport state**

Add after the constants:
```js
function makeProjector(originLon, originLat) {
  const midLatRad = (originLat * Math.PI) / 180;
  const lonScale = 111320 * Math.cos(midLatRad);
  const latScale = 110540;
  return {
    toMeters: (lon, lat) => [(lon - originLon) * lonScale, (lat - originLat) * latScale],
    metersToDeg: (mx, my) => [originLon + mx / lonScale, originLat + my / latScale],
  };
}
```

Replace the factory body's top (the `let scene = null;` line) with the full viewport state:
```js
export function createMapView(canvas, controlsEl, { onSelectTerrace } = {}) {
  const ctx = canvas.getContext("2d");
  let scene = null; // { buildings, entries, focusedTerraceId, terraceIndex }
  let viewport = { lon: MALMO_CENTER[1], lat: MALMO_CENTER[0], radiusMeters: NEIGHBOURHOOD_RADIUS_M };
```

- [ ] **Step 3: Implement `setData()` — build the terrace grid index**

Replace the skeleton's `setData`:
```js
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
```

- [ ] **Step 4: Implement `panTo()` and `render()`**

Replace the skeleton's `panTo`:
```js
  function panTo(terraceId) {
    if (!scene) return;
    const entry = scene.entries.find((e) => e.terrace.id === terraceId);
    if (!entry) return;
    const [lon, lat] = entry.terrace.point.geometry.coordinates;
    viewport = { lon, lat, radiusMeters: NEIGHBOURHOOD_RADIUS_M };
  }
```

Replace the skeleton's `render` with:
```js
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

    ctx.strokeStyle = "var(--color-surface-border)".startsWith("var") ? getComputedStyle(canvas).getPropertyValue("--color-surface-border").trim() || "#3c3c35" : "#3c3c35";
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
```

(The `ctx.strokeStyle = "var(...)".startsWith(...)` line is a deliberately defensive one-liner: canvas 2D contexts do NOT resolve CSS custom properties themselves the way DOM elements do, so building outlines must read `--color-surface-border`'s resolved value via `getComputedStyle` once per render — cheap, same pattern `app.js`'s own `cssVar()` helper already uses. Simplify this to a plain `getComputedStyle(canvas).getPropertyValue("--color-surface-border").trim() || "#3c3c35"` — the conditional above was scaffolding to make the fallback explicit; write it as the plain version in the actual file.)

- [ ] **Step 5: Manual verification**

```bash
npm start
```
In the Browser pane, load `http://localhost:5500`, wait for cards to render, click a card to focus it, then click "Karta".

```
computer screenshot
```
Expected: a top-down view with thin building outlines and colored terrace dots, one of them (the focused terrace) with a gold ring around it, centered on that terrace's neighborhood — not the whole city.

Check the viewport really is neighborhood-scale, not full-coverage:
```
javascript_tool: document.getElementById("map-canvas").getContext("2d") ? "canvas ready" : "missing"
```
and visually confirm via the screenshot that dot density looks like "one neighborhood," not "~940 dots crammed into 220px."

Click a different card in the results list, confirm the map re-centers on the new focus (screenshot again).

Switch back to "Byggnader" and back to "Karta" — confirm the map redraws correctly both times (no stale canvas content).

- [ ] **Step 6: Commit**

```bash
git add src/mapView.js
git commit -m "feat: real top-down rendering for mapView.js (spec §1, §2, §5)

Building outlines + status-colored terrace points, viewport-culled via
a second grid index (reusing shadow.js's exported buildGrid/queryNearby
per spec §5's correction — not the same building-only index). panTo()
implements the 'Standardvy' decision: opens zoomed to a ~1km
neighborhood around the focused terrace, not the full city."
```

---

### Task 5: Pan, zoom, and click-to-select on the map

**Files:**
- Modify: `src/mapView.js` (add pointer/wheel event listeners inside `createMapView`)
- Test: manual (Step 3 below)

**Interfaces:**
- Consumes: `onSelectTerrace` callback (already threaded through from task 3).
- No new exported signatures — this task only adds internal event wiring to the existing `canvas`.

- [ ] **Step 1: Add drag-to-pan**

Add inside `createMapView`, after the `render` function definition, before the `return` statement:
```js
  let dragState = null; // { startClientX, startClientY, startLon, startLat }

  canvas.addEventListener("pointerdown", (ev) => {
    if (!scene) return;
    dragState = { startClientX: ev.clientX, startClientY: ev.clientY, startLon: viewport.lon, startLat: viewport.lat };
    canvas.setPointerCapture(ev.pointerId);
  });

  canvas.addEventListener("pointermove", (ev) => {
    if (!dragState) return;
    const dxPx = ev.clientX - dragState.startClientX;
    const dyPx = ev.clientY - dragState.startClientY;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const scale = (Math.min(w, h) / (viewport.radiusMeters * 2)) * (1 - (PADDING_PX * 2) / Math.min(w, h));
    const projector = makeProjector(dragState.startLon, dragState.startLat);
    const [mx, my] = [-dxPx / scale, dyPx / scale];
    const [newLon, newLat] = projector.metersToDeg(mx, my);
    viewport = { lon: newLon, lat: newLat, radiusMeters: viewport.radiusMeters };
    render({ statusColorFor: lastStatusColorFor });
  });

  function endDrag(ev) {
    if (dragState) canvas.releasePointerCapture(ev.pointerId);
    dragState = null;
  }
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
```

This introduces a `lastStatusColorFor` reference that `render()` needs to remember between the app-driven calls and these event-driven re-renders (drag/zoom can't wait for the next `recompute()` tick to see feedback). Add it near the top of the factory, next to `viewport`:
```js
  let viewport = { lon: MALMO_CENTER[1], lat: MALMO_CENTER[0], radiusMeters: NEIGHBOURHOOD_RADIUS_M };
  let lastStatusColorFor = (status) => ({ sun: "#d4af37", shade: "#85acc9", night: "#8f8f88", anomaly: "#e2703f" }[status] || "#8f8f88");
```
And at the top of `render({ statusColorFor })`, add:
```js
  function render({ statusColorFor }) {
    lastStatusColorFor = statusColorFor;
```
(right after the function signature line, before `resizeForDpr();`).

- [ ] **Step 2: Add wheel-to-zoom and click-to-select**

Add after the pan listeners:
```js
  canvas.addEventListener(
    "wheel",
    (ev) => {
      if (!scene) return;
      ev.preventDefault();
      const factor = ev.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      viewport = { ...viewport, radiusMeters: Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, viewport.radiusMeters * factor)) };
      render({ statusColorFor: lastStatusColorFor });
    },
    { passive: false }
  );

  canvas.addEventListener("click", (ev) => {
    if (!scene || dragState) return;
    const rect = canvas.getBoundingClientRect();
    const clickX = ev.clientX - rect.left;
    const clickY = ev.clientY - rect.top;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const scale = (Math.min(w, h) / (viewport.radiusMeters * 2)) * (1 - (PADDING_PX * 2) / Math.min(w, h));
    const projector = makeProjector(viewport.lon, viewport.lat);
    const toScreen = (lon, lat) => {
      const [mx, my] = projector.toMeters(lon, lat);
      return { x: w / 2 + mx * scale, y: h / 2 - my * scale };
    };
    const bbox = viewportBboxDeg();
    const nearby = queryNearby(scene.terraceIndex, bbox);
    let closest = null;
    let closestDistPx = CLICK_HIT_RADIUS_PX;
    for (const item of nearby) {
      const [lon, lat] = item.entry.terrace.point.geometry.coordinates;
      const p = toScreen(lon, lat);
      const distPx = Math.hypot(p.x - clickX, p.y - clickY);
      if (distPx < closestDistPx) {
        closestDistPx = distPx;
        closest = item.entry;
      }
    }
    if (closest && onSelectTerrace) onSelectTerrace(closest.terrace.id);
  });
```

Note the `pointerdown`/`click` interaction: a plain click (no movement) still fires both `pointerdown` and `click` — that's fine, since `dragState` is set on `pointerdown` and only checked (not required non-null) in `click`'s guard as `dragState` being truthy at click-time only happens mid-drag, not after `pointerup` already cleared it. A real drag fires `pointermove` between down/up, which is what actually pans; a plain click never moves, so this is safe as written — no additional "did we actually drag" threshold is needed given `pointerup` always clears `dragState` before the browser's synthetic `click` fires.

- [ ] **Step 3: Manual verification**

Reload, focus a card, switch to "Karta".

Drag on the canvas:
```
computer left_click_drag from a point inside #map-canvas to another point ~60px away
```
Then screenshot — confirm the view visibly panned (building outlines shifted).

Scroll to zoom:
```
computer scroll (direction: up, on #map-canvas)
```
Screenshot — confirm the view zoomed in (fewer, larger-spaced dots) or out depending on scroll direction; verify both directions.

Click a terrace dot that is NOT the currently-focused one (visually identify one from the screenshot, click its approximate screen coordinates):
```
computer left_click at the dot's coordinates
```
Then:
```
read_page (filter: interactive, near #results-list)
```
Expected: a different card is now expanded/focused (`.is-focused` class present, matching the terrace you clicked) — confirms `onSelectTerrace` → `focusEntry()` wiring works end to end.

- [ ] **Step 4: Commit**

```bash
git add src/mapView.js
git commit -m "feat: pan/zoom/click-to-select on the map view (spec §1)

Drag-to-pan and wheel-to-zoom (clamped 200m-6000m radius), plus
click-to-select: clicking a terrace dot focuses the same card a list
click would, via the onSelectTerrace callback threaded through since
task 3 — satisfies spec Testning's 'klick på en kart-punkt fokuserar
samma kort som klick i listan gör'."
```

---

### Task 6: "Visa mig" geolocation button, position dot, error/loading states

**Files:**
- Modify: `src/mapView.js` (add the control DOM creation + geolocation wiring + position-dot rendering)
- Modify: `style.css` (`#map-locate-button`, `#map-locate-status`, `--color-position` token)
- Test: manual (Step 4 below)

**Interfaces:**
- Consumes: `controlsEl` (already passed into `createMapView` since task 3).
- Produces: no new exported functions — the button/status text are created and owned entirely inside `mapView.js`, per spec §4.

- [ ] **Step 1: Add the `--color-position` token and button/status CSS**

In `style.css`, add to the `:root` block, right after `--color-confirm: #82b085;`:
```css
  --color-position: #9a86c9;
```

Add near the `.map-controls` rule added in task 3:
```css
#map-locate-button {
  min-height: 44px;
  min-width: 44px;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--color-surface-border);
  background: var(--color-surface);
  color: var(--color-ink);
  border-radius: var(--radius);
  cursor: pointer;
  font-size: 0.82rem;
  white-space: nowrap;
}

#map-locate-button:hover:not(:disabled) {
  border-color: var(--color-sun);
  color: var(--color-sun-strong);
}

#map-locate-button:disabled {
  opacity: 0.6;
  cursor: default;
}

#map-locate-status {
  font-size: 0.78rem;
  color: var(--color-ink-muted);
  background: color-mix(in srgb, var(--color-bg) 80%, transparent);
  padding: 0.2rem 0.4rem;
  border-radius: var(--radius);
}
```

- [ ] **Step 2: Create the control DOM and geolocation handler inside `mapView.js`**

Add inside `createMapView`, before the `return` statement (after the pan/zoom/click listeners from task 5):
```js
  const locateButton = document.createElement("button");
  locateButton.type = "button";
  locateButton.id = "map-locate-button";
  locateButton.textContent = "Visa mig";
  const locateStatus = document.createElement("span");
  locateStatus.id = "map-locate-status";
  controlsEl.appendChild(locateButton);
  controlsEl.appendChild(locateStatus);

  let userPosition = null; // { lon, lat } | null — never persisted, spec §4

  function drawPositionDot(toScreen) {
    if (!userPosition) return;
    const p = toScreen(userPosition.lon, userPosition.lat);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = getComputedStyle(canvas).getPropertyValue("--color-position").trim() || "#9a86c9";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#141412";
    ctx.stroke();
  }

  locateButton.addEventListener("click", () => {
    if (!navigator.geolocation) {
      locateStatus.textContent = "Din webbläsare stödjer inte platsdelning.";
      return;
    }
    locateButton.disabled = true;
    locateStatus.textContent = "Hämtar din plats…";
    navigator.geolocation.getCurrentPosition(
      (position) => {
        userPosition = { lon: position.coords.longitude, lat: position.coords.latitude };
        locateStatus.textContent = "";
        locateButton.disabled = false;
        render({ statusColorFor: lastStatusColorFor });
      },
      (err) => {
        locateStatus.textContent = err.code === err.PERMISSION_DENIED ? "Platsdelning nekades — kan inte visa din position." : "Kunde inte hämta din plats just nu.";
        locateButton.disabled = false;
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
    );
  });
```

- [ ] **Step 3: Call `drawPositionDot()` from `render()`**

In the `render()` function (task 4), right after the terrace-drawing loop and before the `if (!nearbyBuildings.length ...)` empty-state check, add:
```js
    drawPositionDot(toScreen);
```

- [ ] **Step 4: Manual verification**

Reload, switch to "Karta". Confirm the "Visa mig" button and (empty) status span are present inside `#map-controls`:
```
read_page (filter: interactive)
```

Click "Visa mig":
```
computer left_click on the "Visa mig" button
```
The Browser pane's test environment will either show a geolocation permission prompt (accept it, or note that headless/CI browser contexts commonly auto-deny or auto-fail geolocation — that is an acceptable and correctly-handled outcome here, not a bug) or resolve immediately. Either way, check the status text updated correctly:
```
read_page (ref_id of #map-locate-status)
```
Expected: either empty (success, dot drawn — screenshot to confirm the violet dot appears) or one of the two Swedish error strings — never stuck on "Hämtar din plats…" indefinitely, and the button's `disabled` attribute is false again once resolved either way.

Rapid-click the button twice in a row before the first request resolves (if the environment's timing allows observing this):
```
read_page (ref_id of #map-locate-button)
```
Expected: `disabled` is present while a request is in flight — confirms the P2 "no debounce" finding from the critique is fixed.

- [ ] **Step 5: Commit**

```bash
git add src/mapView.js style.css
git commit -m "feat: 'Visa mig' geolocation button with error/loading states (spec §4)

One-shot getCurrentPosition, reusing findNearestMatching's exact
Swedish message pattern (hämtar/nekad/fel) per the critique's P2 fix.
Button disables while a request is in flight to prevent stacked calls.
Position dot uses a new --color-position token (violet, distinct from
gold per DESIGN.md's One Gold Rule) — never persisted per spec §4."
```

---

### Task 7: Navigation helpers in the card detail (street name, Maps link, distance)

**Files:**
- Modify: `src/app.js` (`cardDetailHtml()`)
- Modify: `style.css` (`.card-nav-line`)
- Test: manual (Step 3 below)

**Interfaces:**
- Consumes: `terrace.feature.properties["addr:street"]` (verified present on 464/939 terraces), `entry.distanceMeters` (already computed by `findNearestMatching`, `null` when no location known yet).
- No exported signatures — this is a template-string addition inside an existing function, independent of the map feature (spec §3: "fristående ändring").

- [ ] **Step 1: Add the nav-line builder function**

Add above `cardDetailHtml()` in `src/app.js`:
```js
function navLineHtml(entry) {
  const { terrace, distanceMeters } = entry;
  const [lon, lat] = terrace.point.geometry.coordinates;
  const street = terrace.feature?.properties?.["addr:street"];
  const parts = [];
  if (street) parts.push(`<span class="card-nav-street">${escapeHtml(street)}</span>`);
  parts.push(`<a class="card-nav-link" href="https://www.google.com/maps/search/?api=1&query=${lat},${lon}" target="_blank" rel="noopener noreferrer">Öppna i kartor</a>`);
  if (distanceMeters != null) parts.push(`<span class="card-nav-distance">${Math.round(distanceMeters)} m bort</span>`);
  return `<div class="card-nav-line">${parts.join(" · ")}</div>`;
}
```

- [ ] **Step 2: Call it from `cardDetailHtml()`**

Change:
```js
function cardDetailHtml(entry) {
  const { terrace, lastResult: result, lastViewedAt } = entry;
  const [lon, lat] = terrace.point.geometry.coordinates;
  const vote = getVoteForView(terrace.id, lastViewedAt);
  const isFav = isFavorite(terrace.id);
  return `
    ${unverifiedNoticeHtml(terrace.feature?.properties, lat, lon)}
    ${explainHtml(result)}
    ${weatherHtml(result.status, lastViewedAt)}
    <div class="card-timeline">${timelineSectionHtml(entry)}</div>
```
to:
```js
function cardDetailHtml(entry) {
  const { terrace, lastResult: result, lastViewedAt } = entry;
  const [lon, lat] = terrace.point.geometry.coordinates;
  const vote = getVoteForView(terrace.id, lastViewedAt);
  const isFav = isFavorite(terrace.id);
  return `
    ${unverifiedNoticeHtml(terrace.feature?.properties, lat, lon)}
    ${explainHtml(result)}
    ${weatherHtml(result.status, lastViewedAt)}
    ${navLineHtml(entry)}
    <div class="card-timeline">${timelineSectionHtml(entry)}</div>
```

- [ ] **Step 3: Add `.card-nav-line` CSS**

Add after the existing `.card-weather { ... }` rule in `style.css`:
```css
.card-nav-line {
  font-size: 0.78rem;
  color: var(--color-ink-muted);
  margin-top: 0.35rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}

.card-nav-link {
  color: var(--color-sun-strong);
  font-weight: 600;
}

.card-nav-distance {
  font-family: var(--font-mono);
}
```

- [ ] **Step 4: Manual verification**

Reload, expand a card whose terrace has a known street tag (any card works — 49% coverage means most sessions will hit one; if the first doesn't show a street name, that is the documented silent-omission behavior working correctly, not a bug — try a couple of cards to see both cases).
```
read_page (filter: all, ref_id of the expanded card's detail region)
```
Expected: a `.card-nav-line` row with (when present) a street name, always an "Öppna i kartor" link, and (once a distance is known — trigger via "Sol nära mig" first, or just accept it's absent until then) a distance in meters.

Click "Sol nära mig" first (to populate `distanceMeters` for entries), then expand a card and re-check — confirm the distance row now appears with a value in meters, mono font.

Verify the "Öppna i kartor" link's `href` is a well-formed Google Maps search URL:
```
javascript_tool: document.querySelector(".card-nav-link")?.href
```
Expected: `https://www.google.com/maps/search/?api=1&query=<lat>,<lon>` with real numbers, not `NaN` or `undefined`.

Screenshot for final proof.

- [ ] **Step 5: Commit**

```bash
git add src/app.js style.css
git commit -m "feat: street name / Maps link / distance in card detail (spec §3)

Independent of the map-view toggle per spec — street name silently
omitted when addr:street is missing (~51% of terraces), distance only
shown once findNearestMatching has populated entry.distanceMeters."
```

---

### Task 8: DESIGN.md token, full-flow regression pass, and final proof

**Files:**
- Modify: `DESIGN.md` (add `--color-position` to the color table and prose)
- Test: manual (full walkthrough, Steps 2–5 below)

**Interfaces:** none new — this task only documents the token added in task 6 and verifies the whole feature together.

- [ ] **Step 1: Add `--color-position` to `DESIGN.md`**

In the frontmatter `colors:` block, add after `confirm: "#82b085"`:
```yaml
  position: "#9a86c9"
```

In the "### Funktionella statusfärger" prose section, add a new bullet after the `**Bekräftat**` line:
```markdown
- **Position** (`#9a86c9`, `--color-position`): kart-lägets "Visa mig"-
  prick — en egen, avsiktligt icke-guld färg (se The One Gold Rule),
  tillagd 2026-08-19 för kart-/byggnadsvy-växlingen (se
  `docs/superpowers/specs/2026-08-18-map-view-toggle-design.md` §4).
```

- [ ] **Step 2: Full-flow manual walkthrough at desktop width**

```bash
npm start
```
Load `http://localhost:5500`. Walk the whole feature in one pass:
1. Confirm default mode is "Byggnader" on first load (no localStorage yet — clear it first if testing repeatedly: `javascript_tool: localStorage.removeItem("uteservering-sol:hero-view-mode")`).
2. Switch to "Karta" — confirm neighborhood-zoom default, building outlines, colored terrace dots.
3. Pan, zoom, click a dot — confirm it focuses the matching card.
4. Click "Visa mig" — confirm status text and (if permission granted) the position dot.
5. Switch back to "Byggnader" — confirm the isometric scene still works and the time slider still animates it.
6. Expand a card — confirm the nav line (street/Maps link/distance) appears correctly.
7. Reload the page — confirm "Karta" (the last-chosen mode) is what loads.

```
computer screenshot
```
at each major step (2, 4, 6) as proof.

- [ ] **Step 3: 375px mobile-width pass (PRODUCT.md's confirmed primary width)**

```
resize_window (preset: mobile, or width: 375)
```
Reload. Repeat steps 1–6 above at this width. Specifically confirm:
- The toggle buttons stack/fit without overflow (`.hero-view-toggle-button` at the `@media (max-width: 640px)` sizing from task 3).
- `#map-canvas` is 220px tall (task 3's mobile rule), matching `#iso-canvas`.
- The "Visa mig" button and status text don't overflow `.map-controls`' fixed position in the smaller canvas.

```
computer screenshot
```

- [ ] **Step 4: Touch-target and keyboard-access spot check**

Confirm every new control is ≥44×44px:
```
javascript_tool:
[...document.querySelectorAll("#hero-view-buildings-button, #hero-view-map-button, #map-locate-button")].map(el => {
  const r = el.getBoundingClientRect();
  return `${el.id}: ${r.width.toFixed(0)}x${r.height.toFixed(0)}`;
})
```
Expected: all three report width ≥44 and height ≥44.

Confirm keyboard access to the toggle buttons and "Visa mig" (all are real `<button>` elements per spec §6, so this should pass without extra work — verify it does):
```
computer key Tab (repeated from a known focus point, e.g. after clicking the search input)
```
until reaching `#hero-view-buildings-button`, `#hero-view-map-button`; confirm each shows a visible focus outline (the existing `:focus-visible` gold-outline rule from DESIGN.md's Inputs/Fields component should apply automatically since these are plain `<button>` elements — if it doesn't, that's a real finding to fix here, not defer).

Confirm the results list is still a full, independent path to every terrace regardless of hero mode (spec §6's persona note for Sam) — with "Karta" active, use Tab/Enter to reach and expand a card without ever touching the canvas:
```
computer key Tab (through to a card's .card-summary button)
computer key Enter
```
Expected: card expands normally, same as in "Byggnader" mode.

- [ ] **Step 5: Console error check and final commit**

```
read_console_messages (onlyErrors: true)
```
Expected: empty, across all the steps above.

```bash
git add DESIGN.md
git commit -m "docs: add --color-position token to DESIGN.md (spec §4)

Documents the position-dot color added in task 6. Closes out the
map-view-toggle feature — full flow verified at desktop and 375px
mobile widths, touch targets confirmed ≥44px, keyboard access to
toggle/Visa mig/results-list confirmed independent of hero mode."
```

Update `CLAUDE.md`'s Filkarta/status section to describe the shipped feature (mirroring how the 2026-08-16 redesign's entry was written) — this is documentation upkeep, not part of the spec, but matches this project's established practice of keeping `CLAUDE.md` as the map of what exists. Do this as a small follow-up edit, then a final commit:
```bash
git add CLAUDE.md
git commit -m "docs: record map-view-toggle feature in CLAUDE.md"
```

---

## Self-Review

**Spec coverage:**
- §1 Arkitektur (factory pattern, STATUS_COLORS truth) → Tasks 1, 2, 3, 4.
- §2 Växling/läges-minne/Standardvy → Task 3 (toggle+memory), Task 4 (default zoom).
- §3 Navigeringshjälp → Task 7.
- §4 Position i kartläget (button, error states, color token) → Task 6, Task 8 (DESIGN.md).
- §5 Prestanda (culling, exported grid functions) → Task 1, Task 4.
- §6 Tryckytor → Task 3 (toggle CSS), Task 6 (Visa mig CSS), Task 8 (verification).
- Testning checklist → covered across every task's manual-verification step; the full checklist is re-walked in Task 8.
- Explicit uteslutet (YAGNI) → nothing in this plan adds road geometry, `watchPosition`, a duplicated results list, or touches `taggning.html` — confirmed by construction, no task does any of these.

**Placeholder scan:** every step above has real code or a concrete, literal verification action (exact selector, exact expected string/value) — no "add appropriate handling" language, no "similar to task N" without repeated code.

**Type/signature consistency:** `createMapView(canvas, controlsEl, { onSelectTerrace })` and its returned `{ setData, render, panTo, hasScene }` are introduced in Task 3 and used with the exact same names and parameter shapes in Tasks 4–6 (`setData({buildings, entries, focusedTerraceId})`, `render({statusColorFor})`, `panTo(terraceId)`). `heroMode`/`renderHero()`/`applyHeroMode()`/`setHeroMode()` from Task 3 are the exact names Tasks 4–6's verification steps and Task 8's walkthrough refer back to. `STATUS_COLORS` (Task 2) is the exact name `renderHero()` (Task 3) reads from.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-19-map-view-toggle.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
