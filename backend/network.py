"""Map data: states (KML), routes (GeoJSON) and network.json -> docs/data/map.json"""
import re
from pathlib import Path

from .geometry import rdp, thin
from . import schedules
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
    out, buildout_only = [], "Exists" not in routes  # (Today's routes from Amtrak's schedule: network.json is the buildout)
    for stage, kinds in routes.items():
        for kind, named in kinds.items():
            for name, route in named.items():
                parts = [p.strip() for p in str(route.get("status") or route.get("type") or "").split(",")]  # Either key works for the detail; commas list several ("Corridor ID Program, FRA Long-Distance Study")
                running = stage == "Exists" or any(p.lower() in ("exists", "suspended") for p in parts)  # A route running today that carries on into the buildout as it is (or suspended now)
                label = "Exists" if running else "Proposed"  # (The future section may be called "Future" or "Proposed")
                detail = ", ".join(dict.fromkeys(DETAILS.get(p.lower(), p) for p in parts if p and p.lower() not in (stage.lower(), label.lower())))  # Each once, in its usual spelling
                status = f"{label}: {detail}" if detail else label
                file = {} if route.get("branches") or not route.get("name") else {"geometry": route["name"]}  # An inner "name" names the GeoJSON file (branches name their own)
                out.append({**{k: v for k, v in route.items() if k not in ("status", "type", "name")}, **file, "name": name, "type": kind, "status": status, **({"today": False} if buildout_only else {})})
    return out

def build_route(route, files, cities):  # Route as the page uses it: traced line (or straight stop-to-stop), type and status
    src = files.get(key_name(route.get("geometry") or "")) or (None if route.get("today") else files.get(key_name(route["name"])))  # Its named file, else one matching the route (today's, from the schedule: the file own_file found)
    stops = [(cities[s]["lon"], cities[s]["lat"]) for s in route.get("stops", []) if s in cities]
    raw = stitch(geojson_lines(src), stops[0] if stops else None) if src else [stops]
    if src and route.get("today") and len(stops) > 1:
        raw = clip(raw, stops[0], stops[-1])  # (A file covering more than this run: just the stretch between its end stations)
    for key, a, b in route.get("detours", []):  # Stretches its file misses (e.g. the Floridian's trip into Tampa), from another file
        if key in files and a in cities and b in cities:
            raw += clip(stitch(geojson_lines(files[key]), (cities[a]["lon"], cities[a]["lat"])), (cities[a]["lon"], cities[a]["lat"]), (cities[b]["lon"], cities[b]["lat"]))
    route = {k: v for k, v in route.items() if k != "detours"}
    long = re.sub(r"[^a-z]", "", str(route.get("type", "")).lower()) in ("longdistance", "ld")
    status = str(route.get("status", "")).strip()
    return {
        **route, "traced": bool(src), "type": "Long-Distance" if long else "State-Supported", "typeKey": "long-distance" if long else "state",
        "status": next((s for s in STATUSES if s.lower() == status.lower()), status or "Proposed"),
        "lines": [rounded(rdp(thin(line, .005) if src else line, .007)) for line in raw if len(line) > 1]  # About 0.75 km of detail (the originals stay as they are)
    }

def track_of(path, memo={}):  # A route file's lines on the flat plane (km-like), lightly simplified, and their bounds
    if path not in memo:
        lines = [[flat(p) for p in rdp(thin(line, .005), .007)] for line in geojson_lines(path)]
        pts = [p for line in lines for p in line]
        memo[path] = (lines, (min(x for x, _ in pts), min(y for _, y in pts), max(x for x, _ in pts), max(y for _, y in pts)) if pts else None)
    return memo[path]

def gap_to(p, lines):  # Distance from a point to the nearest of some lines
    best = float("inf")
    for line in lines:
        for (ax, ay), (bx, by) in zip(line, line[1:]):
            dx, dy = bx - ax, by - ay
            t = max(0, min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy or 1)))
            best = min(best, ((p[0] - ax - t * dx) ** 2 + (p[1] - ay - t * dy) ** 2) ** .5)
    return best

