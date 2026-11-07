# Map data: states, routes and network.json -> docs/data/map.json
import re
from collections.abc import Iterable, Sequence
from functools import cache
from pathlib import Path
from typing import Any

from . import schedules
from .geometry import Line, Point, Pt, dist, flat, gap_to, length, lonlat, nearest, rdp, thin
from .names import bare, codes_of, label_of, name_key
from .paths import FRONTEND, INTERCITY, NETWORK, ON_MAP, OUT_DATA, REGIONAL, STATES, Json, cache_set, listing, newest, read_json, write_json

TRAINS = {"airo": ["charger-rear", "venture-side", "venture-side", "venture-side", "charger-side"]} # A kind of train -> its cars' pictures in frontend/trains, rear first: "equipment": "Airo" on a route
STATUSES = ["Exists", "Exists: Temporary", "Exists: Suspended", "Suspended", "Proposed: Funded", "Proposed: Corridor ID Program", "Proposed: FRA Long-Distance Study", "Proposed: Unofficial"]
DETAILS = {d.lower(): d for d in ["Temporary", "Suspended", "Corridor ID Program", "FRA Long-Distance Study", "Funded", "Unofficial"]} # Known details, as they're written on the page
REGIONAL_NAME = re.compile(r"^\[(?P<operator>[^\]]+)\]\s*(?P<name>[^(\[]*?)\s*(?:\((?P<branch>[^)]*)\))?\s*(?P<tags>(?:\[[^\]]*\]\s*)*)$") # "[MTA] Hudson Line [Future]": trailing [tags] never show
FUTURE_TAG = re.compile(r"\[(future|extension|extended|expansion|proposed|planned)\]", re.I) # Tags marking a version that only exists in the buildout

Files = dict[str, Path] # Route file key -> its .geojson
Cities = dict[str, Json] # Station name -> its details
Detour = list[str] # [file key, station, station]: a stretch drawn from another file

def read_states() -> list[Json]: # State outlines from data/states/<ID>/<ID>.kml, simplified
    states: list[Json] = []
    for kml in listing(STATES, "*/*.kml") + listing(STATES, "*/*/*.kml"): # Each state's folder, or inside census/
        if kml.parent.name.upper() not in ON_MAP or kml.parent.name in [s["id"] for s in states]:
            continue

        text = kml.read_text(encoding="utf-8", errors="ignore")
        blocks = re.findall(r"<outerBoundaryIs>.*?<coordinates>([^<]+)</coordinates>", text, re.S) or re.findall(r"<coordinates>([^<]+)</coordinates>", text)
        rings = [ring for block in blocks if len(ring := rdp(thin([(float(x), float(y)) for x, y, *_ in (pt.split(",") for pt in block.split())], .002), .003)) >= 4]
        if rings:
            states.append({"id": kml.parent.name, "rings": rings})

    return states

def geojson_lines(path: Path) -> list[Line]: # Every line in a GeoJSON file
    lines: list[Line] = []
    for feature in read_json(path).get("features", []):
        geom = feature.get("geometry") or {}
        parts = {"LineString": [geom.get("coordinates")], "MultiLineString": geom.get("coordinates")}.get(geom.get("type", "")) or []
        lines += [[(c[0], c[1]) for c in part] for part in parts if part and len(part) > 1]

    return lines

def stitch(parts: Iterable[Sequence[Point]], start: Pt | None, gap: float = .05) -> list[Line]: # Chain line pieces end to end, nearest first, from `start`
    pool, out = [list(p) for p in parts], list[Line]()
    cur = start or (pool[0][0] if pool else (0, 0))
    def near(a: Pt, b: Pt) -> float:
        return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2

    while pool:
        k, rev = min(((k, rev) for k in range(len(pool)) for rev in (0, 1)), key=lambda c: near(cur, pool[c[0]][-c[1]]))
        line = pool.pop(k)[::-1 if rev else 1]
        if out and near(out[-1][-1], line[0]) < gap * gap:
            out[-1] += line[1:] if out[-1][-1] == line[0] else line
        else:
            out.append(line)

        cur = line[-1]

    return out

def rounded(line: Iterable[Pt]) -> list[list[float]]: # About 100 m precision is plenty
    return [[round(x, 3), round(y, 3)] for x, y in line]

def with_latlon(city: Json) -> Json: # Cities may give "coords": [lat, lon] or separate lat/lon
    lat, lon = city.get("coords") or (city.get("lat"), city.get("lon"))
    return {**{k: v for k, v in city.items() if k != "coords"}, "lat": lat, "lon": lon}

