"""Map data: states (KML), routes (GeoJSON) and network.json -> docs/data/map.json"""
import re
from pathlib import Path

from .geometry import rdp, thin
from .paths import INTERCITY, NETWORK, ON_MAP, OUT_DATA, REGIONAL, ROUTES, STATES, listing, newest, read_json, write_json

STATUSES = ["Exists", "Exists: Temporary", "Exists: Suspended", "Suspended", "Proposed: Funded", "Proposed: Corridor ID Program", "Proposed: FRA Long-Distance Study", "Proposed: Unofficial"]
DETAILS = {d.lower(): d for d in ["Temporary", "Suspended", "Corridor ID Program", "FRA Long-Distance Study", "Funded", "Unofficial"]}  # Known details, as they're written on the page

def key_name(name):  # "Lake Shore Limited" -> "lakeshorelimited", for matching file names
    return re.sub(r"[^a-z0-9]", "", name.lower())

def read_states():  # State outlines from data/states/<ID>/<ID>.kml, simplified
    states = []
    for kml in listing(STATES, "*/*.kml"):
        if kml.parent.name.upper() not in ON_MAP:
            continue
        text = kml.read_text(encoding="utf-8", errors="ignore")
        blocks = re.findall(r"<outerBoundaryIs>.*?<coordinates>([^<]+)</coordinates>", text, re.S) or re.findall(r"<coordinates>([^<]+)</coordinates>", text)
        rings = []
        for block in blocks:
            ring = rdp(thin([tuple(map(float, pt.split(",")[:2])) for pt in block.split()], .002), .003)
            if len(ring) >= 4:
                rings.append(ring)
        if rings and kml.parent.name not in [s["id"] for s in states]:
            states.append({"id": kml.parent.name, "rings": rings})
    return states

def geojson_lines(path):  # Every line in a GeoJSON file
    lines = []
    for feature in read_json(path).get("features", []):
        geom = feature.get("geometry") or {}
        parts = {"LineString": [geom.get("coordinates")], "MultiLineString": geom.get("coordinates")}.get(geom.get("type")) or []
        lines += [[(c[0], c[1]) for c in part] for part in parts if part and len(part) > 1]
    return lines

