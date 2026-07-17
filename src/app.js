import { loadData } from "./dataLoad.js";
import { computeShading } from "./shadow.js";
import { getSunInfo } from "./sun.js";
import { getVoteForView, recordVote, getAllVotes, clearAllVotes, exportVotesAsJson } from "./votes.js";

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

// Read from the CSS custom properties (style.css) rather than duplicating
// hex values here, so the palette only ever lives in one place.
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const STATUS_COLORS = {
  sun: cssVar("--color-sun"),
  shade: cssVar("--color-shade"),
  night: cssVar("--color-night"),
  anomaly: cssVar("--color-anomaly"),
};

const VOTE_STROKE_COLORS = {
  up: cssVar("--color-confirm"),
  down: cssVar("--color-anomaly"),
  none: cssVar("--color-ink"),
};

const map = L.map("map").setView(MALMO_CENTER, 16);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap-bidragsgivare",
  maxZoom: 19,
}).addTo(map);
const markersLayer = L.layerGroup().addTo(map);

const dateInput = document.getElementById("date-input");
const timeSlider = document.getElementById("time-slider");
const timeDisplay = document.getElementById("time-display");
const nowButton = document.getElementById("now-button");
const statusLine = document.getElementById("status-line");
const searchInput = document.getElementById("search-input");
const searchStatus = document.getElementById("search-status");
const terraceNamesList = document.getElementById("terrace-names");
const voteCount = document.getElementById("vote-count");
const exportVotesButton = document.getElementById("export-votes-button");
const clearVotesButton = document.getElementById("clear-votes-button");
const nearMeButton = document.getElementById("near-me-button");

let terraces = [];
let buildings = null;
let markers = [];

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
// Computed on demand (only for the terrace whose popup is open, see
// ensureTimeline()) rather than for all terraces up front — a single
// terrace's 48 half-hour samples is cheap; doing that for ~200 terraces
// on every load would not be.
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

// Only ever called for a terrace whose popup is open (see popupopen
// handler below), so this never runs 200 times in a row.
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
  if (entry.marker.isPopupOpen()) {
    entry.marker.setPopupContent(popupHtml(entry));
    updateMarkerVoteStroke(entry.marker, entry.terrace.id, entry.lastViewedAt);
    wireVoteButtons(entry);
  }
}