def map_cities(net: Json) -> Cities: # network.json's stations on the map, each with its name
    found = {n: {**with_latlon(c), "name": n} for n, c in stations_in(net).items()}
    return {n: c for n, c in found.items() if -130 < float(c["lon"]) < -50 and float(c["lat"]) > 24}

def stations_in(net: Json) -> Cities: # Older files: "cities"
    return net.get("stations", net.get("cities", {}))

def statuses(route: Json) -> list[str]: # Its status list: ["Corridor ID Program"]
    s = route.get("status", route.get("type", ""))
    return [p.strip() for p in (s if isinstance(s, list) else str(s).split(",")) if p.strip()]

def project(route: Json) -> Any: # [title, about], as the page reads it
    p = route.get("project")
    return [p.get("title", ""), p.get("about", "")] if isinstance(p, dict) else p

def branch(b: Json) -> Json: # A branch as a route: its file names it
    file = b.get("file") or b.get("name")
    return {**{k: v for k, v in b.items() if k not in ("file", "status", "type")}, **({"name": file, "geometry": file} if file else {}), **({"project": project(b)} if b.get("project") else {})}

def listed(routes: Json) -> tuple[list[Json], dict[str, Json | str]]: # Network.json's routes as a flat list of buildout routes, and today's notes
    kinds: dict[str, dict[str, Json]] = routes.get("Future", routes) # Older files: one "Future" section around them
    out: list[Json] = []
    notes: dict[str, Json | str] = {}
    for kind, named in kinds.items():
        for name, route in named.items():
            parts = statuses(route)
            if any(p.lower() == "temporary" for p in parts): # Running today only
                notes[name] = {**{k: v for k, v in route.items() if k not in ("status", "type", "file")}, "status": "Temporary", "type": kind, **({"name": route["file"]} if route.get("file") else {})} if route.get("stops") or route.get("branches") else "Temporary"
                continue

            label = "Exists" if any(p.lower() in ("exists", "suspended") for p in parts) else "Proposed" # Running today and carrying on as it is
            detail = ", ".join(dict.fromkeys(DETAILS.get(p.lower(), p) for p in parts if p.lower() not in ("future", label.lower())))
            file = route.get("file") or route.get("name")
            r = {k: v for k, v in route.items() if k not in ("status", "type", "name", "file", "project", "branches")}
            r |= {"name": name, "type": kind, "status": f"{label}: {detail}" if detail else label, "today": False}
            r |= {"geometry": file} if file and not route.get("branches") else {}
            r |= {"project": project(route)} if route.get("project") else {}
            r |= {"branches": [branch(b) for b in route["branches"]]} if route.get("branches") else {}
            out.append(r)

    return out, notes

def expand(routes: Iterable[Json]) -> list[Json]: # Branches as routes of their own
    return [x for r in routes for x in ([{**{k: v for k, v in r.items() if k != "branches"}, **b, "group": r["name"]} for b in r["branches"]] if r.get("branches") else [r])]

def build_route(route: Json, files: Files, cities: Cities) -> Json: # Route as the page uses it: traced line, type and status
    src = files.get(name_key(route.get("geometry") or "")) or (None if route.get("today") else files.get(name_key(route["name"]))) # Its named file, else one matching the route
    stops = [lonlat(cities[s]) for s in route.get("stops", []) if s in cities]
    raw = stitch(geojson_lines(src), stops[0] if stops else None) if src else [stops]
    if src and route.get("today") and len(stops) > 1:
        raw = clip(raw, stops[0], stops[-1]) # A file covering more than this run

    for key, a, b in route.get("detours", []): # Stretches its file misses, from another file
        if key in files and a in cities and b in cities:
            raw += clip(stitch(geojson_lines(files[key]), lonlat(cities[a])), lonlat(cities[a]), lonlat(cities[b]))

    long = re.sub(r"[^a-z]", "", str(route.get("type", "")).lower()) in ("longdistance", "ld")
    status = str(route.get("status", "")).strip()
    return {
        **{k: v for k, v in route.items() if k != "detours"}, "traced": bool(src), "type": "Long-Distance" if long else "State-Supported", "typeKey": "long-distance" if long else "state",
        "status": next((s for s in STATUSES if s.lower() == status.lower()), status or "Proposed"),
        "lines": [rounded(rdp(thin(line, .005) if src else line, .007)) for line in raw if len(line) > 1] # About 0.75 km of detail
    }

