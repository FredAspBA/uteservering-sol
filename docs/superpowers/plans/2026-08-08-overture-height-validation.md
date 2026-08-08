# Overture-höjdvalidering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mäta om Overture Maps' byggnadshöjder faktiskt slår vår nuvarande
gissningsmodell (typmedian → grannskapsmedian → 15 m) för Malmös
byggnader, innan vi bygger in Overture i produktionspipelinen.

**Architecture:** Ett fristående Python-script (`scripts/overture-height-experiment.py`)
läser Overtures publika `buildings`-parquet direkt från S3 via DuckDB
(bbox-filtrerat, ingen fullständig nedladdning), matchar mot våra befintliga
OSM-byggnader (`data/buildings.geojson`) på OSM-id först och centroid-närhet
i andra hand, och kör samma hold-out-validering som fas 1:s
`height-experiment.py` för att jämföra MAE mellan strategierna.

**Tech Stack:** Python 3.12, `duckdb` (med `httpfs`- och `spatial`-extensions),
ingen ny JS/Node-kod. Körs manuellt (`python scripts/overture-height-experiment.py`),
inget CI-steg i den här omgången — det är ett engångsexperiment.

## Global Constraints

- Rör INGA riktiga datafiler (`data/buildings.geojson`, `data/terraces.geojson`)
  — bara läsning. Inga skrivningar utanför `.data-tmp/` (redan gitignorat)
  och den slutliga uppdateringen av `PLAN-datakvalitet.md`.
- Overture-release: `2026-07-22.0` (senaste vid research-tillfället,
  bekräftad live mot `s3://overturemaps-us-west-2/release/`). Hårdkoda
  den — inte kritiskt att alltid använda absolut senaste för ett
  engångsexperiment.
- Bbox-pushdown mot Overture görs via kolumnerna `bbox.xmin`/`bbox.xmax`/
  `bbox.ymin`/`bbox.ymax` (bekräftat existera i schemat live). `region`
  för S3 är `us-west-2`.
- Overtures `sources`-fält per byggnad är en array av structs med fältet
  `record_id` i formatet `w<osm-id>@<version>` (way), `r<osm-id>@<version>`
  (relation) — bekräftat live mot riktiga Malmö-byggnader. Våra egna
  OSM-id ligger i GeoJSON-featurens toppnivå-`id`-fält, format
  `"way/12345"` / `"relation/12345"`.
- Överraskning från research, viktig att inte tappa bort: Overtures
  `height`-fält är inte alltid OSM-härlett. `sources`-arrayen har ofta en
  separat rad med `property == '/properties/height'` vars `dataset` visar
  VEM som gav höjden — t.ex. `Microsoft ML Buildings` (en ML-gissning, inte
  mätdata) snarare än `OpenStreetMap`. Rapporten MÅSTE bryta ut MAE per
  `height_source`, annars blandas mätdata och ML-gissningar ihop i samma
  siffra och döljer precis den risk fas 4-planen redan flaggat
  ("Overture-höjder är delvis själva ML-gissningar").

---

### Task 1: Bbox-beräkning + Overture-hämtning med cache

**Files:**
- Create: `scripts/overture-height-experiment.py`
- Create: `scripts/requirements.txt`

**Interfaces:**
- Produces: `bbox_from_buildings(path='data/buildings.geojson', margin_deg=0.002) -> (west, south, east, north)`
- Produces: `fetch_overture_buildings(bbox, cache_path='.data-tmp/overture-buildings-malmo.jsonl', refresh=False) -> list[dict]`,
  varje dict har nycklarna `id, height, num_floors, sources, lon, lat`.
- Produces: `rings_of(geom) -> list[list[[lon, lat], ...]]` (hjälpfunktion, återanvänd i Task 2).

- [ ] **Step 1: Skriv `scripts/requirements.txt`**

```
duckdb>=1.5,<2
```

- [ ] **Step 2: Installera beroendet**

Run: `pip install -r scripts/requirements.txt`
Expected: `Successfully installed duckdb-...` (eller "Requirement already satisfied" om redan installerat).

- [ ] **Step 3: Skriv scriptets grund + `bbox_from_buildings()`**

