import { loadData } from "./dataLoad.js";
import { computeShading } from "./shadow.js";
import { getSunInfo } from "./sun.js";

const MALMO_CENTER = [55.605, 13.0038];

const STATUS_LABELS = {
  sun: "Sol",
  shade: "Skugga",
  night: "Mörkt",
  anomaly: "Osäker",
};

const STATUS_COLORS = {
  sun: "#f5a623",
  shade: "#5b7a9d",
  night: "#333844",
  anomaly: "#b23a48",
};

const map = L.map("map").setView(MALMO_CENTER, 16);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap-bidragsgivare",
  maxZoom: 19,
}).addTo(map);

const dateInput = document.getElementById("date-input");
const timeSlider = document.getElementById("time-slider");
const timeDisplay = document.getElementById("time-display");
const nowButton = document.getElementById("now-button");
const statusLine = document.getElementById("status-line");

let terraces = [];
let buildings = [];
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

function popupHtml(terraceName, result) {
  const { status, blocker, sunInfo } = result;
  const label = STATUS_LABELS[status];
  let detail = `Solhöjd: ${sunInfo.altitudeDeg.toFixed(1)}°, riktning mot solen: ${sunInfo.bearingDeg.toFixed(0)}°`;
  if (status === "shade" && blocker) {
    detail += `<br>Skuggas av ${blocker.name} (${blocker.distanceMeters.toFixed(0)} m bort, behöver ≥${blocker.requiredHeightMeters.toFixed(
      1
    )} m, är ${blocker.actualHeightMeters.toFixed(1)} m)`;
  }
  if (status === "anomaly") {
    detail += `<br>Punkten hamnar inuti en byggnad i kartdatan – gå inte i god för detta resultat.`;
  }
  return `
    <div class="popup-title">${escapeHtml(terraceName)}</div>
    <div class="popup-status ${status}">${label}</div>
    <div class="popup-detail">${detail}</div>
  `;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function renderMarkers() {
  for (const m of markers) map.removeLayer(m.marker);
  markers = [];

  for (const terrace of terraces) {
    const [lon, lat] = terrace.point.geometry.coordinates;
    const marker = L.circleMarker([lat, lon], {
      radius: 8,
      weight: 1.5,
      color: "#2b2620",
      fillOpacity: 0.9,
    }).addTo(map);
    marker.bindPopup("");
    markers.push({ terrace, marker });
  }
}

function recompute() {
  const date = dateFromInputs();
  let sunCount = 0;
  let shadeCount = 0;
  let nightCount = 0;

  const centerSun = getSunInfo(MALMO_CENTER[0], MALMO_CENTER[1], date);

  for (const { terrace, marker } of markers) {
    const [lon, lat] = terrace.point.geometry.coordinates;
    const sunInfo = getSunInfo(lat, lon, date);
    const result = computeShading(terrace.point, buildings, sunInfo, terrace.homeBuilding);

    marker.setStyle({ fillColor: STATUS_COLORS[result.status] });
    marker.setPopupContent(popupHtml(terrace.name, result));

    if (result.status === "sun") sunCount++;
    else if (result.status === "shade") shadeCount++;
    else if (result.status === "night") nightCount++;
  }

  statusLine.textContent = `${date.toLocaleString("sv-SE")} — solhöjd i Malmö: ${centerSun.altitudeDeg.toFixed(
    1
  )}°. ${sunCount} i sol, ${shadeCount} i skugga${nightCount ? `, ${nightCount} i mörker` : ""} av ${terraces.length} uteserveringar.`;
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
  debouncedRecompute();
});
nowButton.addEventListener("click", () => {
  setInputsToNow();
  recompute();
});

async function init() {
  setInputsToNow();
  statusLine.textContent = "Laddar data…";
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
