"""Mäter vad en bättre höjdmodell faktiskt gör MED APPEN.

MAE i meter är en proxy. Den siffra som betyder något är hur många
uteserveringar som byter sol/skugga-status. Detta kör hela raycasten
(samma logik som src/shadow.js) med två höjdmodeller och jämför.
"""
import json, math, statistics
from collections import defaultdict, Counter

METERS_PER_LEVEL = 3.0
FLAT_DEFAULT = 15.0
MAX_RAY = 500.0
GRID_CELL_DEG = 0.001
RAD = math.pi / 180

# ---------------- solposition (samma Meeus-formler som SunCalc) ----------------
E_OBLIQ = RAD * 23.4397


def to_days(ts_ms):
    return ts_ms / 86400000.0 - 0.5 + 2440588 - 2451545


def sun_coords(d):
    M = RAD * (357.5291 + 0.98560028 * d)
    C = RAD * (1.9148 * math.sin(M) + 0.02 * math.sin(2 * M) + 0.0003 * math.sin(3 * M))
    L = M + C + RAD * 102.9372 + math.pi
    dec = math.asin(math.sin(0) * math.cos(E_OBLIQ) + math.cos(0) * math.sin(E_OBLIQ) * math.sin(L))
    ra = math.atan2(math.sin(L) * math.cos(E_OBLIQ) - math.tan(0) * math.sin(E_OBLIQ), math.cos(L))
    return dec, ra


def sun_position(ts_ms, lat, lon):
    lw = RAD * -lon
    phi = RAD * lat
    d = to_days(ts_ms)
    dec, ra = sun_coords(d)
    H = RAD * (280.16 + 360.9856235 * d) - lw - ra
    alt = math.asin(math.sin(phi) * math.sin(dec) + math.cos(phi) * math.cos(dec) * math.cos(H))
    az = math.atan2(math.sin(H), math.cos(H) * math.sin(phi) - math.tan(dec) * math.cos(phi))
    # SunCalc: azimut från söder, positiv mot väster -> kompassbäring
    bearing = ((az / RAD + 180) % 360 + 360) % 360
    return alt / RAD, bearing


# ---------------- geometri ----------------
def rings_of(geom):
    t = geom['type']
    if t == 'Polygon':
        return [geom['coordinates'][0]]
    if t == 'MultiPolygon':
        return [poly[0] for poly in geom['coordinates']]
    return []


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


print('laddar data...')
B = json.load(open('data/buildings.geojson'))
T = json.load(open('data/terraces.geojson'))

buildings = []
for f in B['features']:
    g = f.get('geometry')
    if not g:
        continue
    rs = rings_of(g)
    if not rs:
        continue
    xs = [c[0] for r in rs for c in r]
    ys = [c[1] for r in rs for c in r]
    p = f.get('properties', {})
    buildings.append({
        'rings': rs,
        'bbox': (min(xs), min(ys), max(xs), max(ys)),
        'clon': sum(xs) / len(xs), 'clat': sum(ys) / len(ys),
        'type': p.get('building', 'yes'),
        'known': known_height(p),
    })
print(f'  {len(buildings)} byggnader')

terraces = []
for f in T['features']:
    g = f.get('geometry')
    if not g:
        continue
    if g['type'] == 'Point':
        lon, lat = g['coordinates']
    else:
        rs = rings_of(g)
        if not rs:
            continue
        xs = [c[0] for r in rs for c in r]
        ys = [c[1] for r in rs for c in r]
        lon, lat = sum(xs) / len(xs), sum(ys) / len(ys)
    terraces.append({'lon': lon, 'lat': lat, 'name': f.get('properties', {}).get('name', '?')})
print(f'  {len(terraces)} terrasser')

# ---------------- höjdmodeller ----------------
by_type = defaultdict(list)
for b in buildings:
    if b['known'] is not None:
        by_type[b['type']].append(b['known'])
TYPE_MED = {t: statistics.median(v) for t, v in by_type.items() if len(v) >= 20}
GENERIC = {'yes', 'residential', 'roof', 'service', ''}

