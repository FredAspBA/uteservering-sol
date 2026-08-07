"""Hold-out-validering av höjdgissning för byggnader utan height/levels.

Frågan: kan vi göra bättre än platta 15 m? Vi tar de byggnader som HAR
känd höjd, låtsas att de är okända, och mäter hur nära olika strategier
kommer. Jämförs som MAE (medelabsolutfel) och median-absolutfel i meter.
"""
import json, math, statistics
from collections import defaultdict, Counter

METERS_PER_LEVEL = 3.0
FLAT_DEFAULT = 15.0

d = json.load(open('data/buildings.geojson'))
feats = d['features']


def known_height(p):
    h = p.get('height')
    if h:
        try:
            v = float(str(h).strip().replace(',', '.').split(';')[0])
            if v > 0:
                return v
        except ValueError:
            pass
    lv = p.get('building:levels')
    if lv:
        try:
            v = float(str(lv).strip().replace(',', '.').split(';')[0])
            if v > 0:
                return v * METERS_PER_LEVEL
        except ValueError:
            pass
    return None


def centroid(geom):
    """Grov centroid: medel av yttre ringens koordinater."""
    t = geom['type']
    if t == 'Polygon':
        ring = geom['coordinates'][0]
    elif t == 'MultiPolygon':
        ring = geom['coordinates'][0][0]
    else:
        return None
    if not ring:
        return None
    return (sum(c[0] for c in ring) / len(ring), sum(c[1] for c in ring) / len(ring))


def footprint_area_m2(geom):
    """Shoelace på lokalt projicerade koordinater."""
    t = geom['type']
    if t == 'Polygon':
        ring = geom['coordinates'][0]
    elif t == 'MultiPolygon':
        ring = geom['coordinates'][0][0]
    else:
        return None
    if len(ring) < 4:
        return None
    lat0 = sum(c[1] for c in ring) / len(ring)
    sx = 111320 * math.cos(math.radians(lat0))
    pts = [((c[0] - ring[0][0]) * sx, (c[1] - ring[0][1]) * 110540) for c in ring]
    s = 0.0
    for i in range(len(pts) - 1):
        s += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1]
    return abs(s) / 2


recs = []
for f in feats:
    g = f.get('geometry')
    if not g:
        continue
    c = centroid(g)
    if not c:
        continue
    p = f.get('properties', {})
    recs.append({
        'lon': c[0], 'lat': c[1],
        'type': p.get('building', 'yes'),
        'h': known_height(p),
        'area': footprint_area_m2(g),
    })

known = [r for r in recs if r['h'] is not None]
unknown = [r for r in recs if r['h'] is None]
print(f'totalt {len(recs)}   känd höjd {len(known)}   okänd {len(unknown)}')
print(f'känd höjd: median {statistics.median(r["h"] for r in known):.1f} m, '
      f'medel {statistics.mean(r["h"] for r in known):.1f} m')
print()

# ---- typ-median från känd data (detta blir våra per-typ-defaults) ----
by_type = defaultdict(list)
for r in known:
    by_type[r['type']].append(r['h'])
print('Median känd höjd per byggnadstyp (n>=20):')
for t, hs in sorted(by_type.items(), key=lambda kv: -len(kv[1])):
    if len(hs) >= 20:
        print(f'  {len(hs):6d}  {statistics.median(hs):5.1f} m  {t}')
print()

# ---- grannskapsindex över KÄNDA byggnader ----
CELL = 0.003  # ~300 m


def cell_of(lon, lat):
    return (int(math.floor(lon / CELL)), int(math.floor(lat / CELL)))


def build_index(sample):
    idx = defaultdict(list)
    for r in sample:
        idx[cell_of(r['lon'], r['lat'])].append(r)
    return idx


def neighbourhood_median(idx, r, exclude_self=True, min_n=5, rings=(1, 2, 3)):
    """Median av kända höjder i växande kvadratiska ringar runt byggnaden."""
    c0, r0 = cell_of(r['lon'], r['lat'])
    for rad in rings:
        vals = []
        for dc in range(-rad, rad + 1):
            for dr in range(-rad, rad + 1):
                for o in idx.get((c0 + dc, r0 + dr), ()):
                    if exclude_self and o is r:
                        continue
                    vals.append(o['h'])
        if len(vals) >= min_n:
            return statistics.median(vals)
    return None


# ---- strategier ----
TYPE_FALLBACK = {t: statistics.median(hs) for t, hs in by_type.items() if len(hs) >= 20}
GENERIC = {'yes', 'residential', 'roof', 'service', ''}


def predict_flat(r, idx):
    return FLAT_DEFAULT


def predict_type(r, idx):
    return TYPE_FALLBACK.get(r['type'], FLAT_DEFAULT)


def predict_neigh(r, idx):
    m = neighbourhood_median(idx, r)
    return m if m is not None else FLAT_DEFAULT


def predict_combined(r, idx):
    """Typ vinner när typen är informativ; annars grannskap; annars platt."""
    t = r['type']
    if t not in GENERIC and t in TYPE_FALLBACK:
        return TYPE_FALLBACK[t]
    m = neighbourhood_median(idx, r)
    if m is not None:
        return m
    return TYPE_FALLBACK.get(t, FLAT_DEFAULT)


idx_known = build_index(known)

print(f'{"strategi":<28}{"MAE":>8}{"median-fel":>12}{"inom ±3m":>11}{"inom ±6m":>11}')
print('-' * 70)
for name, fn in [
    ('platt 15 m (nuvarande)', predict_flat),
    ('per typ', predict_type),
    ('grannskapsmedian', predict_neigh),
    ('kombinerad', predict_combined),
]:
    errs = []
    for r in known:
        pred = fn(r, idx_known)
        errs.append(abs(pred - r['h']))
    mae = statistics.mean(errs)
    med = statistics.median(errs)
    p3 = 100 * sum(1 for e in errs if e <= 3) / len(errs)
    p6 = 100 * sum(1 for e in errs if e <= 6) / len(errs)
    print(f'{name:<28}{mae:7.2f}m{med:11.2f}m{p3:10.1f}%{p6:10.1f}%')
