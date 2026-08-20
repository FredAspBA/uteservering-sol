import { loadData } from "./dataLoad.js";
import { computeShading } from "./shadow.js";
import { getSunInfo } from "./sun.js";
import { getVoteForView, recordVote, getAllVotes, clearAllVotes, exportVotesAsJson } from "./votes.js";
import { isFavorite, toggleFavorite, getAllFavorites, clearAllFavorites } from "./favorites.js";
import { fetchExcludedKeys } from "./cloudVotes.js";
import { fetchCloudForecast, findClosestForecast } from "./weather.js";
import { createIsoHero } from "./isoHero.js";
import { createMapView } from "./mapView.js";

const MALMO_CENTER = [55.605, 13.0038];

const STATUS_LABELS = {
  sun: "Sol",
  shade: "Skugga",
  night: "Mörkt",
  anomaly: "Osäker",
};

const STATUS_COLOR_VAR = {
  sun: "--color-sun",
  shade: "--color-shade",
  night: "--color-night",
  anomaly: "--color-anomaly",
};

const STATUS_RANK = { sun: 0, shade: 1, anomaly: 2, night: 3 };

// Read from the CSS custom properties (style.css) rather than duplicating
// hex values here, so the palette only ever lives in one place.
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export const STATUS_COLORS = {
  sun: cssVar("--color-sun"),
  shade: cssVar("--color-shade"),
  night: cssVar("--color-night"),
  anomaly: cssVar("--color-anomaly"),
};

const VOTE_RING_COLORS = {
  up: cssVar("--color-confirm"),
  down: cssVar("--color-anomaly"),
};

const dateInput = document.getElementById("date-input");
const datePrevButton = document.getElementById("date-prev");
const dateNextButton = document.getElementById("date-next");
const timeSlider = document.getElementById("time-slider");
const timeDisplay = document.getElementById("time-display");
const nowButton = document.getElementById("now-button");
const statusLine = document.getElementById("status-line");
const searchInput = document.getElementById("search-input");
const alcoholFilterCheckbox = document.getElementById("alcohol-filter");
const favoritesFilterCheckbox = document.getElementById("favorites-filter");
const searchStatus = document.getElementById("search-status");
const terraceNamesList = document.getElementById("terrace-names");
const voteCount = document.getElementById("vote-count");
const exportVotesButton = document.getElementById("export-votes-button");
const clearVotesButton = document.getElementById("clear-votes-button");
const nearMeButton = document.getElementById("near-me-button");
const nearMeAlcoholButton = document.getElementById("near-me-alcohol-button");
const resultsList = document.getElementById("results-list");
const loadMoreButton = document.getElementById("load-more-button");
const isoCanvas = document.getElementById("iso-canvas");
const isoHeroFocusEl = document.getElementById("iso-hero-focus");
const isoHeroMetaEl = document.getElementById("iso-hero-meta");
const isoHeroCaptionEl = document.getElementById("iso-hero-caption");
const heroViewBuildingsButton = document.getElementById("hero-view-buildings-button");
const heroViewMapButton = document.getElementById("hero-view-map-button");
const isoHeroSectionEl = document.getElementById("iso-hero");
const mapCanvas = document.getElementById("map-canvas");
const mapControlsEl = document.getElementById("map-controls");

const isoHero = createIsoHero(isoCanvas);
const mapView = createMapView(mapCanvas, mapControlsEl, {
  onSelectTerrace: (terraceId) => {
    const entry = entries.find((e) => e.terrace.id === terraceId);
    if (!entry) return;
    // Mirrors findNearestMatching()'s "jump to a possibly-not-yet-visible
    // entry" pattern below: expand visibleCount/renderVisibleList() before
    // focusing, so entry.card actually exists for focusEntry()/toggleExpand()
    // to act on instead of silently no-op-ing on a null card.
    const rank = filteredSorted.indexOf(entry);
    if (rank >= visibleCount) {
      visibleCount = rank + 1;
      renderVisibleList();
    }
    focusEntry(entry, { scroll: true });
    if (entry.card && !entry.expanded) toggleExpand(entry);
  },
});

let terraces = [];
let buildings = null;
let entries = [];
let filteredSorted = [];
let visibleCount = 0;
let focusedEntry = null;

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
  // The static HTML label ("Skuggkarta för valt resultat") describes the
  // isometric shadow scene specifically and reads as wrong once the map is
  // showing instead — keep it accurate to whichever view is actually live.
  isoHeroSectionEl.setAttribute("aria-label", isMap ? "Karta för valt resultat" : "Skuggkarta för valt resultat");
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

// Reconcile the DOM (aria-pressed, hidden canvases/controls) to heroMode
// immediately — not only after init()'s data fetch resolves. Safe to call
// before any data has loaded: renderHero() early-returns with no
// focusedEntry, and mapView.render() no-ops safely on a null scene. Without
// this, a returning "Karta"-mode user sees "Byggnader" pressed throughout
// the multi-second cold-load, and — worse — if init()'s fetch throws before
// its own applyHeroMode() call, the toggle button is left permanently out
// of sync with heroMode (see final whole-branch review finding #4).
applyHeroMode();

