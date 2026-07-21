// Collaborative tagging worklist (taggning.html).
//
// Renders the ~940 Malmo places and, per place, three yes/no toggles
// (alcohol / outdoor seating / "updated in OSM") whose state is shared
// live via Firebase Realtime Database, so anyone with the link edits the
// same list together in real time. Place NAMES etc. come from the static
// data/tagging-list.json; only the checkbox state lives in Firebase.
//
// Security notes:
// - Firebase config values are public identifiers, not secrets (same as
//   the main app); access is governed by database.rules.json.
// - The /tagging node is intentionally world-read/write so a friend can
//   join without an account, but rules validate every write to the three
//   yes/no fields and forbid writing the whole node at once, so the worst
//   a stranger could do is fiddle with public-POI checkbox state — no
//   personal data is involved.
// - All place text is inserted with textContent / DOM APIs, never innerHTML
//   with data, so nothing in the list can inject markup or script.

import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import {
  getDatabase,
  ref,
  onValue,
  update,
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js";

const FIELDS = ["alcohol", "outdoor", "osm"];

const listEl = document.getElementById("list");
const searchEl = document.getElementById("search");
const catFilterEl = document.getElementById("cat-filter");
const quickFiltersEl = document.getElementById("quick-filters");
const countEl = document.getElementById("count");
const progressEl = document.getElementById("progress");
const bannerEl = document.getElementById("sync-banner");

let items = [];
const rowsByKey = new Map(); // key -> { item, rowEl, buttons: {field: {yes, nej}} }
let sharedState = {}; // key -> { alcohol?, outdoor?, osm? }
let quickFilter = "all";

// ---------- Firebase ----------
let db = null;
try {
  if (!firebaseConfig) throw new Error("Firebase-konfiguration saknas");
  db = getDatabase(initializeApp(firebaseConfig));
} catch (err) {
  showBanner(`Delad synk kunde inte startas: ${err.message}. Dina ändringar sparas inte.`);
}

function showBanner(msg) {
  bannerEl.textContent = msg;
  bannerEl.hidden = false;
}

function writeField(key, field, value) {
  if (!db) return;
  update(ref(db, `tagging/${key}`), {
    [field]: value, // string 'yes'/'no' or null to clear
    updatedAt: new Date().toISOString(),
  }).catch((err) => {
    showBanner(`Kunde inte spara ändringen: ${err.message}`);
  });
}

// ---------- Rendering ----------
function fieldToggle(key, field, labels) {
  const wrap = document.createElement("div");
  wrap.className = "toggle";
  const caption = document.createElement("span");
  caption.className = "toggle-label";
  caption.textContent = labels.caption;
  wrap.appendChild(caption);

  const buttons = {};
  for (const [value, text] of [["yes", "Ja"], ["no", "Nej"]]) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `seg seg-${value}`;
    btn.textContent = text;
    btn.setAttribute("aria-label", `${labels.caption}: ${text}`);
    btn.addEventListener("click", () => {
      const current = sharedState[key]?.[field] ?? null;
      const next = current === value ? null : value;
      // Optimistic local update so it feels instant; Firebase echoes back.
      sharedState[key] = { ...(sharedState[key] || {}), [field]: next ?? undefined };
      applyRowState(key);
      updateProgress();
      writeField(key, field, next);
    });
    buttons[value] = btn;
    wrap.appendChild(btn);
  }
  return { wrap, buttons };
}

function osmHintChips(item) {
  const frag = document.createDocumentFragment();
  const chip = (text, cls) => {
    const s = document.createElement("span");
    s.className = `hint ${cls}`;
    s.textContent = text;
    return s;
  };
  if (item.osmAlcohol === "yes") frag.appendChild(chip("OSM: alkohol ✓", "hint-known"));
  else if (item.osmAlcohol === "no") frag.appendChild(chip("OSM: ingen alkohol", "hint-known"));
  else frag.appendChild(chip("OSM: alkohol okänt", "hint-missing"));

  if (item.osmOutdoor === "yes" || item.osmOutdoor === "only")
    frag.appendChild(chip("OSM: uteservering ✓", "hint-known"));
  else if (item.osmOutdoor === "no") frag.appendChild(chip("OSM: ingen uteservering", "hint-known"));
  else frag.appendChild(chip("OSM: uteservering-tagg saknas", "hint-missing"));
  return frag;
}