Skapa `scripts/overture-height-experiment.py`:

```python
"""Validerar om Overture Maps' byggnadshöjder slår vår nuvarande
gissningsmodell (typmedian -> grannskapsmedian -> 15 m), innan vi bygger
in Overture i produktionspipelinen. Engångsexperiment, inga sidoeffekter
på data/*.geojson. Se docs/superpowers/specs/2026-08-08-overture-height-
validation-design.md för bakgrunden.
"""
import json
import math
import os
import re
import statistics
from collections import defaultdict, Counter

import duckdb

METERS_PER_LEVEL = 3.0
FLAT_DEFAULT = 15.0
OVERTURE_RELEASE = "2026-07-22.0"
CACHE_PATH = ".data-tmp/overture-buildings-malmo.jsonl"


def rings_of(geom):
    """Samma hjälpfunktion som impact-experiment.py: yttre ring(ar) för
    Polygon/MultiPolygon, tom lista annars."""
    t = geom["type"]
    if t == "Polygon":
        return [geom["coordinates"][0]]
    if t == "MultiPolygon":
        return [poly[0] for poly in geom["coordinates"]]
    return []


def bbox_from_buildings(path="data/buildings.geojson", margin_deg=0.002):
    """Räknar ut (west, south, east, north) från den faktiska utbredningen
    av data/buildings.geojson, plus en liten marginal. Görs mot filens
    egna koordinater snarare än att återimplementera fetch-data-geofabrik.js's
    padding-logik i Python -- exakt täckning garanteras eftersom det är
    samma fil vi sedan matchar mot."""
    d = json.load(open(path, encoding="utf-8"))
    lons, lats = [], []
    for f in d["features"]:
        g = f.get("geometry")
        if not g:
            continue
        for ring in rings_of(g):
            for lon, lat in ring:
                lons.append(lon)
                lats.append(lat)
    return (
        min(lons) - margin_deg,
        min(lats) - margin_deg,
        max(lons) + margin_deg,
        max(lats) + margin_deg,
    )


if __name__ == "__main__":
    bbox = bbox_from_buildings()
    print(f"bbox (west,south,east,north): {bbox}")
```

- [ ] **Step 4: Kör och verifiera bbox**

Run: `python scripts/overture-height-experiment.py`
Expected: en rad `bbox (west,south,east,north): (...)` med värden nära
`(12.89, 55.55, 13.05, 55.62)` (jämför mot `SEARCH_BBOX_OVERPASS` i
`scripts/fetch-data-geofabrik.js:48`, som är `"55.558,12.895,55.615,13.035"`
i syd,väst,nord,öst-ordning — våra tal ska ligga strax utanför det,
eftersom byggnadsdatan redan är padded +600 m och vi lägger på ytterligare
marginal).

- [ ] **Step 5: Lägg till `fetch_overture_buildings()`**

Lägg till i `scripts/overture-height-experiment.py`, före `if __name__`:

```python
def fetch_overture_buildings(bbox, cache_path=CACHE_PATH, refresh=False):
    """bbox = (west, south, east, north) i grader. Returnerar en lista med
    dicts: {id, height, num_floors, sources, lon, lat}. Cachas till
    `cache_path` (gitignorad .data-tmp/) så upprepade körningar under
    utveckling inte träffar S3 varje gång -- sätt refresh=True för att
    tvinga en ny hämtning."""
    if os.path.exists(cache_path) and not refresh:
        with open(cache_path, encoding="utf-8") as f:
            return [json.loads(line) for line in f if line.strip()]

    west, south, east, north = bbox
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial;")
    con.execute("SET s3_region='us-west-2';")
    query = f"""
        SELECT id, height, num_floors, sources,
               ST_X(ST_Centroid(geometry)) AS lon,
               ST_Y(ST_Centroid(geometry)) AS lat
        FROM read_parquet(
            's3://overturemaps-us-west-2/release/{OVERTURE_RELEASE}/theme=buildings/type=building/*',
            hive_partitioning=1
        )
        WHERE bbox.xmin <= {east} AND bbox.xmax >= {west}
          AND bbox.ymin <= {north} AND bbox.ymax >= {south}
    """
    rows = con.execute(query).fetchall()
    cols = [d[0] for d in con.description]
    records = [dict(zip(cols, row)) for row in rows]

    os.makedirs(os.path.dirname(cache_path), exist_ok=True)
    with open(cache_path, "w", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r, default=str) + "\n")
    return records
```