@cache
def track_of(path: Path) -> tuple[list[Line], tuple[float, float, float, float] | None]: # A route file's lines on the flat plane, lightly simplified, and their bounds
    lines = [[flat(p) for p in rdp(thin(line, .005), .007)] for line in geojson_lines(path)]
    xs, ys = [x for line in lines for x, _ in line], [y for line in lines for _, y in line]
    return lines, (min(xs), min(ys), max(xs), max(ys)) if xs else None

def flat_stops(names: Iterable[str], cities: Cities) -> dict[str, Point]: # Stations on the map, on the flat plane
    return {n: flat(lonlat(cities[n])) for n in names if n in cities}

def own_file(route: Json, files: Files, cities: Cities, mine: Iterable[str] = (), near: float = 6) -> str | None: # A route of today
    pts = [flat(lonlat(cities[n])) for n in route["stops"] if n in cities] # Each time it calls
    if len(pts) < 2:
        return None

    best: tuple[tuple[bool, bool, float, float], Path] | None = None
    for key, path in files.items():
        lines, box = track_of(path)
        if not box or sum(box[0] - near <= x <= box[2] + near and box[1] - near <= y <= box[3] + near for x, y in pts) < .9 * len(pts):
            continue

        share = sum(gap_to(p, lines) <= near for p in pts) / len(pts)
        if share < .9:
            continue

        named = key in (name_key(route["name"]), name_key(" - ".join(route["name"].split(" - ")[::-1]))) # Either way round
        score = (named, key in mine, share, -length(lines))
        if not best or score > best[0]:
            best = (score, path)

    return best[1].stem if best else None

def detours(route: Json, main: str, files: Files, cities: Cities, mine: Iterable[str] = (), near: float = 6) -> list[Detour]: # Stations a route's file passes far from
    if main not in files:
        return []

    at = flat_stops(route["stops"], cities)
    names, lines = [n for n in route["stops"] if n in at], track_of(files[main])[0]
    off = [gap_to(at[n], lines) > near for n in names]
    found: list[Detour] = []
    k = 0
    while k < len(names):
        if not off[k]:
            k += 1
            continue

        j = k
        while j < len(names) and off[j]:
            j += 1

        missed = names[k:j]
        ends = [names[i] for i in (k - 1, j) if 0 <= i < len(names)] # The stations either side, on the route's file
        best: tuple[tuple[bool, int, float], str, list[str]] | None = None
        for key, path in files.items():
            other = track_of(path)[0]
            if key == main or any(gap_to(at[n], other) > near for n in missed):
                continue

            joined = [n for n in ends if gap_to(at[n], other) <= near]
            if not joined: # Must meet the route's line
                continue

            score = (key in mine, len(set(joined)), -length(other))
            if not best or score > best[0]:
                best = (score, key, list(dict.fromkeys(joined + missed)))

        if best:
            pts = best[2] # Cut between the two of these farthest apart
            a, b = max(((x, y) for x in pts for y in pts), key=lambda xy: dist(at[xy[0]], at[xy[1]]))
            found.append([best[1], a, b])

        k = j

    return found

def clip(raw: list[Line], a: Pt, b: Pt) -> list[Line]: # Stitched lines cut to the stretch between two points on them
    line = [p for part in raw for p in part]
    if len(line) < 2:
        return raw

    xy = [flat(p) for p in line]
    def at(p: Pt) -> tuple[int, float]:
        return nearest(flat(p), xy)[1:]

    def point(k: int, t: float) -> Point:
        return (line[k - 1][0] + (line[k][0] - line[k - 1][0]) * t, line[k - 1][1] + (line[k][1] - line[k - 1][1]) * t)

    A, B = at(a), at(b)
    (ka, ta), (kb, tb) = sorted((A, B))
    out = [point(ka, ta), *line[ka:kb], point(kb, tb)]
    return [out[::-1] if A > B else out]

def province(c: Json) -> str: # A station outside every state
    lon, lat = lonlat(c)
    if "(BC)" in c["name"]:
        return "BC"

    if lat < 41.6 or lon < -95: # Not near Ontario or Quebec
        return ""

    return "QC" if lon > -74.6 and lat > 45 else "ON"

def inside(pt: Pt, rings: Iterable[Sequence[Pt]]) -> bool: # Point in polygon
    x, y, hit = pt[0], pt[1], False
    for ring in rings:
        for (ax, ay), (bx, by) in zip(ring, [*ring[-1:], *ring[:-1]]):
            if (ay > y) != (by > y) and x < ax + (y - ay) * (bx - ax) / (by - ay):
                hit = not hit

    return hit