// Fetched once, in the background, without blocking the main data load
// below — it's a "nice to have" card badge, not something worth delaying
// the page for. By the time any card can actually be rendered (after
// init() finishes), this has almost always long since resolved; null just
// means "no cloud badge yet/at all", which weatherHtml() already handles.
let cloudForecast = null;
fetchCloudForecast(MALMO_CENTER[0], MALMO_CENTER[1]).then((data) => {
  cloudForecast = data;
});

function minutesToHHMM(minutes) {
  const h = Math.floor(minutes / 60)
    .toString()
    .padStart(2, "0");
  const m = (minutes % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

function dateFromInputs() {
  const [year, month, day] = dateInput.value.split("-").map(Number);
  const minutes = Number(timeSlider.value);
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return new Date(year, month - 1, day, hours, mins, 0);
}

function setInputsToNow() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  dateInput.value = `${yyyy}-${mm}-${dd}`;
  timeSlider.value = String(now.getHours() * 60 + now.getMinutes());
  timeDisplay.textContent = minutesToHHMM(Number(timeSlider.value));
}

function stepDate(days) {
  const [year, month, day] = dateInput.value.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  d.setDate(d.getDate() + days);
  dateInput.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  recompute();
}

function predictionSnapshot(result) {
  return {
    status: result.status,
    altitudeDeg: Number(result.sunInfo.altitudeDeg.toFixed(2)),
    bearingDeg: Number(result.sunInfo.bearingDeg.toFixed(1)),
    blockerName: result.blocker?.name ?? null,
    distanceMeters: result.blocker?.distanceMeters ?? null,
  };
}

function computeOne(terrace, date) {
  const [lon, lat] = terrace.point.geometry.coordinates;
  const sunInfo = getSunInfo(lat, lon, date);
  return computeShading(terrace.point, buildings, sunInfo, terrace.homeBuilding);
}

// ---------- Mini day-timeline ----------
// Computed on demand (only for the terrace whose card is expanded, see
// ensureTimeline()) rather than for all terraces up front — a single
// terrace's 48 half-hour samples is cheap; doing that for ~900 terraces on
// every load would not be.
const TIMELINE_STEP_MINUTES = 30;
const timelineCache = new Map(); // `${terraceId}|${dateOnly}` -> points array

function computeTimeline(terrace, dateOnly) {
  const [year, month, day] = dateOnly.split("-").map(Number);
  const points = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += TIMELINE_STEP_MINUTES) {
    const date = new Date(year, month - 1, day, Math.floor(minutes / 60), minutes % 60);
    const { status } = computeOne(terrace, date);
    points.push({ minutes, status });
  }
  return points;
}

function timelineHtml(points, currentMinutes) {
  const width = 224;
  const height = 22;
  const barWidth = width / points.length;
  const bars = points
    .map((p, i) => {
      const varName = STATUS_COLOR_VAR[p.status] ?? STATUS_COLOR_VAR.night;
      return `<rect x="${(i * barWidth).toFixed(1)}" y="0" width="${(barWidth + 0.5).toFixed(1)}" height="${height}" fill="var(${varName})" />`;
    })
    .join("");
  const hourMarks = [0, 6, 12, 18, 24]
    .map((h) => {
      const x = (h / 24) * width;
      return `<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="var(--color-surface)" stroke-width="1" opacity="0.5" />`;
    })
    .join("");
  const nowX = (currentMinutes / (24 * 60)) * width;
  return `
    <svg class="timeline-svg" viewBox="0 0 ${width} ${height + 12}" width="${width}" height="${height + 12}">
      ${bars}
      ${hourMarks}
      <line x1="${nowX}" y1="-2" x2="${nowX}" y2="${height + 2}" stroke="var(--color-ink)" stroke-width="1.5" />
      <text x="0" y="${height + 10}" font-family="var(--font-mono)" font-size="8" fill="var(--color-ink-muted)">00</text>
      <text x="${width / 2}" y="${height + 10}" font-family="var(--font-mono)" font-size="8" fill="var(--color-ink-muted)" text-anchor="middle">12</text>
      <text x="${width}" y="${height + 10}" font-family="var(--font-mono)" font-size="8" fill="var(--color-ink-muted)" text-anchor="end">24</text>
    </svg>
  `;
}

function timelineSectionHtml(entry) {
  const dateOnly = dateInput.value;
  if (entry.timelineDateOnly === dateOnly && entry.timelinePoints) {
    return timelineHtml(entry.timelinePoints, Number(timeSlider.value));
  }
  return `<span class="timeline-loading">Laddar dagsöversikt…</span>`;
}