Uppdatera `if __name__ == "__main__":`-blocket:

```python
if __name__ == "__main__":
    bbox = bbox_from_buildings()
    print(f"bbox (west,south,east,north): {bbox}")
    overture = fetch_overture_buildings(bbox)
    with_height = sum(1 for r in overture if r["height"] is not None)
    print(f"Overture-byggnader i bbox: {len(overture)}   med height: {with_height}")
```

- [ ] **Step 6: Kör och verifiera hämtningen**

Run: `python scripts/overture-height-experiment.py`
Expected: `bbox`-raden som innan, sedan `Overture-byggnader i bbox: <N>   med
height: <M>` där N är i storleksordningen 25 000–26 000 och M ungefär
55–60 % av N (research visade 25 045 byggnader / 14 387 med height =
57,4 % för den opaddade bboxen — med marginalen här blir N något större).
Verifiera att `.data-tmp/overture-buildings-malmo.jsonl` skapades
(`ls -la .data-tmp/`) och att andra körningen är märkbart snabbare (cache-träff,
ingen S3-fråga).

- [ ] **Step 7: Commit**

```bash
git add scripts/overture-height-experiment.py scripts/requirements.txt
git commit -m "Add Overture height experiment: bbox + cached S3 fetch"
```

---

### Task 2: OSM-index + id-baserad matchning

**Files:**
- Modify: `scripts/overture-height-experiment.py`

**Interfaces:**
- Consumes: `rings_of(geom)` från Task 1.
- Produces: `known_height(props) -> float | None`, `centroid(geom) -> (lon, lat) | None`
  (kopierade från `scripts/height-experiment.py`, samma etablerade mönster
  som redan används av `scripts/impact-experiment.py`).
- Produces: `osm_key_from_feature_id(feature_id) -> str | None`
  (`"way/12345"` -> `"w12345"`, `"relation/52315"` -> `"r52315"`).
- Produces: `overture_osm_key(source) -> str | None` (en enskild post ur
  Overtures `sources`-array -> samma nyckelformat, eller `None`).
- Produces: `load_osm_buildings(path='data/buildings.geojson') -> dict[str, dict]`,
  nyckel = osm-nyckel, värde = `{key, lon, lat, type, h}` (`h` är `None`
  om okänd höjd).
- Produces: `match_by_id(osm_by_key, overture_rows) -> dict[str, dict]`
  (osm-nyckel -> matchande Overture-rad).

- [ ] **Step 1: Lägg till `known_height()` och `centroid()`**

Lägg till i `scripts/overture-height-experiment.py`, efter `rings_of()`:

```python
def known_height(p):
    """Kopierad från scripts/height-experiment.py -- samma tolkning av
    height/building:levels som resten av datapipelinen använder."""
    h = p.get("height")
    if h:
        try:
            v = float(str(h).strip().replace(",", ".").split(";")[0])
            if v > 0:
                return v
        except ValueError:
            pass
    lv = p.get("building:levels")
    if lv:
        try:
            v = float(str(lv).strip().replace(",", ".").split(";")[0])
            if v > 0:
                return v * METERS_PER_LEVEL
        except ValueError:
            pass
    return None


def centroid(geom):
    """Grov centroid: medel av yttre ringens koordinater. Samma som i
    height-experiment.py/impact-experiment.py."""
    rings = rings_of(geom)
    if not rings or not rings[0]:
        return None
    ring = rings[0]
    return (sum(c[0] for c in ring) / len(ring), sum(c[1] for c in ring) / len(ring))
```

- [ ] **Step 2: Lägg till id-matchning**