NCELL = 0.003
nidx = defaultdict(list)
for b in buildings:
    if b['known'] is not None:
        nidx[(int(b['clon'] // NCELL), int(b['clat'] // NCELL))].append(b['known'])


def neigh_median(b):
    c0, r0 = int(b['clon'] // NCELL), int(b['clat'] // NCELL)
    for rad in (1, 2, 3):
        vals = []
        for dc in range(-rad, rad + 1):
            for dr in range(-rad, rad + 1):
                vals.extend(nidx.get((c0 + dc, r0 + dr), ()))
        if len(vals) >= 5:
            return statistics.median(vals)
    return None


for b in buildings:
    if b['known'] is not None:
        b['h_flat'] = b['known']
        b['h_new'] = b['known']
        continue
    b['h_flat'] = FLAT_DEFAULT
    t = b['type']
    if t not in GENERIC and t in TYPE_MED:
        b['h_new'] = TYPE_MED[t]
    else:
        m = neigh_median(b)
        b['h_new'] = m if m is not None else TYPE_MED.get(t, FLAT_DEFAULT)

# ---------------- rutnätsindex ----------------
grid = defaultdict(list)
for i, b in enumerate(buildings):
    x0, y0, x1, y1 = b['bbox']
    for c in range(int(x0 // GRID_CELL_DEG), int(x1 // GRID_CELL_DEG) + 1):
        for r in range(int(y0 // GRID_CELL_DEG), int(y1 // GRID_CELL_DEG) + 1):
            grid[(c, r)].append(i)


def seg_intersect_dist(ax, ay, bx, by, cx, cy, dx_, dy_):
    """Parameter t längs AB där AB skär CD, annars None."""
    r_x, r_y = bx - ax, by - ay
    s_x, s_y = dx_ - cx, dy_ - cy
    den = r_x * s_y - r_y * s_x
    if den == 0:
        return None
    t = ((cx - ax) * s_y - (cy - ay) * s_x) / den
    u = ((cx - ax) * r_y - (cy - ay) * r_x) / den
    if 0 < t <= 1 and 0 <= u <= 1:
        return t
    return None


def shade_status(terr, alt_deg, bearing, hkey):
    if alt_deg <= 0:
        return 'night'
    lat0 = terr['lat']
    sx = 111320 * math.cos(lat0 * RAD)
    sy = 110540
    # strålens slutpunkt i grader
    br = bearing * RAD
    dlat = MAX_RAY * math.cos(br) / sy
    dlon = MAX_RAY * math.sin(br) / sx
    ex, ey = terr['lon'] + dlon, terr['lat'] + dlat
    rx0, ry0 = min(terr['lon'], ex), min(terr['lat'], ey)
    rx1, ry1 = max(terr['lon'], ex), max(terr['lat'], ey)

    tan_alt = math.tan(alt_deg * RAD)
    seen = set()
    for c in range(int(rx0 // GRID_CELL_DEG), int(rx1 // GRID_CELL_DEG) + 1):
        for r in range(int(ry0 // GRID_CELL_DEG), int(ry1 // GRID_CELL_DEG) + 1):
            for i in grid.get((c, r), ()):
                if i in seen:
                    continue
                seen.add(i)
                b = buildings[i]
                bx0, by0, bx1, by1 = b['bbox']
                if bx0 > rx1 or bx1 < rx0 or by0 > ry1 or by1 < ry0:
                    continue
                tmin = None
                for ring in b['rings']:
                    for k in range(len(ring) - 1):
                        t = seg_intersect_dist(terr['lon'], terr['lat'], ex, ey,
                                               ring[k][0], ring[k][1], ring[k + 1][0], ring[k + 1][1])
                        if t is not None and (tmin is None or t < tmin):
                            tmin = t
                if tmin is None:
                    continue
                dist = tmin * MAX_RAY
                if dist <= 0:
                    continue
                if b[hkey] >= dist * tan_alt:
                    return 'shade'
    return 'sun'


TIMES = [
    ('15 maj 17:00', 2026, 5, 15, 15),
    ('21 juni 18:00', 2026, 6, 21, 16),
    ('15 juli 19:00', 2026, 7, 15, 17),
    ('15 aug 16:00', 2026, 8, 15, 14),
    ('15 sep 15:00', 2026, 9, 15, 13),
]
import datetime

print()
print(f'{"tidpunkt":<16}{"sol→skugga":>12}{"skugga→sol":>12}{"ändrade":>10}{"andel":>9}')
print('-' * 60)
tot_changed = tot = 0
for label, Y, M, D, Hutc in TIMES:
    ts = datetime.datetime(Y, M, D, Hutc, tzinfo=datetime.timezone.utc).timestamp() * 1000
    alt, bearing = sun_position(ts, 55.60, 13.00)
    if alt <= 0:
        print(f'{label:<16}  (solen under horisonten)')
        continue
    a = b = 0
    for terr in terraces:
        s_old = shade_status(terr, alt, bearing, 'h_flat')
        s_new = shade_status(terr, alt, bearing, 'h_new')
        if s_old != s_new:
            if s_old == 'sun':
                a += 1
            else:
                b += 1
    ch = a + b
    tot_changed += ch
    tot += len(terraces)
    print(f'{label:<16}{a:12d}{b:12d}{ch:10d}{100*ch/len(terraces):8.1f}%'
          f'   (sol {alt:.1f}°)')

print('-' * 60)
print(f'{"TOTALT":<16}{"":12}{"":12}{tot_changed:10d}{100*tot_changed/tot:8.1f}%')