def own_file(route, files, cities, mine=(), near=6):  # A route of today (from the schedule): the route file its stations lie along (all but a few within `near` km): one named like it first ("Bakersfield - Sacramento"), else one its network.json route is drawn from (`mine`), else the shortest
    pts = [flat((float(cities[n]["lon"]), float(cities[n]["lat"]))) for n in route["stops"] if n in cities]
    if len(pts) < 2:
        return None
    best = None
    for key, path in files.items():
        lines, box = track_of(path)
        if not box or sum(box[0] - near <= x <= box[2] + near and box[1] - near <= y <= box[3] + near for x, y in pts) < .9 * len(pts):
            continue
        share = sum(gap_to(p, lines) <= near for p in pts) / len(pts)
        if share < .9:
            continue
        length = sum(((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2) ** .5 for line in lines for a, b in zip(line, line[1:]))
        named = key in (key_name(route["name"]), key_name(" - ".join(route["name"].split(" - ")[::-1])))  # (Either way round)
        score = (named, key in mine, share, -length)
        if not best or score > best[0]:
            best = (score, path)
    return best and best[1].stem

def detours(route, main, files, cities, mine=(), near=6):  # Stations a route's file passes far from (a run into Tampa and back, say): for each stretch of them, another file that reaches them, cut to that stretch (file, from, to)
    if main not in files:
        return []
    names = [n for n in route["stops"] if n in cities]
    at = {n: flat((float(cities[n]["lon"]), float(cities[n]["lat"]))) for n in names}
    lines = track_of(files[main])[0]
    off = [gap_to(at[n], lines) > near for n in names]
    found = []
    k = 0
    while k < len(names):
        if not off[k]:
            k += 1
            continue
        j = k
        while j < len(names) and off[j]:
            j += 1
        missed = names[k:j]
        ends = [names[i] for i in (k - 1, j) if 0 <= i < len(names)]  # The stations either side, on the route's file
        best = None
        for key, path in files.items():
            if key == main:
                continue
            other, _ = track_of(path)
            if any(gap_to(at[n], other) > near for n in missed):
                continue
            joined = [n for n in ends if gap_to(at[n], other) <= near]
            if not joined:  # (Must meet the route's line)
                continue
            length = sum(((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2) ** .5 for line in other for a, b in zip(line, line[1:]))
            score = (key in mine, len(set(joined)), -length)
            if not best or score > best[0]:
                best = (score, key, list(dict.fromkeys(joined + missed)))
        if best:
            pts = best[2]  # Cut between the two of these farthest apart
            a, b = max(((x, y) for x in pts for y in pts), key=lambda xy: (at[xy[0]][0] - at[xy[1]][0]) ** 2 + (at[xy[0]][1] - at[xy[1]][1]) ** 2)
            found.append([best[1], a, b])
        k = j
    return found

def clip(raw, a, b):  # Stitched lines cut to the stretch between two points (lon/lat) on them
    line = [p for part in raw for p in part]
    if len(line) < 2:
        return raw
    xy = [flat(p) for p in line]
    def at(p):  # Position along the line nearest p: (segment, fraction)
        q, best = flat(p), (float("inf"), 0, 0)
        for k in range(1, len(xy)):
            (ax, ay), (bx, by) = xy[k - 1], xy[k]
            dx, dy = bx - ax, by - ay
            t = max(0, min(1, ((q[0] - ax) * dx + (q[1] - ay) * dy) / (dx * dx + dy * dy or 1)))
            d = (q[0] - ax - t * dx) ** 2 + (q[1] - ay - t * dy) ** 2
            if d < best[0]:
                best = (d, k, t)
        return best[1], best[2]
    point = lambda k, t: (line[k - 1][0] + (line[k][0] - line[k - 1][0]) * t, line[k - 1][1] + (line[k][1] - line[k - 1][1]) * t)
    (ka, ta), (kb, tb) = at(a), at(b)
    if (ka, ta) > (kb, tb):
        (ka, ta), (kb, tb), flip = (kb, tb), (ka, ta), True
    else:
        flip = False
    out = [point(ka, ta), *line[ka:kb], point(kb, tb)]
    return [out[::-1] if flip else out]

def province(c):  # A station outside every state: British Columbia if named so, Quebec around Montréal, else Ontario
    lon, lat = float(c["lon"]), float(c["lat"])
    if "(BC)" in c["name"]:
        return "BC"
    if lat < 41.6 or lon < -95:  # (Not near Ontario or Quebec: a state's outline just missed it, so none)
        return ""
    return "QC" if lon > -74.6 and lat > 45 else "ON"

def inside(pt, rings):  # Point in polygon (any ring)
    x, y, hit = pt[0], pt[1], False
    for ring in rings:
        for (ax, ay), (bx, by) in zip(ring, ring[-1:] + ring[:-1]):
            if (ay > y) != (by > y) and x < ax + (y - ay) * (bx - ax) / (by - ay):
                hit = not hit
    return hit

def flat(pt):  # Lon/lat -> rough km-like plane (what the page's own map units are, near enough), for distances
    return (pt[0] * 77, -pt[1] * 100)

def far_stops(routes, cities, limit=40):  # Stops nowhere near their route's traced line (km): usually two places sharing one name (e.g. Hudson, NY and Hudson, WI as one "Hudson")
    def gap(p, a, b):  # Point to segment, on the flat plane
        (px, py), (ax, ay), (bx, by) = p, a, b
        dx, dy = bx - ax, by - ay
        t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) if dx or dy else 0
        return ((px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2) ** .5
    far = {}  # Station -> routes it's far from
    for r in routes:
        lines = [[flat(pt) for pt in line] for line in r["lines"] if len(line) > 1] if r["traced"] else []
        for s in r.get("stops", []) if lines else []:
            if s in cities:
                p = flat((float(cities[s]["lon"]), float(cities[s]["lat"])))
                if min(gap(p, a, b) for line in lines for a, b in zip(line, line[1:])) > limit:
                    far.setdefault(s, []).append(r["name"])
    for s, names in far.items():
        print(f"  Warning: \"{s}\" is placed far from {', '.join(dict.fromkeys(names))}, which stop there. If these are two different places, give each its own station with its state in brackets, e.g. \"Springfield (IL)\".")

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
    if out.exists() and out.stat().st_mtime >= newest([*geo, *listing(REGIONAL, "*.geojson"), NETWORK, Path(__file__), Path(schedules.__file__), *schedules.schedule_files()]) and read_json(out).get("density") == density:
        return False
    net = read_json(NETWORK, {})
    listed_cities = net.get("stations", net.get("cities", {}))
    cities = {c["name"]: c for c in map(with_latlon, [{**c, "name": n} for n, c in listed_cities.items()] if isinstance(listed_cities, dict) else listed_cities) if -130 < float(c["lon"]) < -50 and float(c["lat"]) > 24}  # Keyed by name (older files: a list); none in Alaska, Hawaii or the territories
    files = {key_name(p.stem): p for p in geo}
    expanded = [x for r in listed(net.get("routes", [])) for x in ([{**{k: v for k, v in r.items() if k != "branches"}, **b, "group": r["name"]} for b in r["branches"]] if r.get("branches") else [r])]  # Branches as routes
    if "Exists" not in net.get("routes", {}):  # Today's routes: Amtrak's schedule (data/gtfs), named like the network.json routes they match
        notes = net.get("today", {})  # Today's routes' notes: "Floridian": "Temporary"; or, for one in no schedule, its run: "Winter Park Express": {"status": "Temporary", "name": "Denver - Winter Park", "stops": [...]}
        today = schedules.today_routes(list(cities.values()), expanded, notes)
        running = {r["group"] for r in today}
        kinds = {r.get("group") or r["name"]: r["type"] for r in expanded}
        for label, note in notes.items():  # In no schedule, but its run is given
            if isinstance(note, dict) and label not in running:
                for b in note.get("branches") or [note]:
                    if b.get("stops"):
                        today.append({"name": b.get("name") or label, "group": label, "type": note.get("type") or kinds.get(label, "State-Supported"), "status": f"Exists: {note['status']}" if note.get("status") else "Exists", "stops": b["stops"], "today": True, "geometry": b.get("name")})
                running.add(label)
        for r in expanded:  # Running unchanged in network.json but in no schedule (seasonal, or missing from them): on Present Day as network.json has it
            status = str(r.get("status", "")).lower()
            if status.startswith("exists") and "suspended" not in status and (r.get("group") or r["name"]) not in running:
                r["both"] = True
        own = {}  # Route name -> the files its network.json versions are drawn from
        for r in expanded:
            own.setdefault(r.get("group") or r["name"], set()).add(key_name(r.get("geometry") or r["name"]))
        for r in today:  # Drawn from your own route files (data/routes/intercity), where one runs along all its stations
            if not r.get("geometry"):
                r["geometry"] = own_file(r, files, cities, own.get(r["group"], ()))
            extra = detours(r, key_name(r.get("geometry") or ""), files, cities, own.get(r["group"], ()))
            if extra:
                r["detours"] = extra
        if not today:
            print("  No routes for Present Day: run update_schedules.py to download the train schedules")
        expanded = today + expanded
    states, routes = read_states(), [build_route(r, files, cities) for r in expanded]
    routes = [r for r in routes if "unofficial" not in str(r.get("status", "")).lower()]  # AAO's unofficial routes: kept in network.json, not on the map (for now)
    far_stops(routes, cities)
    snap_to_track(routes, cities)  # Worked out here once, not on every page load
    for c in cities.values():  # Each station's state, likewise
        c["state"] = next((s["id"].upper() for s in states if inside((float(c["lon"]), float(c["lat"])), s["rings"])), "") or province(c)  # (Outside every state: Canada)
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