```python
OSM_KIND_PREFIX = {"way": "w", "relation": "r", "node": "n"}
RECORD_ID_RE = re.compile(r"^([wrn])(\d+)@")


def osm_key_from_feature_id(feature_id):
    if not feature_id or "/" not in feature_id:
        return None
    kind, num = feature_id.split("/", 1)
    prefix = OSM_KIND_PREFIX.get(kind)
    return f"{prefix}{num}" if prefix else None


def overture_osm_key(source):
    if source.get("dataset") != "OpenStreetMap":
        return None
    rid = source.get("record_id")
    if not rid:
        return None
    m = RECORD_ID_RE.match(rid)
    return f"{m.group(1)}{m.group(2)}" if m else None


def load_osm_buildings(path="data/buildings.geojson"):
    d = json.load(open(path, encoding="utf-8"))
    recs = {}
    for f in d["features"]:
        key = osm_key_from_feature_id(f.get("id"))
        if not key:
            continue
        g = f.get("geometry")
        c = centroid(g) if g else None
        if not c:
            continue
        p = f.get("properties", {})
        recs[key] = {
            "key": key,
            "lon": c[0],
            "lat": c[1],
            "type": p.get("building", "yes"),
            "h": known_height(p),
        }
    return recs


def match_by_id(osm_by_key, overture_rows):
    """osm-nyckel -> första Overture-raden vars sources refererar den."""
    matches = {}
    for row in overture_rows:
        for s in row.get("sources") or []:
            key = overture_osm_key(s)
            if key and key in osm_by_key and key not in matches:
                matches[key] = row
    return matches
```

- [ ] **Step 3: Uppdatera `__main__` för att köra matchningen**

```python
if __name__ == "__main__":
    bbox = bbox_from_buildings()
    print(f"bbox (west,south,east,north): {bbox}")
    overture = fetch_overture_buildings(bbox)
    with_height = sum(1 for r in overture if r["height"] is not None)
    print(f"Overture-byggnader i bbox: {len(overture)}   med height: {with_height}")

    osm_by_key = load_osm_buildings()
    id_matches = match_by_id(osm_by_key, overture)
    print(f"OSM-byggnader totalt: {len(osm_by_key)}   id-matchade mot Overture: {len(id_matches)} "
          f"({100 * len(id_matches) / len(osm_by_key):.1f}%)")
```

- [ ] **Step 4: Kör och verifiera matchningsgraden**

Run: `python scripts/overture-height-experiment.py`
Expected: en fjärde rad `OSM-byggnader totalt: <N>   id-matchade mot
Overture: <M> (<P>%)`. Förvänta dig en hög matchningsgrad (troligen >90 %)
eftersom Overtures byggnadstema i stor utsträckning bygger direkt på
OSM-geometri i det här området. Om P är påfallande lågt (<50 %):
stanna upp och undersök `RECORD_ID_RE`/nyckelformatet innan du går vidare
till Task 3 — det tyder på ett matchningsfel, inte på verklig datatäckning.

- [ ] **Step 5: Commit**

```bash
git add scripts/overture-height-experiment.py
git commit -m "Add OSM-id matching between OSM and Overture buildings"
```

---

### Task 3: Centroid-fallback för omatchade byggnader

**Files:**
- Modify: `scripts/overture-height-experiment.py`

**Interfaces:**
- Consumes: `load_osm_buildings()`, `match_by_id()` från Task 2.
- Produces: `build_overture_index(rows) -> dict[(int,int), list[dict]]`
  (rutnätsindex, samma mönster som `height-experiment.py`s
  `build_index()`/`neighbourhood_median()`, men indexerar Overture-rader
  istället för OSM-byggnader).
- Produces: `nearest_overture(idx, lon, lat, max_m=5.0) -> dict | None`.
- Produces: `match_all(osm_by_key, overture_rows) -> (matches: dict[str, dict], match_kind: dict[str, str])`
  där `match_kind[key]` är `"id"` eller `"centroid"`.

- [ ] **Step 1: Lägg till rutnätsindex och närmaste-granne-sökning**