function popupHtml(entry) {
  const { terrace, lastResult: result, lastViewedAt } = entry;
  const { status, blocker, sunInfo } = result;
  const label = STATUS_LABELS[status];
  let detail = `Solhöjd: ${sunInfo.altitudeDeg.toFixed(1)}°, riktning mot solen: ${sunInfo.bearingDeg.toFixed(0)}°`;
  if (status === "shade" && blocker) {
    // blocker.name comes straight from an OSM building's name/addr:street
    // tag — world-editable data, so it must be escaped like any other
    // untrusted string before landing in innerHTML (see escapeHtml below).
    detail += `<br>Skuggas av ${escapeHtml(blocker.name)} (${blocker.distanceMeters.toFixed(0)} m bort, behöver ≥${blocker.requiredHeightMeters.toFixed(
      1
    )} m, är ${blocker.actualHeightMeters.toFixed(1)} m)`;
  }
  if (status === "anomaly") {
    detail += `<br>Punkten hamnar inuti en byggnad i kartdatan – gå inte i god för detta resultat.`;
  }

  const vote = getVoteForView(terrace.id, lastViewedAt);
  return `
    <div class="popup-title">${escapeHtml(terrace.name)}</div>
    <div class="popup-status ${status}">${label}</div>
    <div class="popup-detail">${detail}</div>
    <div class="popup-timeline">${timelineSectionHtml(entry)}</div>
    <div class="popup-vote">
      Stämmer det just nu?
      <button type="button" class="vote-btn vote-up ${vote === "up" ? "active" : ""}" data-vote="up">👍</button>
      <button type="button" class="vote-btn vote-down ${vote === "down" ? "active" : ""}" data-vote="down">👎</button>
    </div>
  `;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function updateMarkerVoteStroke(marker, terraceId, viewedAt) {
  const vote = getVoteForView(terraceId, viewedAt);
  marker.setStyle({
    color: VOTE_STROKE_COLORS[vote ?? "none"],
    weight: vote ? 3 : 1.5,
  });
}

function updateVoteCount() {
  const n = getAllVotes().length;
  voteCount.textContent = n === 1 ? "1 bedömning loggad" : `${n} bedömningar loggade`;
}

// Re-attaches vote button click handlers. Needed after every popup content
// refresh (not just the initial popupopen), since setPopupContent replaces
// the popup's inner DOM nodes and with them any previously bound listeners.
// Using onclick (not addEventListener) means re-wiring never stacks up
// duplicate handlers on the same node.
function wireVoteButtons(entry) {
  const el = entry.marker.getPopup()?.getElement();
  if (!el) return;
  el.querySelectorAll(".vote-btn").forEach((btn) => {
    btn.onclick = () => {
      recordVote(
        entry.terrace.id,
        entry.terrace.name,
        entry.lastViewedAt,
        predictionSnapshot(entry.lastResult),
        btn.dataset.vote
      );
      updateVoteCount();
      // Deferred: Leaflet's "don't let map-level click handlers close this
      // popup" check walks the DOM ancestry when the click finishes
      // bubbling. Replacing the popup's content synchronously mid-bubble
      // detaches the very button the click originated on, so that check
      // finds no ancestors and the map treats it as a plain map click,
      // closing the popup. Waiting a tick lets the click finish first.
      setTimeout(() => {
        entry.marker.setPopupContent(popupHtml(entry));
        updateMarkerVoteStroke(entry.marker, entry.terrace.id, entry.lastViewedAt);
        wireVoteButtons(entry);
      }, 0);
    };
  });
}

function renderMarkers() {
  markersLayer.clearLayers();
  markers = [];

  for (const terrace of terraces) {
    const [lon, lat] = terrace.point.geometry.coordinates;
    const marker = L.circleMarker([lat, lon], {
      radius: 8,
      weight: 1.5,
      color: VOTE_STROKE_COLORS.none,
      fillOpacity: 0.92,
      className: "terrace-marker",
    }).addTo(markersLayer);
    marker.bindPopup("");

    const entry = {
      terrace,
      marker,
      lastResult: null,
      lastViewedAt: null,
      timelinePoints: null,
      timelineDateOnly: null,
    };
    marker.on("popupopen", () => {
      wireVoteButtons(entry);
      ensureTimeline(entry);
    });

    markers.push(entry);
  }

  terraceNamesList.innerHTML = terraces
    .map((t) => `<option value="${escapeHtml(t.name)}"></option>`)
    .join("");
}

// On a fresh page load, the first recompute() has to lazily buffer every
// nearby building it touches for the first time (see ensureBuffered() in
// shadow.js) — for ~200 terraces that's still enough synchronous work to
// visibly freeze the tab for several seconds. Yielding to the browser
// every CHUNK_SIZE terraces keeps the page responsive (repaints, accepts
// input) while it works through the rest. Later recomputes (time slider
// changes) reuse the now-memoized buffered geometry and finish inside a
// single chunk anyway, so this costs them nothing noticeable.
//
// (A Web Worker would offload this entirely instead of just chunking it,
// which is strictly better — but this environment's automated browser
// couldn't deliver worker postMessage events at all when tested, even for
// a trivial worker with no dependencies, so there was no way to verify a
// worker-based rewrite actually works before shipping it. Chunking is the
// same fix's proven-working fallback; revisit the worker if that gets
// re-tested successfully in a normal browser.)
const CHUNK_SIZE = 20;
const yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 0));

let computeGeneration = 0;

async function recompute() {
  const generation = ++computeGeneration;
  const date = dateFromInputs();
  const viewedAt = date.toISOString();
  let sunCount = 0;
  let shadeCount = 0;
  let nightCount = 0;

  const centerSun = getSunInfo(MALMO_CENTER[0], MALMO_CENTER[1], date);

  for (let i = 0; i < markers.length; i++) {
    if (i > 0 && i % CHUNK_SIZE === 0) await yieldToBrowser();
    // A newer recompute() started (e.g. the user kept dragging the time
    // slider) — abandon this stale run rather than race it to the finish.
    if (generation !== computeGeneration) return;

    const entry = markers[i];
    const { terrace, marker } = entry;
    const result = computeOne(terrace, date);
    entry.lastResult = result;
    entry.lastViewedAt = viewedAt;

    marker.setStyle({ fillColor: STATUS_COLORS[result.status] });
    updateMarkerVoteStroke(marker, terrace.id, viewedAt);
    marker.setPopupContent(popupHtml(entry));
    wireVoteButtons(entry);
    // If this terrace's popup is open and the date changed since its
    // timeline was last computed, popupHtml() just rendered a "loading"
    // placeholder above — nothing else re-triggers a refresh (ensureTimeline
    // otherwise only runs on popupopen), so without this the popup would be
    // stuck on "Laddar dagsöversikt…" forever whenever the date changes
    // while it's already open.
    if (marker.isPopupOpen()) ensureTimeline(entry);

    if (result.status === "sun") sunCount++;
    else if (result.status === "shade") shadeCount++;
    else if (result.status === "night") nightCount++;
  }

  statusLine.textContent = `${date.toLocaleString("sv-SE")} — solhöjd i Malmö: ${centerSun.altitudeDeg.toFixed(
    1
  )}°. ${sunCount} i sol, ${shadeCount} i skugga${nightCount ? `, ${nightCount} i mörker` : ""} av ${terraces.length} uteserveringar.`;

  document.documentElement.style.setProperty("--day-progress", `${(Number(timeSlider.value) / 1439) * 100}%`);
}

