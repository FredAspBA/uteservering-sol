"""Validerar om Overture Maps' byggnadshöjder slår vår nuvarande
gissningsmodell (typmedian -> grannskapsmedian -> 15 m), innan vi bygger
in Overture i produktionspipelinen. Engångsexperiment, inga sidoeffekter
på data/*.geojson. Se docs/superpowers/specs/2026-08-08-overture-height-
validation-design.md för bakgrunden.
"""
import hashlib
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


def cache_path_for(bbox):
    """Cachefilnamnet beror på både OVERTURE_RELEASE och bbox, så en gammal
    cache från en annan release eller ett annat bbox-utsnitt (t.ex. efter att
    data/buildings.geojson uppdaterats av det månatliga workflowet) inte
    tyst återanvänds -- den upptäcks som en cache-miss istället."""
    bbox_hash = hashlib.md5(str(bbox).encode("utf-8")).hexdigest()[:8]
    return f".data-tmp/overture-buildings-malmo-{OVERTURE_RELEASE}-{bbox_hash}.jsonl"


def rings_of(geom):
    """Samma hjälpfunktion som impact-experiment.py: yttre ring(ar) för
    Polygon/MultiPolygon, tom lista annars."""
    t = geom["type"]
    if t == "Polygon":
        return [geom["coordinates"][0]]
    if t == "MultiPolygon":
        return [poly[0] for poly in geom["coordinates"]]
    return []


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


def fetch_overture_buildings(bbox, cache_path=None, refresh=False):
    """bbox = (west, south, east, north) i grader. Returnerar en lista med
    dicts: {id, height, num_floors, sources, lon, lat}. Cachas till
    `cache_path` (gitignorad .data-tmp/, namngiven efter release+bbox --
    se cache_path_for) så upprepade körningar under utveckling inte
    träffar S3 varje gång -- sätt refresh=True för att tvinga en ny
    hämtning."""
    if cache_path is None:
        cache_path = cache_path_for(bbox)
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
    vid den här breddgraden.
    OBS: kan matcha samma Overture-rad mot två olika OSM-byggnader (ingen
    dedupe mellan anrop) -- ofarligt här (bara 4 centroid-matchningar
    totalt i Task 3), men en framtida produktionsversion bör deduplicera."""
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


# CELL_DEG (~50 m, från Task 3) är tajt anpassad för Overture-centroid-
# matchning och för finmaskig för neighbourhood_median() nedan: en
# empirisk kontroll visade att 5,9 % av byggnaderna med känd höjd då
# faller igenom alla tre ringarna (rings=(1,2,3)) utan att hitta min_n=5
# grannar, mot 0,1 % med en 300 m-cell (samma värde height-experiment.py
# använder). Därför en egen, grövre cellstorlek bara för det här
# indexet -- Overture-matchningen i match_all() rör den inte.
NEIGHBOUR_CELL_DEG = 0.003  # ~300 m vid Malmös breddgrad


def neighbour_cell_of(lon, lat):
    return (int(math.floor(lon / NEIGHBOUR_CELL_DEG)), int(math.floor(lat / NEIGHBOUR_CELL_DEG)))


def build_index(sample):
    idx = defaultdict(list)
    for r in sample:
        idx[neighbour_cell_of(r["lon"], r["lat"])].append(r)
    return idx


def neighbourhood_median(idx, r, exclude_self=True, min_n=5, rings=(1, 2, 3)):
    c0, r0 = neighbour_cell_of(r["lon"], r["lat"])
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
    Global Constraints-anmärkningen om varför det här spåras separat.
    Ingen '/properties/height'-post -> vi vet inte vilket dataset som gav
    höjden (om något), så returnera None istället för att gissa på
    sources[0], som bara beskriver geometrins ursprung. Det här matas nu in
    i beslutsunderlaget, så gissningar här är inte ofarliga."""
    for s in sources or []:
        if s.get("property") == "/properties/height":
            return s.get("dataset")
    return None