function buildRow(item) {
  const row = document.createElement("div");
  row.className = "row";

  const head = document.createElement("div");
  head.className = "row-head";

  const nameLink = document.createElement("a");
  nameLink.className = "row-name";
  nameLink.href = item.osmUrl;
  nameLink.target = "_blank";
  nameLink.rel = "noopener noreferrer";
  nameLink.textContent = item.name;
  nameLink.title = "Öppna i OpenStreetMap (ny flik)";
  if (!item.named) nameLink.classList.add("nameless");

  const cat = document.createElement("span");
  cat.className = "row-cat";
  cat.textContent = item.cat;

  head.append(nameLink, cat);

  const hints = document.createElement("div");
  hints.className = "row-hints";
  hints.appendChild(osmHintChips(item));

  const main = document.createElement("div");
  main.className = "row-main";
  main.append(head, hints);

  const toggles = document.createElement("div");
  toggles.className = "row-toggles";
  const buttons = {};
  const alc = fieldToggle(item.key, "alcohol", { caption: "Alkohol" });
  const out = fieldToggle(item.key, "outdoor", { caption: "Uteservering" });
  const osm = fieldToggle(item.key, "osm", { caption: "OSM uppdaterat" });
  buttons.alcohol = alc.buttons;
  buttons.outdoor = out.buttons;
  buttons.osm = osm.buttons;
  toggles.append(alc.wrap, out.wrap, osm.wrap);

  row.append(main, toggles);
  rowsByKey.set(item.key, { item, rowEl: row, buttons });
  return row;
}

function applyRowState(key) {
  const entry = rowsByKey.get(key);
  if (!entry) return;
  const state = sharedState[key] || {};
  for (const field of FIELDS) {
    const val = state[field] ?? null;
    entry.buttons[field].yes.classList.toggle("active", val === "yes");
    entry.buttons[field].no.classList.toggle("active", val === "no");
  }
  entry.rowEl.classList.toggle("row-osm-done", state.osm === "yes");
}

function applyAllState() {
  for (const key of rowsByKey.keys()) applyRowState(key);
}

// ---------- Filtering ----------
function matches(item) {
  const q = searchEl.value.trim().toLowerCase();
  if (q && !item.name.toLowerCase().includes(q)) return false;

  if (catFilterEl.value && item.catKey !== catFilterEl.value) return false;

  const state = sharedState[item.key] || {};
  switch (quickFilter) {
    case "alcohol-unknown":
      return item.osmAlcohol === "unknown";
    case "outdoor-missing":
      return item.osmOutdoor === "";
    case "osm-todo":
      return state.osm !== "yes";
    case "started":
      return Boolean(state.alcohol || state.outdoor || state.osm);
    default:
      return true;
  }
}

function applyFilters() {
  let shown = 0;
  for (const { item, rowEl } of rowsByKey.values()) {
    const show = matches(item);
    rowEl.classList.toggle("is-hidden", !show);
    if (show) shown++;
  }
  countEl.textContent = `Visar ${shown} av ${items.length}`;
}

function updateProgress() {
  let osmDone = 0;
  let started = 0;
  for (const state of Object.values(sharedState)) {
    if (!state) continue;
    if (state.osm === "yes") osmDone++;
    if (state.alcohol || state.outdoor || state.osm) started++;
  }
  progressEl.textContent = `${osmDone} markerade OSM-klara · ${started} påbörjade`;
}

// ---------- Init ----------
function populateCategoryFilter() {
  const cats = new Map();
  for (const item of items) {
    if (item.catKey) cats.set(item.catKey, item.cat);
  }
  const sorted = [...cats.entries()].sort((a, b) => a[1].localeCompare(b[1], "sv"));
  for (const [key, label] of sorted) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = label;
    catFilterEl.appendChild(opt);
  }
}

function wireControls() {
  searchEl.addEventListener("input", applyFilters);
  catFilterEl.addEventListener("change", applyFilters);
  quickFiltersEl.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-filter]");
    if (!btn) return;
    quickFilter = btn.dataset.filter;
    quickFiltersEl.querySelectorAll("button").forEach((b) =>
      b.classList.toggle("active", b === btn)
    );
    applyFilters();
  });
}

async function init() {
  try {
    const res = await fetch("data/tagging-list.json");
    if (!res.ok) throw new Error(`kunde inte hämta listan (${res.status})`);
    items = (await res.json()).items;
  } catch (err) {
    showBanner(`Kunde inte ladda listan: ${err.message}`);
    return;
  }

  const frag = document.createDocumentFragment();
  for (const item of items) frag.appendChild(buildRow(item));
  listEl.appendChild(frag);

  populateCategoryFilter();
  wireControls();
  applyFilters();
  updateProgress();

  if (db) {
    onValue(
      ref(db, "tagging"),
      (snap) => {
        sharedState = snap.val() || {};
        applyAllState();
        updateProgress();
        applyFilters(); // quick filters can depend on shared state
      },
      (err) => showBanner(`Live-synk avbröts: ${err.message}`)
    );
  }
}

init();