function applySearchFilter() {
  const query = searchInput.value.trim().toLowerCase();
  const matches = [];

  for (const entry of markers) {
    const isMatch = !query || entry.terrace.name.toLowerCase().includes(query);
    if (isMatch) {
      if (!markersLayer.hasLayer(entry.marker)) markersLayer.addLayer(entry.marker);
      if (query) matches.push(entry);
    } else if (markersLayer.hasLayer(entry.marker)) {
      markersLayer.removeLayer(entry.marker);
    }
  }

  if (!query) {
    searchStatus.textContent = "";
    return;
  }

  searchStatus.textContent = `${matches.length} träff${matches.length === 1 ? "" : "ar"}`;
  if (matches.length === 1) {
    const [lon, lat] = matches[0].terrace.point.geometry.coordinates;
    map.flyTo([lat, lon], Math.max(map.getZoom(), 17));
    matches[0].marker.openPopup();
  }
}

// ---------- "Nearest sunny terrace to me" ----------
const EARTH_RADIUS_M = 6371000;
function haversineMeters(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

function findNearestSunny() {
  if (!navigator.geolocation) {
    searchStatus.textContent = "Din webbläsare stödjer inte platsdelning.";
    return;
  }
  searchStatus.textContent = "Hämtar din plats…";
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      const sunny = markers.filter((entry) => entry.lastResult?.status === "sun");
      if (!sunny.length) {
        searchStatus.textContent = "Ingen uteservering har sol just nu.";
        return;
      }
      let closest = null;
      let closestDist = Infinity;
      for (const entry of sunny) {
        const [lon, lat] = entry.terrace.point.geometry.coordinates;
        const d = haversineMeters(latitude, longitude, lat, lon);
        if (d < closestDist) {
          closestDist = d;
          closest = entry;
        }
      }
      const [lon, lat] = closest.terrace.point.geometry.coordinates;
      searchStatus.textContent = `Närmast med sol: ${closest.terrace.name} (${Math.round(closestDist)} m bort)`;
      map.flyTo([lat, lon], Math.max(map.getZoom(), 17));
      closest.marker.openPopup();
    },
    (err) => {
      searchStatus.textContent =
        err.code === err.PERMISSION_DENIED
          ? "Platsdelning nekades — kan inte hitta närmaste."
          : "Kunde inte hämta din plats just nu.";
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
  );
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
timeSlider.addEventListener("input", () => {
  timeDisplay.textContent = minutesToHHMM(Number(timeSlider.value));
  document.documentElement.style.setProperty("--day-progress", `${(Number(timeSlider.value) / 1439) * 100}%`);
  debouncedRecompute();
});
nowButton.addEventListener("click", () => {
  setInputsToNow();
  recompute();
});
searchInput.addEventListener("input", debounce(applySearchFilter, 120));
exportVotesButton.addEventListener("click", downloadVotesJson);
clearVotesButton.addEventListener("click", () => {
  if (getAllVotes().length && !confirm("Rensa alla dina loggade bedömningar på den här enheten?")) return;
  clearAllVotes();
  updateVoteCount();
  recompute();
});
nearMeButton.addEventListener("click", findNearestSunny);

async function init() {
  setInputsToNow();
  statusLine.textContent = "Ställer in solvinkeln och mäter upp skuggorna…";
  updateVoteCount();
  try {
    const data = await loadData();
    terraces = data.terraces;
    buildings = data.buildings;
    renderMarkers();
    recompute();
  } catch (err) {
    statusLine.textContent = `Kunde inte ladda data: ${err.message}. Har du kört "npm run fetch-data"?`;
    console.error(err);
  }
}

init();
