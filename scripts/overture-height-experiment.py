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