// Only ever called for an entry whose card detail is expanded, so this
// never runs for all ~900 terraces in a row.
function ensureTimeline(entry) {
  const dateOnly = dateInput.value;
  if (entry.timelineDateOnly === dateOnly && entry.timelinePoints) return;

  const cacheKey = `${entry.terrace.id}|${dateOnly}`;
  let points = timelineCache.get(cacheKey);
  if (!points) {
    points = computeTimeline(entry.terrace, dateOnly);
    timelineCache.set(cacheKey, points);
  }
  entry.timelinePoints = points;
  entry.timelineDateOnly = dateOnly;
  if (entry.expanded && entry.card) {
    const timelineEl = entry.card.querySelector(".card-timeline");
    if (timelineEl) timelineEl.innerHTML = timelineSectionHtml(entry);
  }
}

// ---------- Venue type & alcohol ----------
const VENUE_LABELS = {
  restaurant: "Restaurang",
  cafe: "Kafé",
  fast_food: "Snabbmat",
  bakery: "Bageri",
  confectionery: "Konditori",
  ice_cream: "Glass",
  bar: "Bar",
  pub: "Pub",
  biergarten: "Ölträdgård",
  food_court: "Food court",
  outdoor_seating: "Uteservering",
};

/**
 * Reads the venue category and what we can honestly say about alcohol.
 *
 * Alcohol is barely tagged in OSM here — only ~4 of ~940 places carry an
 * explicit alcohol tag — so most places genuinely are unknown and are
 * reported as such rather than guessed at. The one sound inference is by
 * category: OSM defines amenity=bar/pub/biergarten as establishments that
 * sell alcoholic drinks, so those are definitional, not a guess. Restaurants
 * and cafes are deliberately NOT inferred either way: plenty of Malmo
 * restaurants have no license and plenty of cafes serve wine.
 */
function venueInfo(properties = {}) {
  const key = properties.amenity || properties.shop || properties.leisure;
  const typeLabel = VENUE_LABELS[key] || null;

  const alcoholByCategory = key === "bar" || key === "pub" || key === "biergarten";
  const explicit = properties.alcohol;
  const microbrewery = properties.microbrewery === "yes";

  let alcohol = "unknown";
  if (explicit === "no") alcohol = "no";
  else if (explicit === "yes" || alcoholByCategory || microbrewery) alcohol = "yes";

  return { typeLabel, alcohol };
}

function venueLineHtml(properties = {}) {
  const { typeLabel, alcohol } = venueInfo(properties);
  const parts = [];
  if (typeLabel) parts.push(`<span class="venue-type">${escapeHtml(typeLabel)}</span>`);
  if (alcohol === "yes") parts.push(`<span class="venue-alcohol yes">🍷 Serverar alkohol</span>`);
  else if (alcohol === "no") parts.push(`<span class="venue-alcohol no">Ingen alkohol</span>`);
  else parts.push(`<span class="venue-alcohol unknown" title="OpenStreetMap saknar uppgift om alkohol för det här stället">Alkohol: okänt</span>`);
  return parts.length ? `<div class="card-venue-line">${parts.join("")}</div>` : "";
}

// Fas 5, del B: a place from Malmö stads serveringstillstånd-register with
// no OSM entry at all. Geokodad adress (ofta gatan snarare än exakt hus —
// se scripts/geocode-unverified-venues.js), inte en OSM-position. Måste
// aldrig se ut som verifierad data.
function unverifiedNoticeHtml(properties, lat, lon) {
  if (properties?.verified !== false) return "";
  const editUrl = `https://www.openstreetmap.org/edit#map=19/${lat}/${lon}`;
  return `
    <div class="card-unverified">
      ⚠️ Inte i OpenStreetMap ännu — läget är en ungefärlig geokodning
      av adressen, inte en exakt position. Finns i Malmö stads
      serveringstillståndsregister.
      <a href="${editUrl}" target="_blank" rel="noopener noreferrer">➕ Lägg till i OSM</a>
    </div>
  `;
}

// Adds a cloud-cover caveat to a "Sol" verdict — the shadow calculation
// only knows the sun's geometric position, not whether clouds would
// actually block it. Only relevant for status "sun" and only when the
// viewed moment is within SMHI's forecast window (findClosestForecast()
// returns null outside it — see weather.js).
function weatherHtml(status, lastViewedAt) {
  if (status !== "sun") return "";
  const forecast = findClosestForecast(cloudForecast, new Date(lastViewedAt));
  if (!forecast) return "";
  const { clearPercent } = forecast;
  let note;
  if (clearPercent >= 75) note = "sannolikt klar himmel";
  else if (clearPercent >= 40) note = "delvis molnigt";
  else note = "mest molnigt — solen kan vara skymd";
  return `<div class="card-weather">☁️ SMHI-prognos: ${note} (${clearPercent} % molnfritt)</div>`;
}

// Small status glyphs (same shapes as the legend chips) sized for a
// result card — a leaf for shade specifically encodes *why* (shaded like
// under foliage), not just "a different color than sun".
const STATUS_ICON_CLASS = { sun: "icon-sun", shade: "icon-leaf", night: "icon-moon", anomaly: "icon-alert" };