```python
CELL_DEG = 0.0005  # ~50 m vid Malmös breddgrad


def cell_of(lon, lat):
    return (int(math.floor(lon / CELL_DEG)), int(math.floor(lat / CELL_DEG)))


def build_overture_index(rows):
    idx = defaultdict(list)
    for r in rows:
        idx[cell_of(r["lon"], r["lat"])].append(r)
    return idx


def nearest_overture(idx, lon, lat, max_m=5.0):
    """Närmaste Overture-byggnad inom max_m meter, sökt i egen + 8
    grannceller. Enkel plan meter-approximation (samma trick som
    height-experiment.py's footprint_area_m2), gott nog över någon meter
    vid den här breddgraden."""
    c0, r0 = cell_of(lon, lat)
    mx = 111320 * math.cos(math.radians(lat))
    my = 110540
    best, best_d = None, max_m
    for dc in (-1, 0, 1):
        for dr in (-1, 0, 1):
            for cand in idx.get((c0 + dc, r0 + dr), ()):
                dx = (cand["lon"] - lon) * mx
                dy = (cand["lat"] - lat) * my
                d = math.hypot(dx, dy)
                if d < best_d:
                    best, best_d = cand, d
    return best
```

- [ ] **Step 2: Lägg till `match_all()`**

```python
def match_all(osm_by_key, overture_rows):
    id_matches = match_by_id(osm_by_key, overture_rows)
    idx = build_overture_index(overture_rows)
    matches, match_kind = {}, {}
    for key, rec in osm_by_key.items():
        if key in id_matches:
            matches[key] = id_matches[key]
            match_kind[key] = "id"
        else:
            cand = nearest_overture(idx, rec["lon"], rec["lat"])
            if cand:
                matches[key] = cand
                match_kind[key] = "centroid"
    return matches, match_kind
```

- [ ] **Step 3: Uppdatera `__main__`**

Ersätt de tre sista raderna (från `osm_by_key = ...`) med:

```python
    osm_by_key = load_osm_buildings()
    matches, match_kind = match_all(osm_by_key, overture)
    kind_counts = Counter(match_kind.values())
    print(f"OSM-byggnader totalt: {len(osm_by_key)}   matchade mot Overture: {len(matches)} "
          f"({100 * len(matches) / len(osm_by_key):.1f}%)  "
          f"[id: {kind_counts['id']}, centroid: {kind_counts['centroid']}]")
```

- [ ] **Step 4: Kör och verifiera**

Run: `python scripts/overture-height-experiment.py`
Expected: matchningsgraden från Task 2 (id-delen oförändrad) plus ett
tillskott från centroid-matchning. Total matchningsgrad ska vara ≥
id-matchningsgraden från Task 2, rimligen ännu högre (>95 %) om det mesta
av gapet var geometri som inte fick en ren OSM-id-referens i `sources`.

- [ ] **Step 5: Commit**

```bash
git add scripts/overture-height-experiment.py
git commit -m "Add centroid fallback matching for buildings without an OSM-id source"
```

---

### Task 4: Hold-out-jämförelse + rapport med height-source-uppdelning

**Files:**
- Modify: `scripts/overture-height-experiment.py`

**Interfaces:**
- Consumes: `known_height()`, `match_all()`, `FLAT_DEFAULT`, `METERS_PER_LEVEL` från tidigare tasks.
- Produces: inget nytt som andra filer konsumerar — det här är slutrapporten.

- [ ] **Step 1: Lägg till strategifunktionerna (kopierade från `height-experiment.py`)**

```python
def build_index(sample):
    idx = defaultdict(list)
    for r in sample:
        idx[cell_of(r["lon"], r["lat"])].append(r)
    return idx


def neighbourhood_median(idx, r, exclude_self=True, min_n=5, rings=(1, 2, 3)):
    c0, r0 = cell_of(r["lon"], r["lat"])
    for rad in rings:
        vals = []
        for dc in range(-rad, rad + 1):
            for dr in range(-rad, rad + 1):
                for o in idx.get((c0 + dc, r0 + dr), ()):
                    if exclude_self and o is r:
                        continue
                    vals.append(o["h"])
        if len(vals) >= min_n:
            return statistics.median(vals)
    return None


def predict_combined(r, idx, type_fallback, generic_types):
    t = r["type"]
    if t not in generic_types and t in type_fallback:
        return type_fallback[t]
    m = neighbourhood_median(idx, r)
    if m is not None:
        return m
    return type_fallback.get(t, FLAT_DEFAULT)


def overture_height(row):
    h = row.get("height")
    if h and h > 0:
        return float(h)
    nf = row.get("num_floors")
    if nf and nf > 0:
        return float(nf) * METERS_PER_LEVEL
    return None


def height_source(sources):
    """Vilket dataset som faktiskt gav höjdvärdet -- inte bara geometrin.
    Overture kan hämta höjd från t.ex. 'Microsoft ML Buildings' (en
    ML-gissning) även när geometrin kommer från OpenStreetMap. Se
    Global Constraints-anmärkningen om varför det här spåras separat."""
    for s in sources or []:
        if s.get("property") == "/properties/height":
            return s.get("dataset")
    return sources[0]["dataset"] if sources else None
```