def stitch(parts, start, gap=.05):  # Chain line pieces end to end, nearest first, from `start`
    parts, out, cur = [list(p) for p in parts], [], start or (parts[0][0] if parts else None)
    near = lambda a, b: (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2
    while parts:
        k, rev = min(((k, rev) for k in range(len(parts)) for rev in (0, 1)), key=lambda c: near(cur, parts[c[0]][-c[1]]))
        line = parts.pop(k)[::-1 if rev else 1]
        if out and near(out[-1][-1], line[0]) < gap * gap:
            out[-1] += line[1:] if out[-1][-1] == line[0] else line
        else:
            out.append(line)
        cur = line[-1]
    return out

def rounded(line):  # About 100 m precision is plenty
    return [[round(x, 3), round(y, 3)] for x, y in line]

def with_latlon(city):  # Cities may give "coords": [lat, lon] or separate lat/lon
    lat, lon = city.get("coords") or (city.get("lat"), city.get("lon"))
    return {**{k: v for k, v in city.items() if k != "coords"}, "lat": lat, "lon": lon}

def listed(routes):  # Nested {stage: {type: {name: route}}} -> flat list, status like "Proposed: Unofficial"
    if isinstance(routes, list):  # Older files: already a list
        return routes
    out = []
    for stage, kinds in routes.items():
        for kind, named in kinds.items():
            for name, route in named.items():
                parts = [p.strip() for p in str(route.get("status") or route.get("type") or "").split(",")]  # Either key works for the detail; commas list several ("Corridor ID Program, FRA Long-Distance Study")
                detail = ", ".join(dict.fromkeys(DETAILS.get(p.lower(), p) for p in parts if p and p.lower() != stage.lower()))  # Each once, in its usual spelling
                status = f"{stage}: {detail}" if detail else stage
                file = {} if route.get("branches") or not route.get("name") else {"geometry": route["name"]}  # An inner "name" names the GeoJSON file (branches name their own)
                out.append({**{k: v for k, v in route.items() if k not in ("status", "type", "name")}, **file, "name": name, "type": kind, "status": status})
    return out

def build_route(route, files, cities):  # Route as the page uses it: traced line (or straight stop-to-stop), type and status
    src = files.get(key_name(route.get("geometry") or "")) or files.get(key_name(route["name"]))  # Its named file, else one matching the route
    stops = [(cities[s]["lon"], cities[s]["lat"]) for s in route.get("stops", []) if s in cities]
    raw = stitch(geojson_lines(src), stops[0] if stops else None) if src else [stops]
    long = re.sub(r"[^a-z]", "", str(route.get("type", "")).lower()) in ("longdistance", "ld")
    status = str(route.get("status", "")).strip()
    return {
        **route, "traced": bool(src), "type": "Long-Distance" if long else "State-Supported", "typeKey": "long-distance" if long else "state",
        "status": next((s for s in STATUSES if s.lower() == status.lower()), status or "Proposed"),
        "lines": [rounded(rdp(thin(line, .005) if src else line, .007)) for line in raw if len(line) > 1]  # About 0.75 km of detail (the originals stay as they are)
    }

def inside(pt, rings):  # Point in polygon (any ring)
    x, y, hit = pt[0], pt[1], False
    for ring in rings:
        for (ax, ay), (bx, by) in zip(ring, ring[-1:] + ring[:-1]):
            if (ay > y) != (by > y) and x < ax + (y - ay) * (bx - ax) / (by - ay):
                hit = not hit
    return hit

def flat(pt):  # Lon/lat -> rough km-like plane (what the page's own map units are, near enough), for distances
    return (pt[0] * 77, -pt[1] * 100)

def snap_to_track(routes, cities):  # Straight routes follow traced track wherever both stops lie on it (6 units ~ 6 km off the track at most)
    tracks = [(xy, ll) for r in routes if r["traced"] for xy, ll in zip([[flat(p) for p in line] for line in r["lines"]], r["lines"])]
    dist = lambda a, b: ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** .5
    def locate(run, p):  # Closest point on a run: distance, position along it, segment end, point (plane and lon/lat)
        best = (float("inf"),)
        for k in range(1, len(run)):
            (ax, ay), (bx, by) = run[k - 1], run[k]
            dx, dy = bx - ax, by - ay
            t = max(0, min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy or 1)))
            q = (ax + t * dx, ay + t * dy)
            d = dist(p, q)
            if d < best[0]:
                best = (d, k - 1 + t, k, t)
        return best
    def between(a, b):  # Shortest stretch of traced track joining two stations (lon/lat), or None
        found = None
        for xy, ll in tracks:
            A, B = locate(xy, a), locate(xy, b)
            if A[0] > 6 or B[0] > 6:
                continue
            fwd = A[1] <= B[1]
            s, e = (A, B) if fwd else (B, A)
            path = xy[s[2]:e[2]]
            length = sum(dist(path[i], path[i + 1]) for i in range(len(path) - 1)) + (dist(a, path[0]) + dist(path[-1], b) if path else dist(a, b))
            if length > dist(a, b) * 1.6 + 10 or (found and length >= found[0]):
                continue
            pts = ll[s[2]:e[2]]
            found = (length, pts if fwd else pts[::-1])
        return found and found[1]
    for r in routes:
        if r["traced"] or not tracks:
            continue
        stops = [(cities[n]["lon"], cities[n]["lat"]) for n in r.get("stops", []) if n in cities]
        if len(stops) < 2:
            continue
        run, snapped = [list(stops[0])], 0
        for a, b in zip(stops, stops[1:]):
            track = between(flat(a), flat(b))
            if track:
                snapped += 1
                run += [list(p) for p in track]
            run.append(list(b))
        if snapped:
            r["lines"] = [rounded(run)]