def far_stops(routes: Iterable[Json], cities: Cities, limit: float = 40) -> None: # Stops nowhere near their route's traced line
    far: dict[str, list[str]] = {}
    for r in routes:
        lines = [[flat(pt) for pt in line] for line in r["lines"]] if r["traced"] else []
        for s, p in flat_stops(r.get("stops", []) if lines else [], cities).items():
            if gap_to(p, lines) > limit:
                far.setdefault(s, []).append(r["name"])

    for s, names in far.items():
        print(f"  Warning: \"{s}\" is placed far from {', '.join(dict.fromkeys(names))}, which stop there. If these are two different places, give each its own station with its state in brackets, e.g. \"Springfield (IL)\".")

def snap_to_track(routes: Iterable[Json], cities: Cities) -> None: # Straight routes follow traced track wherever both stops lie on it
    routes = list(routes)
    tracks = [(xy, ll) for r in routes if r["traced"] for xy, ll in zip([[flat(p) for p in line] for line in r["lines"]], r["lines"])]
    def locate(run: Sequence[Pt], p: Pt) -> tuple[float, float, int]: # Closest point on a run
        d, k, t = nearest(p, run)
        return d, k - 1 + t, k

    def between(a: Point, b: Point) -> list[Pt] | None: # Shortest stretch of traced track joining two stations, or None
        found: tuple[float, list[Pt]] | None = None
        for xy, ll in tracks:
            A, B = locate(xy, a), locate(xy, b)
            if A[0] > 6 or B[0] > 6:
                continue

            fwd = A[1] <= B[1]
            s, e = (A, B) if fwd else (B, A)
            path = xy[s[2]:e[2]]
            size = length([path]) + (dist(a, path[0]) + dist(path[-1], b) if path else dist(a, b))
            if size > dist(a, b) * 1.6 + 10 or (found and size >= found[0]):
                continue

            pts = ll[s[2]:e[2]]
            found = (size, pts if fwd else pts[::-1])

        return found[1] if found else None

    for r in routes:
        stops = [lonlat(cities[n]) for n in r.get("stops", []) if n in cities]
        if r["traced"] or not tracks or len(stops) < 2:
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