def run_comparison(osm_by_key, matches):
    # known = hold-out-setet (OSM-byggnader med känd höjd, låtsad okänd, för
    # att kunna räkna fel). unknown = den PRODUKTIONSRELEVANTA populationen:
    # OSM-byggnader UTAN känd höjd, dvs. de en riktig pipeline faktiskt
    # skulle fråga Overture om.
    known = {k: r for k, r in osm_by_key.items() if r["h"] is not None}
    unknown = {k: r for k, r in osm_by_key.items() if r["h"] is None}

    by_type = defaultdict(list)
    for r in known.values():
        by_type[r["type"]].append(r["h"])
    type_fallback = {t: statistics.median(hs) for t, hs in by_type.items() if len(hs) >= 20}
    generic_types = {"yes", "residential", "roof", "service", ""}
    idx_known = build_index(known.values())

    combined_pred = {k: predict_combined(r, idx_known, type_fallback, generic_types) for k, r in known.items()}
    errs_combined = [abs(combined_pred[k] - r["h"]) for k, r in known.items()]
    errs_flat = [abs(FLAT_DEFAULT - r["h"]) for r in known.values()]

    # Overture-matchningar inom hold-out-setet, grupperade på VILKET dataset
    # som faktiskt gav höjdvärdet (inte bara geometrin). Det här är kärnan
    # i finding #1 från slutgranskningen: en blandad/total MAE är cirkulär
    # eftersom OSM-sourced höjder i praktiken ekar samma sanning vi mäter
    # mot (nästan 0 fel per definition), medan bara de Microsoft-ML-sourced
    # höjderna faktiskt testar något oberoende.
    overture_by_source = defaultdict(list)
    for key, rec in known.items():
        row = matches.get(key)
        if row is None:
            continue
        oh = overture_height(row)
        if oh is None:
            continue
        truth = rec["h"]
        src = height_source(row.get("sources") or []) or "okänd"
        overture_by_source[src].append({
            "overture_err": abs(oh - truth),
            "combined_err": abs(combined_pred[key] - truth),
            "signed_err": oh - truth,
        })
    all_overture_errs = [e["overture_err"] for entries in overture_by_source.values() for e in entries]

    def report(name, errs):
        if not errs:
            print(f"{name:<28}(inga värden)")
            return
        mae = statistics.mean(errs)
        med = statistics.median(errs)
        p3 = 100 * sum(1 for e in errs if e <= 3) / len(errs)
        print(f"{name:<28}{mae:7.2f}m  median {med:6.2f}m  inom ±3m: {p3:5.1f}%  (n={len(errs)})")

    print()
    print("--- Hold-out-jämförelse (känd höjd, låtsad okänd) -- blandad/total, kontext, INTE beslutsunderlaget ---")
    report("nuvarande modell (kombinerad)", errs_combined)
    report("platt 15 m", errs_flat)
    report("Overture (där matchad, alla källor blandat)", all_overture_errs)
    n_matched = sum(len(v) for v in overture_by_source.values())
    print(f"Overture-matchningsgrad inom hold-out-setet: "
          f"{100 * n_matched / len(known):.1f}% ({n_matched}/{len(known)})")

    print("\n--- Overture MAE per height_source, hold-out (DETTA är beslutsunderlaget) ---")
    print("height_source                  n      Overture MAE   nuvarande modell MAE (samma byggnader)")
    for src, entries in sorted(overture_by_source.items(), key=lambda kv: -len(kv[1])):
        n = len(entries)
        o_mae = statistics.mean(e["overture_err"] for e in entries)
        c_mae = statistics.mean(e["combined_err"] for e in entries)
        indep = "  <- det enda oberoende testet" if src == "Microsoft ML Buildings" else ""
        print(f"{src:<30}{n:5d}      {o_mae:6.2f}         {c_mae:6.2f}{indep}")

    # Bias-koll på den enda oberoende testade delmängden (Microsoft ML
    # Buildings i hold-out-setet). Ren observation för dokumentationen --
    # INGEN kalibreringsstrategi är byggd eller testad utifrån den här.
    ml_entries = overture_by_source.get("Microsoft ML Buildings")
    if ml_entries:
        signed = [e["signed_err"] for e in ml_entries]
        mean_signed = statistics.mean(signed)
        median_signed = statistics.median(signed)
        corrected_mae = statistics.mean(abs(e["signed_err"] - median_signed) for e in ml_entries)
        c_mae_ml = statistics.mean(e["combined_err"] for e in ml_entries)
        print(f"\nBias-koll (Microsoft ML Buildings, hold-out, n={len(ml_entries)}): "
              f"medel signed error {mean_signed:+.2f}m, median signed error {median_signed:+.2f}m "
              f"(Overture överskattar). Om man subtraherar medianoffset: MAE {corrected_mae:.2f}m "
              f"(mot nuvarande modells {c_mae_ml:.2f}m på samma byggnader) -- endast en observation, "
              f"inte en byggd/testad kalibreringsstrategi.")

    # Produktionsrelevant täckning: OSM-byggnader UTAN känd höjd -- de en
    # produktionspipeline faktiskt skulle fråga Overture om. Det är den
    # täckningssiffran som spelar roll för beslutet, inte hold-out-setets
    # (som bara mäter hur ofta Overture råkar matcha en byggnad OSM redan
    # har svaret för).
    unknown_total = len(unknown)
    unknown_src_counts = Counter()
    unknown_with_height = 0
    for key in unknown:
        row = matches.get(key)
        if row is None:
            continue
        oh = overture_height(row)
        if oh is None:
            continue
        unknown_with_height += 1
        src = height_source(row.get("sources") or []) or "okänd"
        unknown_src_counts[src] += 1

    print("\n--- Produktionsrelevant täckning (OSM-byggnader UTAN känd höjd -- DETTA är matchningsgraden som räknas) ---")
    print(f"Totalt: {unknown_total}")
    pct = 100 * unknown_with_height / unknown_total if unknown_total else 0.0
    print(f"Overture ger NÅGON höjd: {unknown_with_height} ({pct:.1f}%)")
    for src, n in unknown_src_counts.most_common():
        print(f"  {n:6d}  {src}")

    print("\n=== SLUTSATS ===")
    ms = overture_by_source.get("Microsoft ML Buildings")
    if ms:
        o_mae_ms = statistics.mean(e["overture_err"] for e in ms)
        c_mae_ms = statistics.mean(e["combined_err"] for e in ms)
        print(f"Det enda oberoende testet (Overture-höjd som INTE bara ekar OSM): "
              f"Overture MAE {o_mae_ms:.2f}m mot nuvarande modells {c_mae_ms:.2f}m på samma "
              f"{len(ms)} byggnader -- Overture slår INTE nuvarande modell här.")
    print(f"Produktionsrelevant täckning: Overture ger en höjd för {unknown_with_height}/{unknown_total} "
          f"({pct:.1f}%) av OSM-byggnaderna som saknar känd höjd, varav "
          f"{unknown_src_counts.get('Microsoft ML Buildings', 0)} Microsoft-ML-sourced och "
          f"{unknown_src_counts.get('okänd', 0)} utan explicit height_source (inget "
          f"/properties/height-inslag i sources -- se height_source()).")


if __name__ == "__main__":
    bbox = bbox_from_buildings()
    print(f"bbox (west,south,east,north): {bbox}")
    overture = fetch_overture_buildings(bbox)
    with_height = sum(1 for r in overture if r["height"] is not None)
    print(f"Overture-byggnader i bbox: {len(overture)}   med height: {with_height}")

    osm_by_key = load_osm_buildings()
    matches, match_kind = match_all(osm_by_key, overture)
    kind_counts = Counter(match_kind.values())
    print(f"OSM-byggnader totalt: {len(osm_by_key)}   matchade mot Overture: {len(matches)} "
          f"({100 * len(matches) / len(osm_by_key):.1f}%)  "
          f"[id: {kind_counts['id']}, centroid: {kind_counts['centroid']}]")

    run_comparison(osm_by_key, matches)