const STATUS_ICON_SVG = {
  sun: `<svg class="card-status-icon icon-sun" viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="3.2" fill="currentColor" />
    <g stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
      <line x1="8" y1="1" x2="8" y2="2.6" /><line x1="8" y1="13.4" x2="8" y2="15" />
      <line x1="1" y1="8" x2="2.6" y2="8" /><line x1="13.4" y1="8" x2="15" y2="8" />
      <line x1="2.9" y1="2.9" x2="4" y2="4" /><line x1="12" y1="12" x2="13.1" y2="13.1" />
      <line x1="13.1" y1="2.9" x2="12" y2="4" /><line x1="4" y1="12" x2="2.9" y2="13.1" />
    </g>
  </svg>`,
  shade: `<svg class="card-status-icon icon-leaf" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2 13 C2 6 7 2 14 2 C14 9 10 13 3.5 13 Z" fill="currentColor" />
    <path d="M3 12.5 C6 9 9 6 13 2.5" stroke="var(--color-surface)" stroke-width="0.9" fill="none" stroke-linecap="round" />
  </svg>`,
  night: `<svg class="card-status-icon icon-moon" viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="6" fill="currentColor" /><circle cx="11" cy="6" r="5" fill="var(--color-surface)" />
  </svg>`,
  anomaly: `<svg class="card-status-icon icon-alert" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M8 1.5 L15 14.5 L1 14.5 Z" fill="currentColor" />
    <rect x="7.35" y="6" width="1.3" height="4.2" rx="0.6" fill="var(--color-surface)" />
    <circle cx="8" cy="12" r="0.9" fill="var(--color-surface)" />
  </svg>`,
};

function whySummary(result) {
  if (result.status === "sun") return "Fri sikt mot solen";
  if (result.status === "shade" && result.blocker) return `Skuggas av ${result.blocker.name} · ${result.blocker.distanceMeters.toFixed(0)} m`;
  if (result.status === "anomaly") return "Punkten ligger i en byggnad";
  return "";
}

function explainHtml(result) {
  const { status, blocker, sunInfo } = result;
  let detail = `Solhöjd: ${sunInfo.altitudeDeg.toFixed(1)}°, riktning mot solen: ${sunInfo.bearingDeg.toFixed(0)}°`;
  if (status === "shade" && blocker) {
    detail += `<br>Skuggas av ${escapeHtml(blocker.name)} (${blocker.distanceMeters.toFixed(0)} m bort, behöver ≥${blocker.requiredHeightMeters.toFixed(
      1
    )} m, är ${blocker.actualHeightMeters.toFixed(1)} m)`;
  }
  if (status === "anomaly") {
    detail += `<br>Punkten hamnar inuti en byggnad i kartdatan – gå inte i god för detta resultat.`;
  }
  return `<div class="card-explain">${detail}</div>`;
}

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
    <div class="card-actions">
      <div class="card-vote" title="Stämmer sol/skugga-bedömningen ovan med verkligheten just nu? Hjälper till att förbättra beräkningen framöver.">
        Stämmer det just nu?
        <button type="button" class="vote-btn vote-up ${vote === "up" ? "active" : ""}" data-vote="up">👍</button>
        <button type="button" class="vote-btn vote-down ${vote === "down" ? "active" : ""}" data-vote="down">👎</button>
      </div>
      <button type="button" class="favorite-btn ${isFav ? "active" : ""}" data-favorite="${terrace.id}" title="Spara som favorit">
        ${isFav ? "⭐" : "☆"}
      </button>
    </div>
  `;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function updateVoteCount() {
  const n = getAllVotes().length;
  voteCount.textContent = n === 1 ? "1 bedömning loggad" : `${n} bedömningar loggade`;
}

// Re-attaches vote/favorite click handlers inside an expanded card's detail
// region. Needed after every detail refresh (setting .innerHTML replaces
// the nodes and with them any previously bound listeners). Using onclick
// (not addEventListener) means re-wiring never stacks up duplicate
// handlers on the same node.
function wireCardActions(entry) {
  const detailEl = entry.card?.querySelector(".card-detail");
  if (!detailEl) return;
  detailEl.querySelectorAll(".vote-btn").forEach((btn) => {
    btn.onclick = () => {
      recordVote(entry.terrace.id, entry.terrace.name, entry.lastViewedAt, predictionSnapshot(entry.lastResult), btn.dataset.vote);
      updateVoteCount();
      refreshCardDetail(entry);
    };
  });
  const favoriteBtn = detailEl.querySelector(".favorite-btn");
  if (favoriteBtn) {
    favoriteBtn.onclick = () => {
      toggleFavorite(entry.terrace.id);
      refreshCardDetail(entry);
      if (favoritesFilterCheckbox.checked) applyFilters({ preserveVisibleCount: true });
    };
  }
}

function refreshCardDetail(entry) {
  const detailEl = entry.card?.querySelector(".card-detail");
  if (!detailEl || !entry.lastResult) return;
  detailEl.innerHTML = cardDetailHtml(entry);
  wireCardActions(entry);
  ensureTimeline(entry);
}

function toggleExpand(entry) {
  entry.expanded = !entry.expanded;
  const summaryEl = entry.card.querySelector(".card-summary");
  const detailEl = entry.card.querySelector(".card-detail");
  summaryEl.setAttribute("aria-expanded", String(entry.expanded));
  detailEl.hidden = !entry.expanded;
  if (entry.expanded) refreshCardDetail(entry);
}

function cardSummaryInnerHtml(entry) {
  const { terrace, lastResult: result } = entry;
  const label = STATUS_LABELS[result.status];
  return `
    ${STATUS_ICON_SVG[result.status] ?? STATUS_ICON_SVG.night}
    <span class="card-main">
      <span class="card-name">${escapeHtml(terrace.name)}</span>
      ${venueLineHtml(terrace.feature?.properties)}
    </span>
    <span class="card-figures">
      <span class="card-status-label ${result.status}">${label}</span>
      <span class="card-why">${escapeHtml(whySummary(result))}${entry.distanceMeters != null ? ` · ${Math.round(entry.distanceMeters)} m` : ""}</span>
      <span class="card-altitude">Solhöjd: ${result.sunInfo.altitudeDeg.toFixed(1)}°</span>
    </span>
    <svg class="card-chevron" viewBox="0 0 12 8" aria-hidden="true"><path d="M1 1 L6 6 L11 1" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>
  `;
}

/** Builds a card's DOM once. Called only when an entry enters the
 * rendered/visible set (renderVisibleList()) — NOT on every recompute()
 * tick, which only patches existing cards (see refreshCardSummary()). */
function buildCardNode(entry) {
  const node = document.createElement("article");
  node.className = "terrace-card";
  node.dataset.status = entry.lastResult.status;

  const summary = document.createElement("button");
  summary.type = "button";
  summary.className = "card-summary";
  summary.setAttribute("aria-expanded", "false");
  const detailId = `detail-${String(entry.terrace.id).replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  summary.setAttribute("aria-controls", detailId);
  summary.innerHTML = cardSummaryInnerHtml(entry);
  summary.addEventListener("click", () => {
    focusEntry(entry);
    toggleExpand(entry);
  });

  const detail = document.createElement("div");
  detail.className = "card-detail";
  detail.id = detailId;
  detail.hidden = true;

  node.appendChild(summary);
  node.appendChild(detail);
  entry.card = node;
  entry.expanded = false;
  return node;
}