NOTE: `CELL_DEG` från Task 3 (~50 m) är för finmaskigt för
`neighbourhood_median()`s syfte (den vill ha `min_n=5` grannar inom
rimligt avstånd, inte bara närmsta granne) — men `cell_of()` används här
på OSM-byggnader (via `build_index(known.values())`), inte på
Overture-raderna, så det är en annan indexinstans över annan data. Testa
ändå empiriskt i Step 3: om `neighbourhood_median` ofta faller tillbaka
till `rings=3` utan att hitta `min_n=5`, är cellstorleken för liten för
det här indexet specifikt — byt då till en egen konstant
`NEIGHBOUR_CELL_DEG = 0.003` (samma värde som `height-experiment.py`
använder) för just den här indexeringen, skild från `CELL_DEG` som
Task 3 använder för Overture-matchning.

- [ ] **Step 2: Lägg till rapportfunktionen**

```python
def run_comparison(osm_by_key, matches):
    known = {k: r for k, r in osm_by_key.items() if r["h"] is not None}
    by_type = defaultdict(list)
    for r in known.values():
        by_type[r["type"]].append(r["h"])
    type_fallback = {t: statistics.median(hs) for t, hs in by_type.items() if len(hs) >= 20}
    generic_types = {"yes", "residential", "roof", "service", ""}
    idx_known = build_index(known.values())

    errs_combined, errs_flat, errs_overture = [], [], []
    overture_keys = []
    for key, rec in known.items():
        truth = rec["h"]
        errs_combined.append(abs(predict_combined(rec, idx_known, type_fallback, generic_types) - truth))
        errs_flat.append(abs(FLAT_DEFAULT - truth))
        if key in matches:
            oh = overture_height(matches[key])
            if oh is not None:
                errs_overture.append(abs(oh - truth))
                overture_keys.append(key)

    def report(name, errs):
        if not errs:
            print(f"{name:<28}(inga värden)")
            return
        mae = statistics.mean(errs)
        med = statistics.median(errs)
        p3 = 100 * sum(1 for e in errs if e <= 3) / len(errs)
        print(f"{name:<28}{mae:7.2f}m  median {med:6.2f}m  inom ±3m: {p3:5.1f}%  (n={len(errs)})")

    print()
    print("--- Hold-out-jämförelse (känd höjd, låtsad okänd) ---")
    report("nuvarande modell (kombinerad)", errs_combined)
    report("platt 15 m", errs_flat)
    report("Overture (där matchad)", errs_overture)
    print(f"\nOverture-matchningsgrad inom hold-out-setet: "
          f"{100 * len(overture_keys) / len(known):.1f}% ({len(overture_keys)}/{len(known)})")

    print("\n--- Overture height-source, för de matchade hold-out-byggnaderna ---")
    src_counts = Counter(height_source((matches[k].get("sources") or [])) for k in overture_keys)
    for src, n in src_counts.most_common():
        print(f"  {n:6d}  {src}")
```

- [ ] **Step 3: Anropa rapporten från `__main__`**

Lägg till sist i `if __name__ == "__main__":`-blocket:

```python
    run_comparison(osm_by_key, matches)
```

- [ ] **Step 4: Kör hela experimentet och läs av resultatet**