def overlaps(routes):  # How much each pair of route groups shares track: the page picks distinct colours from it
    cell, owners = .06, {}
    for r in routes:
        label = r.get("group") or r["name"]
        for line in r["lines"]:
            for (x0, y0), (x1, y1) in zip(line, line[1:]):
                n = max(1, int(((x1 - x0) ** 2 + (y1 - y0) ** 2) ** .5 / .02) + 1)
                for k in range(n + 1):
                    cx, cy = int((x0 + (x1 - x0) * k / n) // cell), int((y0 + (y1 - y0) * k / n) // cell)
                    for i in (-1, 0, 1):
                        for j in (-1, 0, 1):
                            owners.setdefault((cx + i, cy + j), set()).add(label)
    share = {}
    for labels in owners.values():
        for a in labels:
            for b in labels:
                if a < b:
                    share[(a, b)] = share.get((a, b), 0) + 1
    return [[a, b, n] for (a, b), n in sorted(share.items())]

REGIONAL_NAME = re.compile(r"^\[(?P<operator>[^\]]+)\]\s*(?P<name>[^(\[]*?)\s*(?:\((?P<branch>[^)]*)\))?\s*(?P<tags>(?:\[[^\]]*\]\s*)*)$")  # "[MTA] Hudson Line (Penn Station) [Future]": trailing [tags] never show

FUTURE_TAG = re.compile(r"\[(future|extension|extended|expansion|proposed|planned)\]", re.I)  # Tags marking a version that only exists in the buildout

def read_regional():  # Commuter lines, each with its eras (a future file replaces its branch in the buildout, or is new there)
    found = {}
    for path in listing(REGIONAL, "*.geojson"):
        m = REGIONAL_NAME.match(path.stem)
        if m and m["name"]:
            lines = [rounded(rdp(thin(line, .003), .004)) for line in geojson_lines(path)]  # About 0.4 km of detail: short lines, seen close up (coarser, they wander off their track)
            found.setdefault((m["operator"].strip(), m["name"], (m["branch"] or "").strip().lower()), {})["future" if FUTURE_TAG.search(m["tags"]) else "today"] = [l for l in lines if len(l) > 1]
    out = []
    for (operator, name, _), versions in sorted(found.items()):
        for era, lines in versions.items():
            eras = ["today"] if era == "today" and "future" in versions else ["today", "buildout"] if era == "today" else ["buildout"]
            out.append({"operator": operator, "name": name, "eras": eras, "lines": lines})
    return out

def build(density):  # Write map.json if a route, station or commuter line changed (the states never do); returns True if it did
    out, geo = OUT_DATA / "map.json", listing(INTERCITY, "*.geojson") or listing(ROUTES, "*.geojson")  # (Older layout: the routes' files straight in routes/)
    if out.exists() and out.stat().st_mtime >= newest([*geo, *listing(REGIONAL, "*.geojson"), NETWORK, Path(__file__)]) and read_json(out).get("density") == density:
        return False
    net = read_json(NETWORK, {})
    listed_cities = net.get("stations", net.get("cities", {}))
    cities = {c["name"]: c for c in map(with_latlon, [{**c, "name": n} for n, c in listed_cities.items()] if isinstance(listed_cities, dict) else listed_cities) if -130 < float(c["lon"]) < -50 and float(c["lat"]) > 24}  # Keyed by name (older files: a list); none in Alaska, Hawaii or the territories
    files = {key_name(p.stem): p for p in geo}
    expanded = [x for r in listed(net.get("routes", [])) for x in ([{**{k: v for k, v in r.items() if k != "branches"}, **b, "group": r["name"]} for b in r["branches"]] if r.get("branches") else [r])]  # Branches as routes
    states, routes = read_states(), [build_route(r, files, cities) for r in expanded]
    snap_to_track(routes, cities)  # Worked out here once, not on every page load
    for c in cities.values():  # Each station's state, likewise
        c["state"] = next((s["id"].upper() for s in states if inside((float(c["lon"]), float(c["lat"])), s["rings"])), "")
    write_json(out, {
        "states": [{"id": s["id"], "rings": [rounded(r) for r in s["rings"]]} for s in states],
        "cities": list(cities.values()),
        "routes": routes,
        "overlaps": overlaps(routes),
        "regional": read_regional(),
        "snapped": True,
        "density": density
    })
    return True