/** Cheap per-tick patch of an already-rendered card: status text/classes,
 * "why" line, sun altitude, left-border color (via data-status) — mirrors
 * the old Leaflet build's marker.setStyle(), the one thing every visible
 * card needs updated every recompute(). Rebuilding the card's innerHTML
 * here (all ~24 visible cards, every slider tick) was measured as the
 * obvious next bottleneck once markers became cards, so this only ever
 * touches text nodes and a class list, never .innerHTML. */
function refreshCardSummary(entry) {
  if (!entry.card) return;
  const { lastResult: result } = entry;
  entry.card.dataset.status = result.status;
  const label = entry.card.querySelector(".card-status-label");
  label.textContent = STATUS_LABELS[result.status];
  label.className = `card-status-label ${result.status}`;
  const why = entry.card.querySelector(".card-why");
  why.textContent = whySummary(result) + (entry.distanceMeters != null ? ` · ${Math.round(entry.distanceMeters)} m` : "");
  entry.card.querySelector(".card-altitude").textContent = `Solhöjd: ${result.sunInfo.altitudeDeg.toFixed(1)}°`;
  const currentIcon = entry.card.querySelector(".card-summary svg.card-status-icon");
  if (currentIcon && !currentIcon.classList.contains(STATUS_ICON_CLASS[result.status])) {
    currentIcon.outerHTML = STATUS_ICON_SVG[result.status] ?? STATUS_ICON_SVG.night;
  }
  if (entry.expanded) refreshCardDetail(entry);
}

function compareEntries(a, b) {
  const ra = STATUS_RANK[a.lastResult?.status] ?? 4;
  const rb = STATUS_RANK[b.lastResult?.status] ?? 4;
  if (ra !== rb) return ra - rb;
  if (a.distanceMeters != null && b.distanceMeters != null) return a.distanceMeters - b.distanceMeters;
  if (a.distanceMeters != null) return -1;
  if (b.distanceMeters != null) return 1;
  return a.terrace.name.localeCompare(b.terrace.name, "sv");
}

function renderVisibleList() {
  resultsList.replaceChildren();
  const visible = filteredSorted.slice(0, visibleCount);
  if (!visible.length) {
    const empty = document.createElement("p");
    empty.className = "results-empty";
    empty.textContent = "Inga uteserveringar matchar just nu.";
    resultsList.appendChild(empty);
  }
  for (const entry of visible) {
    resultsList.appendChild(buildCardNode(entry));
    if (entry === focusedEntry) entry.card.classList.add("is-focused");
  }
  const remaining = filteredSorted.length - visible.length;
  if (remaining > 0) {
    loadMoreButton.hidden = false;
    loadMoreButton.textContent = `Visa fler (${Math.min(remaining, LOAD_MORE_STEP)} till, ${remaining} kvar)`;
  } else {
    loadMoreButton.hidden = true;
  }
}