Run: `python scripts/overture-height-experiment.py`
Expected: fullständig output — bbox, Overture-hämtning, matchningsgrad,
och till sist jämförelsetabellen med MAE per strategi plus
height-source-uppdelningen. Om `neighbourhood_median` sällan hittar
tillräckligt med grannar (se anmärkningen i Step 1): byt `CELL_DEG` till
`NEIGHBOUR_CELL_DEG = 0.003` för `build_index`/`neighbourhood_median`-anropen
specifikt, kör om, och notera det i commit-meddelandet.

Detta är den faktiska leveransen — siffrorna avgör om fas 4 går vidare.
Läs dem noga: både MAE-jämförelsen OCH height-source-fördelningen (en
Overture-höjd som till 80 % kommer från "Microsoft ML Buildings" är ett
annat och svagare bevis än en som till 80 % kommer från "OpenStreetMap").

- [ ] **Step 5: Dokumentera resultatet i `PLAN-datakvalitet.md`**

Öppna `PLAN-datakvalitet.md`, fas 4-avsnittet (`### ⬜ Fas 4 — Overture
som höjdkälla`). Lägg till ett nytt underavsnitt direkt efter
ingresstexten, före `#### Utmaningar och hur vi tar oss runt dem`:

```markdown
#### Valideringsexperiment (2026-08-08)

Kört: `scripts/overture-height-experiment.py`, hold-out-validering mot
Malmös byggnader (samma teknik som fas 1). Resultat:

| Strategi | MAE | Matchningsgrad |
|---|---|---|
| Nuvarande modell (kombinerad) | <FYLL I FRÅN STEP 4> m | 100 % (alltid tillgänglig) |
| Overture (där matchad) | <FYLL I> m | <FYLL I>% |
| Platt 15 m | <FYLL I> m | 100 % |

Height-source för de matchade byggnaderna: <FYLL I FRÅN STEP 4, t.ex.
"72% OpenStreetMap, 28% Microsoft ML Buildings">.

**Beslut:** <FYLL I: "Overture slår nuvarande modell tydligt nog och
matchningsgraden är hög nog -> gå vidare med en produktionsspec" ELLER
"Overture slår inte nuvarande modell / matchningsgraden är för låg ->
fas 4 stängs utan att bygga pipelinen, kvarstår som en möjlig framtida
omprövning om Overture-täckningen förbättras">.
```

Fyll i de faktiska siffrorna från Step 4:s körning — gissa inte.
Uppdatera sedan `### Fas 4` i status-listan under "## Status och ordning"
(rad ~398) från ⬜ till antingen ✅ (om ni går vidare till nästa spec) eller
🚫/kvarstår-som-är (om fas 4 stängs), beroende på beslutet ovan.

- [ ] **Step 6: Commit**

```bash
git add scripts/overture-height-experiment.py PLAN-datakvalitet.md
git commit -m "Run Overture height validation experiment, document result in fas 4"
git push origin main
```

---

## Self-Review Notes

- **Spec-täckning:** alla fem punkter i specens dataflöde (hämta, extrahera,
  matcha, hold-out, rapportera) har en task var (Task 1–4, rapport i Task 4).
  Beslutsregeln (specens "Beslutsregel"-avsnitt) hanteras i Task 4 Step 5.
  Felhanteringsavsnittet (S3-fel, oväntat `sources`-format) täcks implicit:
  ett S3-fel kraschar scriptet med DuckDB:s eget felmeddelande (gott nog
  för ett engångsexperiment, se specens egen not om det); `sources`-format
  som inte matchar `RECORD_ID_RE` faller redan tyst tillbaka till "inget
  id-match" eftersom `overture_osm_key()` returnerar `None` i så fall.
- **Platshållare:** inga TBD/TODO i scriptkoden. De enda platshållarna är
  de explicit uppmärkta `<FYLL I>`-fälten i Task 4 Step 5, vilka per
  definition inte kan fyllas i förrän experimentet faktiskt körts.
- **Typkonsistens:** `overture_height()`/`height_source()` tar samma
  Overture-rad-dict (`{id, height, num_floors, sources, lon, lat}`)
  som `fetch_overture_buildings()` producerar och `match_all()` för vidare
  in i `matches`. `known_height()`/`centroid()` tar samma properties/geometry-
  form som `load_osm_buildings()` läser från `data/buildings.geojson`.