def overlaps(routes: Iterable[Json]) -> list[list[Any]]: # How much each pair of route groups shares track
    cell, owners = .06, dict[tuple[int, int], set[str]]()
    for r in routes:
        label = label_of(r)
        for line in r["lines"]:
            for (x0, y0), (x1, y1) in zip(line, line[1:]):
                n = max(1, int(((x1 - x0) ** 2 + (y1 - y0) ** 2) ** .5 / .02) + 1)
                for k in range(n + 1):
                    cx, cy = int((x0 + (x1 - x0) * k / n) // cell), int((y0 + (y1 - y0) * k / n) // cell)
                    for i in (-1, 0, 1):
                        for j in (-1, 0, 1):
                            owners.setdefault((cx + i, cy + j), set()).add(label)

    share: dict[tuple[str, str], int] = {}
    for labels in owners.values():
        for a in labels:
            for b in labels:
                if a < b:
                    share[(a, b)] = share.get((a, b), 0) + 1

    return [[a, b, n] for (a, b), n in sorted(share.items())]

def read_regional() -> list[Json]: # Commuter lines, each with its eras
    found: dict[tuple[str, str, str], dict[str, list[list[list[float]]]]] = {}
    for path in listing(REGIONAL, "*.geojson"):
        m = REGIONAL_NAME.match(path.stem)
        if m and m["name"]:
            lines = [rounded(rdp(thin(line, .003), .004)) for line in geojson_lines(path)] # About 0.4 km of detail: short lines, seen close up
            found.setdefault((m["operator"].strip(), m["name"], (m["branch"] or "").strip().lower()), {})["future" if FUTURE_TAG.search(m["tags"]) else "today"] = [l for l in lines if len(l) > 1]

    out: list[Json] = []
    for (operator, name, _), versions in sorted(found.items()):
        for era, lines in versions.items():
            eras = ["today"] if era == "today" and "future" in versions else ["today", "buildout"] if era == "today" else ["buildout"]
            out.append({"operator": operator, "name": name, "eras": eras, "lines": lines})

    return out

def present_files(net: Json) -> dict[str, list[str]]: # network.json's "presentDay": route -> the track files its trains run along today
    return {label: [v] if isinstance(v, str) else v for label, v in net.get("presentDay", {}).items() if v}

def todays(notes: dict[str, Json | str], expanded: list[Json], cities: Cities, files: Files, pinned: dict[str, list[str]] | None = None, warn: list[str] | None = None) -> list[Json]: # Today's routes; pinned: present-day file keys by route, else picked from every file
    today = schedules.today_routes(list(cities.values()), expanded, notes)
    running = {r["group"] for r in today}
    kinds = {label_of(r): r["type"] for r in expanded}
    for label, note in notes.items(): # In no schedule, but its run is given
        if isinstance(note, dict) and label not in running:
            for b in note.get("branches") or [note]:
                if b.get("stops"):
                    today.append({"name": b.get("name") or label, "group": label, "type": note.get("type") or kinds.get(label, "State-Supported"), "status": f"Exists: {note['status']}" if note.get("status") else "Exists", "stops": b["stops"], "today": True, "geometry": b.get("name")})

            running.add(label)

    own: dict[str, set[str]] = {} # Route name -> the files its network.json versions are drawn from
    for r in expanded:
        if schedules.present(r) and label_of(r) not in running:
            r["both"] = True # Running unchanged but in no schedule

        own.setdefault(label_of(r), set()).add(name_key(r.get("geometry") or r["name"]))

    unlisted: dict[str, list[str]] = {}
    for r in today: # Drawn along the files network.json lists for it today, else the best of every file
        mine, pin = own.get(r["group"], set()), (pinned or {}).get(r["group"], [])
        pool = {k: files[k] for k in pin if k in files} if pin else files
        r["geometry"] = r.get("geometry") or own_file(r, pool, cities, mine) or (own_file(r, files, cities, mine) if pin else None)
        main = name_key(r["geometry"] or "")
        if pinned is not None and r["geometry"] and main not in pin: # Its file had to be guessed
            unlisted.setdefault(r["group"], []).append(r["geometry"])

        if extra := detours(r, main, pool if main in pool else files, cities, mine):
            r["detours"] = extra

    if warn is not None:
        warn += [f'"{label}" runs today along {", ".join(dict.fromkeys(found))}, which "presentDay" doesn\'t list for it' for label, found in unlisted.items()]

    if not today:
        print("  No routes for Present Day: run maintenance/update_schedules.py to download the train schedules")

    return today

def trains_of(routes: Iterable[Json], warn: list[str]) -> dict[str, list[str]]: # Route -> its train's pictures, where network.json gives its "equipment"
    out: dict[str, list[str]] = {}
    for r in routes:
        if not (kind := r.get("equipment")):
            continue

        cars = TRAINS.get(str(kind).lower())
        missing = sorted({c for c in cars or [] if not (FRONTEND / "trains" / f"{c}.webp").exists()})
        if cars is None:
            warn.append(f'{label_of(r)}: unknown "equipment" "{kind}": it can be {", ".join(k.title() for k in TRAINS)}')
        elif missing:
            warn.append(f'{label_of(r)}: its train\'s pictures aren\'t in frontend/trains: {", ".join(missing)} (maintenance/render_trains.py draws them)')
        else:
            out.setdefault(label_of(r), cars)

    return out

def check(net: Json, files: Files) -> list[str]: # Warnings for mistakes in network.json
    stations, warn = stations_in(net), list[str]()
    named = [(f"{kind} / {name}", r) for kind, group in net.get("routes", {}).get("Future", net.get("routes", {})).items() for name, r in group.items() if isinstance(r, dict)]
    named += [(f"{label} branch {k + 1}", b) for label, r in named for k, b in enumerate(r.get("branches", []))]
    known = {*DETAILS, "exists", "proposed", "future"}
    for label, r in named:
        file = r.get("file") or r.get("name")
        warn += [f'{label}: unknown status "{s}"' for s in statuses(r) if s.lower() not in known]
        warn += [f'{label}: stop "{n}" isn\'t a station' for n in r.get("stops", []) if n not in stations]
        warn += [f'{label}: no route file "{file}.geojson"'] if file and name_key(file) not in files else []

    for label, names in present_files(net).items(): # Present Day's files
        warn += [f'presentDay / {label}: no route file "{f}.geojson"' for f in names if name_key(f) not in files]

    for n, c in stations.items():
        if str(c.get("status", "")).lower() not in ("", "under construction", "planned"):
            warn.append(f'{n}: unknown station status "{c["status"]}"')

    held: dict[str, list[str]] = {}
    for n, c in stations.items(): # Amtrak's codes: three capitals, each at one station
        warn += [f'{n}: "code" should be Amtrak\'s three capitals, eg "DEN", or a list of them' for code in ([c["code"]] if "code" in c and not codes_of(c) else []) if code is not None]
        warn += [f'{n}: code "{code}" isn\'t three capitals' for code in codes_of(c) if not re.fullmatch(r"[A-Z]{3}", code)]
        for code in codes_of(c):
            held.setdefault(code, []).append(n)

    warn += [f'{" and ".join(names)}: both have the code "{code}"' for code, names in held.items() if len(names) > 1]

    return warn

def audit(stations: Cities, cities: Cities, routes: Iterable[Json]) -> list[str]: # Station data that doesn't add up: each of these has caught a real mistake
    warn = [f'{n}: outside the map, so no route stops there (are its coordinates the right way round?)' for n in stations if n not in cities] # Left off the map, so its routes skip it without a word
    same: dict[str, list[str]] = {}
    xy = flat_stops(cities, cities)
    for n in cities: # Spelt two ways: "St. Louis" and "Saint Louis", near each other, not New Castle and Newcastle
        same.setdefault(name_key(n), []).append(n)

    warn += [f'{" and ".join(names)}: the same station spelt two ways?' for names in same.values() if len(names) > 1 and dist(xy[names[0]], xy[names[1]]) < 100]
    grid: dict[tuple[int, int], list[str]] = {}
    for n, (x, y) in xy.items(): # Two names on one spot, eg after a rename
        for i in (-1, 0, 1):
            for j in (-1, 0, 1):
                for o in grid.get((int(x) + i, int(y) + j), []):
                    if bare(o) != bare(n) and name_key(o) != name_key(n) and dist(xy[o], (x, y)) < .2: # Spelt two ways: said once, above
                        warn.append(f'{o} and {n}: {dist(xy[o], (x, y)) * 1000:.0f} m apart, the same station twice?')

        grid.setdefault((int(x), int(y)), []).append(n)

    routes = list(routes)
    used = {s for r in routes for s in r.get("stops", [])}
    warn += [f'{n}: marked "{c["status"]}" but no route stops there' for n, c in stations.items() if c.get("status") and n not in used] # Being built or planned, but nothing will stop there
    warn += [f'{r["name"]}: "{a}" listed twice in a row' for r in routes for a, b in zip(r.get("stops", []), r.get("stops", [])[1:]) if a == b] # A slip when pasting stops
    return warn

def build(density: Json) -> bool: # Write map.json if a route, station or commuter line changed
    out, geo = OUT_DATA / "map.json", listing(INTERCITY, "*.geojson")
    if out.exists() and out.stat().st_mtime >= newest([*geo, *listing(REGIONAL, "*.geojson"), NETWORK, Path(__file__), Path(schedules.__file__), *schedules.schedule_files()]) and read_json(out).get("density") == density:
        return False

    net = read_json(NETWORK, {})
    cities, files = map_cities(net), {name_key(p.stem): p for p in geo}
    routes, notes = listed(net.get("routes", {}))
    notes = {**net.get("today", {}), **notes} # Older files: a "today" section
    expanded, warn = expand(routes), check(net, files)
    expanded = todays(notes, expanded, cities, files, {label: [name_key(f) for f in names] for label, names in present_files(net).items()}, warn) + expanded
    states = read_states()
    drawn = [r for r in (build_route(r, files, cities) for r in expanded) if "unofficial" not in r["status"].lower()] # AAO's unofficial routes: kept in network.json, off the map
    far_stops(drawn, cities)
    snap_to_track(drawn, cities)
    for c in cities.values(): # Each station's state, or province in Canada
        c["state"] = next((s["id"].upper() for s in states if inside(lonlat(c), s["rings"])), "") or province(c)

    warn += audit(stations_in(net), cities, expanded)
    trains = trains_of(expanded, warn)
    for w in warn:
        print("  Check network.json: " + w)

    cache_set("network", {"warnings": warn}) # For publish.py
    write_json(out, {
        "states": [{"id": s["id"], "rings": [rounded(r) for r in s["rings"]]} for s in states],
        "cities": list(cities.values()),
        "routes": drawn,
        "overlaps": overlaps(drawn),
        "trains": trains,
        "regional": read_regional(),
        "snapped": True,
        "density": density
    })
    return True