loadMoreButton.addEventListener("click", () => {
  visibleCount += LOAD_MORE_STEP;
  renderVisibleList();
});

/** Sets the isometric hero + card highlight to `entry`. Gathering nearby
 * real buildings (isoHero.setFocus) only happens here, on a deliberate
 * focus change — not every recompute() tick, since the set of nearby
 * buildings doesn't depend on the time of day, only their shadow lengths
 * do (recomputed every tick in renderIsoHero() below). */
function focusEntry(entry, { scroll = false } = {}) {
  if (focusedEntry?.card) focusedEntry.card.classList.remove("is-focused");
  focusedEntry = entry;
  entry.card?.classList.add("is-focused");
  isoHero.setFocus(entry.terrace, buildings);
  mapView.panTo(entry.terrace.id);
  mapView.setFocusedTerrace(entry.terrace.id);
  renderHero();
  if (scroll) entry.card?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function renderIsoHero() {
  if (!focusedEntry?.lastResult) return;
  const { terrace, lastResult: result } = focusedEntry;
  isoHeroFocusEl.textContent = terrace.name;
  isoHeroMetaEl.textContent = `Solhöjd ${result.sunInfo.altitudeDeg.toFixed(1)}° · riktning ${result.sunInfo.bearingDeg.toFixed(0)}°`;
  isoHeroCaptionEl.innerHTML =
    result.status === "shade" && result.blocker
      ? `<strong>${escapeHtml(terrace.name)}</strong> skuggas av <strong>${escapeHtml(result.blocker.name)}</strong>, ${result.blocker.distanceMeters.toFixed(
          0
        )} m bort (behöver ≥${result.blocker.requiredHeightMeters.toFixed(1)} m, är ${result.blocker.actualHeightMeters.toFixed(1)} m). Guld i kartan = den byggnaden.`
      : result.status === "sun"
      ? `<strong>${escapeHtml(terrace.name)}</strong> har fri sikt mot solen just nu — ingen byggnad inom räckhåll når över.`
      : result.status === "anomaly"
      ? `Osäkert underlag: punkten ligger inuti en byggnad i kartdatan.`
      : `Solen är under horisonten.`;
  isoHero.render({ sunInfo: result.sunInfo, statusColor: STATUS_COLORS[result.status] });
}

// Map-mode counterpart to renderIsoHero() above — same focus/meta text
// (terrace name, altitude/bearing), but a caption describing the top-down
// map instead of the isometric building scene. Without this, the head/
// caption text stayed stuck describing the isometric view even while the
// map was showing (final whole-branch review finding #2): on a fresh load
// that starts in "Karta" mode, #iso-hero-focus never left its static HTML
// placeholder even though a terrace was actually focused and ringed gold
// on the map canvas.
function renderMapHero() {
  const { terrace, lastResult: result } = focusedEntry;
  isoHeroFocusEl.textContent = terrace.name;
  isoHeroMetaEl.textContent = `Solhöjd ${result.sunInfo.altitudeDeg.toFixed(1)}° · riktning ${result.sunInfo.bearingDeg.toFixed(0)}°`;
  isoHeroCaptionEl.innerHTML =
    "Uteserveringar och byggnader uppifrån. Dra för att panorera, scrolla för att zooma — färgen visar sol/skugga just nu.";
  mapView.render({ statusColorFor: (status) => STATUS_COLORS[status] ?? STATUS_COLORS.night });
}

function renderHero() {
  if (!focusedEntry?.lastResult) return;
  if (heroMode === "buildings") {
    renderIsoHero();
  } else {
    renderMapHero();
  }
}

function renderResults() {
  entries = terraces.map((terrace) => ({
    terrace,
    card: null,
    expanded: false,
    lastResult: null,
    lastViewedAt: null,
    distanceMeters: null,
    timelinePoints: null,
    timelineDateOnly: null,
  }));

  // Search datalist via DOM properties, not an HTML string: escapeHtml()
  // escapes <,>,& but NOT double quotes, and a terrace name (world-editable
  // OSM data) containing a " would otherwise break out of value="...".
  const options = document.createDocumentFragment();
  for (const entry of entries) {
    const opt = document.createElement("option");
    opt.value = entry.terrace.name;
    options.appendChild(opt);
  }
  terraceNamesList.replaceChildren(options);
}

// A full recompute of all ~900 terraces measures ~150ms after the spatial-
// grid and ray-pre-filter optimizations in shadow.js, so chunked yielding
// is only a light safety valve for much slower devices, not a necessity.
//
// The yield itself uses MessageChannel rather than setTimeout(0) on
// purpose: browsers clamp setTimeout in BACKGROUND tabs to >=1000ms per
// tick — see the original note in this file's git history for the
// measured 40-70s regression that caused.
const CHUNK_SIZE = 100;
const yieldChannel = new MessageChannel();
function yieldToBrowser() {
  return new Promise((resolve) => {
    yieldChannel.port1.onmessage = () => resolve();
    yieldChannel.port2.postMessage(null);
  });
}

let computeGeneration = 0;

async function recompute() {
  const generation = ++computeGeneration;
  const date = dateFromInputs();
  const viewedAt = date.toISOString();
  let sunCount = 0;
  let shadeCount = 0;
  let nightCount = 0;

  const centerSun = getSunInfo(MALMO_CENTER[0], MALMO_CENTER[1], date);

  for (let i = 0; i < entries.length; i++) {
    if (i > 0 && i % CHUNK_SIZE === 0) await yieldToBrowser();
    // A newer recompute() started (e.g. the user kept dragging the time
    // slider) — abandon this stale run rather than race it to the finish.
    if (generation !== computeGeneration) return;

    const entry = entries[i];
    const result = computeOne(entry.terrace, date);
    entry.lastResult = result;
    entry.lastViewedAt = viewedAt;

    // Only cards actually in the DOM get patched — see refreshCardSummary()'s
    // doc comment for why this (not the underlying compute above) is the
    // part that had to stay cheap.
    if (entry.card) refreshCardSummary(entry);

    if (result.status === "sun") sunCount++;
    else if (result.status === "shade") shadeCount++;
    else if (result.status === "night") nightCount++;
  }

  statusLine.textContent = `${date.toLocaleString("sv-SE")} — solhöjd i Malmö: ${centerSun.altitudeDeg.toFixed(
    1
  )}°. ${sunCount} i sol, ${shadeCount} i skugga${nightCount ? `, ${nightCount} i mörker` : ""} av ${terraces.length} uteserveringar.`;

  document.documentElement.style.setProperty("--day-progress", `${(Number(timeSlider.value) / 1439) * 100}%`);

  if (focusedEntry) renderHero();
}

// Combines the text search with the "Endast alkohol" and "Endast
// favoriter" checkboxes — all conditions must pass (AND). Runs on input in
// either control (see the event listeners below) and rebuilds the visible
// card list — a rare, user-driven event, unlike recompute()'s per-tick
// patch path above, so a full rebuild here is not the cost that mattered.
function applyFilters({ preserveVisibleCount = false } = {}) {
  const query = searchInput.value.trim().toLowerCase();
  const alcoholOnly = alcoholFilterCheckbox.checked;
  const favoritesOnly = favoritesFilterCheckbox.checked;

  filteredSorted = entries
    .filter((entry) => {
      const nameMatches = !query || entry.terrace.name.toLowerCase().includes(query);
      const alcoholMatches = !alcoholOnly || servesAlcohol(entry);
      const favoriteMatches = !favoritesOnly || isFavorite(entry.terrace.id);
      return nameMatches && alcoholMatches && favoriteMatches;
    })
    .sort(compareEntries);

  mapView.setData({ buildings, entries: filteredSorted, focusedTerraceId: focusedEntry?.terrace.id ?? null });

  if (!preserveVisibleCount) visibleCount = INITIAL_VISIBLE;
  renderVisibleList();

  // Tracks whether this call already triggered a renderHero() via
  // focusEntry() (which calls it internally) — so the unconditional
  // renderHero() at the end below doesn't fire redundantly right after one
  // of those paths, while still firing on every other filter-change path
  // (e.g. ticking a checkbox with an entry already focused), which is what
  // final whole-branch review finding #1 was about: without it, the map
  // canvas's data got updated (mapView.setData() above) but never repainted.
  let focusedThisCall = false;

  if (query) {
    searchStatus.textContent = `${filteredSorted.length} träff${filteredSorted.length === 1 ? "" : "ar"}`;
    if (filteredSorted.length === 1) {
      focusEntry(filteredSorted[0], { scroll: true });
      focusedThisCall = true;
      if (filteredSorted[0].card) toggleExpand(filteredSorted[0]);
    }
  } else if (alcoholOnly || favoritesOnly) {
    const parts = [];
    if (alcoholOnly) parts.push("alkohol");
    if (favoritesOnly) parts.push("favoriter");
    searchStatus.textContent = `${filteredSorted.length} ställe${filteredSorted.length === 1 ? "" : "n"} med ${parts.join(" och ")}`;
  } else {
    searchStatus.textContent = "";
  }

  if (!focusedEntry && filteredSorted.length) {
    focusEntry(filteredSorted[0]);
    focusedThisCall = true;
  }

  if (!focusedThisCall) renderHero();
}

// ---------- "Nearest sunny terrace to me" ----------
const EARTH_RADIUS_M = 6371000;
function haversineMeters(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/**
 * Shared "nearest terrace matching some condition, to my location" flow —
 * used by both the sun-only and sun+alcohol buttons. Geolocation is only
 * ever read into a local variable to sort by distance and is never stored,
 * logged, or sent anywhere; the browser's own permission prompt gates
 * access. Distances are computed for EVERY entry (not just matches) so the
 * whole list re-sorts by "closest first" once known, same as before.
 *
 * @param {(entry) => boolean} predicate - which terraces qualify as "found"
 * @param {{ found: (name, meters) => string, none: string }} messages
 */
function findNearestMatching(predicate, messages) {
  if (!navigator.geolocation) {
    searchStatus.textContent = "Din webbläsare stödjer inte platsdelning.";
    return;
  }
  const matches = entries.filter(predicate);
  if (!matches.length) {
    searchStatus.textContent = messages.none;
    return;
  }
  searchStatus.textContent = "Hämtar din plats…";
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      for (const entry of entries) {
        const [lon, lat] = entry.terrace.point.geometry.coordinates;
        entry.distanceMeters = haversineMeters(latitude, longitude, lat, lon);
      }
      let closest = null;
      let closestDist = Infinity;
      for (const entry of matches) {
        if (entry.distanceMeters < closestDist) {
          closestDist = entry.distanceMeters;
          closest = entry;
        }
      }
      searchStatus.textContent = messages.found(closest.terrace.name, Math.round(closestDist));
      applyFilters({ preserveVisibleCount: false });
      const rank = filteredSorted.indexOf(closest);
      if (rank >= visibleCount) {
        visibleCount = rank + 1;
        renderVisibleList();
      }
      focusEntry(closest, { scroll: true });
      if (closest.card && !closest.expanded) toggleExpand(closest);
    },
    (err) => {
      searchStatus.textContent = err.code === err.PERMISSION_DENIED ? "Platsdelning nekades — kan inte hitta närmaste." : "Kunde inte hämta din plats just nu.";
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
  );
}

const servesAlcohol = (entry) => venueInfo(entry.terrace.feature?.properties).alcohol === "yes";

function findNearestSunny() {
  findNearestMatching((entry) => entry.lastResult?.status === "sun", {
    found: (name, m) => `Närmast med sol: ${name} (${m} m bort)`,
    none: "Ingen uteservering har sol just nu.",
  });
}

function findNearestSunnyWithAlcohol() {
  findNearestMatching((entry) => entry.lastResult?.status === "sun" && servesAlcohol(entry), {
    found: (name, m) => `Närmast med sol & alkohol: ${name} (${m} m bort)`,
    none: "Ingen uteservering med (känd) alkohol har sol just nu.",
  });
}

function downloadVotesJson() {
  const blob = new Blob([exportVotesAsJson()], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `uteservering-sol-bedomningar-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function debounce(fn, ms) {
  let handle;
  return (...args) => {
    clearTimeout(handle);
    handle = setTimeout(() => fn(...args), ms);
  };
}

const debouncedRecompute = debounce(recompute, 80);

dateInput.addEventListener("change", recompute);
datePrevButton.addEventListener("click", () => stepDate(-1));
dateNextButton.addEventListener("click", () => stepDate(1));
timeSlider.addEventListener("input", () => {
  timeDisplay.textContent = minutesToHHMM(Number(timeSlider.value));
  document.documentElement.style.setProperty("--day-progress", `${(Number(timeSlider.value) / 1439) * 100}%`);
  debouncedRecompute();
});
nowButton.addEventListener("click", () => {
  setInputsToNow();
  recompute();
});
searchInput.addEventListener("input", debounce(() => applyFilters(), 120));
alcoholFilterCheckbox.addEventListener("change", () => applyFilters());
favoritesFilterCheckbox.addEventListener("change", () => applyFilters());
exportVotesButton.addEventListener("click", downloadVotesJson);
clearVotesButton.addEventListener("click", () => {
  if (getAllVotes().length && !confirm("Rensa alla dina loggade bedömningar på den här enheten?")) return;
  clearAllVotes();
  updateVoteCount();
  recompute();
});
nearMeButton.addEventListener("click", findNearestSunny);
nearMeAlcoholButton.addEventListener("click", findNearestSunnyWithAlcohol);

async function init() {
  setInputsToNow();
  statusLine.textContent = "Ställer in solvinkeln och mäter upp skuggorna…";
  updateVoteCount();
  try {
    // Fetch the shared "hide from app" list and the terrace/building data in
    // parallel. Excluded = places marked exclude=true or outdoor="no" in the
    // collaborative tagging list (taggning.html). If the fetch fails, the set
    // is empty and everything is shown — the app never depends on Firebase.
    const [data, excludedKeys] = await Promise.all([loadData(), fetchExcludedKeys()]);
    buildings = data.buildings;
    terraces = data.terraces.filter((t) => !excludedKeys.has(String(t.id).replace("/", "_")));
    renderResults();
    await recompute();
    // No applyHeroMode() call here: the module-load-time call above already
    // synced the DOM to heroMode (it doesn't change during this load unless
    // the user clicks the toggle, which calls applyHeroMode() itself), and
    // applyFilters() below focuses an entry (via focusEntry(), which calls
    // renderHero() itself) whenever one isn't already focused — so hero
    // content is already correctly rendered by the time this try block ends.
    applyFilters();
  } catch (err) {
    statusLine.textContent = `Kunde inte ladda data: ${err.message}. Har du kört "npm run fetch-data"?`;
    console.error(err);
  }
}

init();
