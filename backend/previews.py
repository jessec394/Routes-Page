# Link previews: a page for each route, station and comparison, with its picture
import hashlib
import html
import json
import re
import shutil
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from .geometry import Point, bounds, flat, length, lonlat
from .names import STATE_NAMES
from .names import bare as place
from .paths import DOCS, FRONTEND, OUT_DATA, Json, read_json, write_json

W, H = 1200, 630 # Preview size
PICTURE = "preview.jpg" # JPEG: a tenth the size of a PNG, and quick to write
SITE = "All Aboard Ohio"

def slug(s: str) -> str: # As the page makes them
    return re.sub(r"[^a-z0-9]+", "-", str(s).lower()).strip("-")

def running(r: Json) -> bool: # A route of today
    return bool(r.get("today") or r.get("both"))

def in_buildout(r: Json) -> bool: # A route of the full buildout
    return not r.get("today") and "temporary" not in str(r.get("status", "")).lower()

def proposed(r: Json) -> bool:
    return str(r.get("status", "")).lower().startswith(("proposed", "funded"))

def badge(r: Json, today_labels: set[str]) -> str: # Short status for the picture
    s = str(r.get("status", "")).lower()
    if s.startswith("funded"):
        return "Funded"

    if s.startswith("proposed"):
        return "Extension" if r["label"] in today_labels else "Proposed"

    return "Running today"

def page(title: str, target: str, url: str, image: str | None, alt: str, about: str = "") -> str: # A preview page: title, picture and a line about it
    def e(s: str) -> str:
        return html.escape(s, quote=True)

    tags = [f'<meta property="og:title" content="{e(title)}">', f'<meta property="og:site_name" content="{SITE}">', '<meta property="og:type" content="website">',
            f'<meta name="twitter:card" content="{"summary_large_image" if image else "summary"}">', f'<meta name="twitter:title" content="{e(title)}">', '<meta name="theme-color" content="#c75b59">']
    if url:
        tags.append(f'<meta property="og:url" content="{e(url)}">')

    if about:
        tags.append(f'<meta property="og:description" content="{e(about)}">') # Read by X too

    if image:
        tags += [f'<meta property="og:image" content="{e(image)}">', f'<meta property="og:image:width" content="{W}">', f'<meta property="og:image:height" content="{H}">',
                 f'<meta property="og:image:alt" content="{e(alt)}">', f'<meta name="twitter:image" content="{e(image)}">', f'<meta name="twitter:image:alt" content="{e(alt)}">']

    return (f'<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<title>{e(title)} · {SITE}</title>\n' + "\n".join(tags) +
            f'\n<link rel="canonical" href="{e(url or target)}">\n<meta http-equiv="refresh" content="0; url={e(target)}">\n'
            f'<script>location.replace({target!r} + (location.search ? "&" + location.search.slice(1) : "") + location.hash)</script>\n' # Keeps ?state= and the like
            f'</head>\n<body style="background:#0d2344;color:#fff;font-family:sans-serif"><p><a style="color:#fff" href="{e(target)}">Open the map</a></p></body>\n</html>')

def build(domain: str | None = None) -> bool: # Write the preview pages when the map data or this file changed
    data = read_json(OUT_DATA / "map.json")
    if not data:
        return False

    code = b"".join(p.read_bytes() for p in (Path(__file__), Path(__file__).with_name("painter.py"), *sorted((FRONTEND / "trains").glob("*.webp")))) + str(domain).encode() # Pictures redrawn when how they're drawn changes, or the trains in them
    stamp = hashlib.md5((OUT_DATA / "map.json").read_bytes() + code).hexdigest()
    mark = DOCS / "r" / ".built"
    try:
        built = json.loads(mark.read_text())
    except (OSError, ValueError): # None yet, or an older kind of mark
        built = {}

    if built.get("stamp") == stamp:
        return False

    base = f"https://{domain}/" if domain else ""
    try:
        from .painter import Painter
        painter = Painter(data, domain)
    except ImportError: # No Pillow: pages are still made, without pictures
        painter = None
        print("  Link previews: install Pillow (pip install pillow) for route pictures; pages are made without them")

    old: dict[str, str] = built.get("pictures", {})
    drawn: dict[str, str] = {}
    kept: set[Path] = set()
    shared: dict[int, str] = {}
    made = 0
    def paint(path: Path, *args: Any, pair: bool = False, **kw: Any) -> None: # Draw a picture unless the one there was drawn from the same things
        nonlocal made
        key, name = hashlib.md5(json.dumps([[shared.get(id(a), a) for a in args], kw, pair], default=str).encode() + code).hexdigest(), path.relative_to(DOCS).as_posix() # Big shared lists by their own hash
        drawn[name] = key
        if painter and not (path.exists() and old.get(name) == key):
            painter.pair(path, *args) if pair else painter.draw(path, *args, **kw)
            made += 1

    routes: list[Json] = data["routes"]
    cities: dict[str, Json] = {c["name"]: c for c in data["cities"]}
    groups: dict[str, list[Json]] = {}
    for r in routes:
        r["label"] = r.get("group") or r["name"]
        groups.setdefault(r["label"], []).append(r)

    today_labels = {r["label"] for r in routes if running(r)}
    every = [line for r in routes if not r.get("today") for line in r["lines"]] # The buildout's track
    shared[id(every)] = hashlib.md5(json.dumps(every).encode()).hexdigest()
    def xy(n: str) -> Point:
        return lonlat(cities[n])

    def big(n: str) -> bool:
        return str(cities.get(n, {}).get("size", "S")).upper() in ("L", "M")

    def stops_of(members: Iterable[Json]) -> list[str]: # Every station of some routes, once
        return list(dict.fromkeys(n for r in members for n in r.get("stops", [])))

    for label, members in groups.items(): # A page per route
        shown = [r for r in members if proposed(r)] or [r for r in members if not r.get("today")] or members
        lead, stops = shown[0], stops_of(shown)
        ends = f"{place(stops[0])} to {place(stops[-1])}" if len(stops) > 1 else ""
        lines = [line for r in shown for line in r["lines"]]
        folder, image = DOCS / "r" / slug(label), None
        if painter and lines:
            paint(folder / PICTURE, lines, every, [xy(n) for n in stops if n in cities], f"{lead.get('type', '')} route", label, "", badge(lead, today_labels),
                         bounds([p for line in lines for p in line]), labels=[(xy(n), place(n)) for n in stops if n in cities and big(n)], train=data.get("trains", {}).get(label, []))
            image = f"{base}r/{slug(label)}/{PICTURE}" if base else None

        folder.mkdir(parents=True, exist_ok=True)
        kept.add(folder)
        (folder / "index.html").write_text(page(label, f"../../?r={slug(label)}", f"{base}r/{slug(label)}/" if base else "", image, f"Map of the {label} route" + (f", {ends}" if ends else "")), encoding="utf-8")

    served: dict[str, list[Json]] = {}
    for r in routes:
        for n in r.get("stops", []):
            served.setdefault(n, []).append(r)

    focus = str(data.get("focus") or "OH").upper()
    site_image = f"{base}data/{PICTURE}" if base and (painter or (OUT_DATA / PICTURE).exists()) else None
    for n, c in cities.items(): # A page per station
        rs = served.get(n, [])
        title = place(n) + (f", {c['state']}" if c.get("state") else "")
        folder, image = DOCS / "s" / slug(n), site_image
        folder.mkdir(parents=True, exist_ok=True)
        kept.add(folder)
        if painter and rs and (str(c.get("state", "")).upper() == focus or str(c.get("size", "")).upper() == "L"):
            x, y = xy(n)
            mine = [line for r in rs if in_buildout(r) or running(r) for line in r["lines"]]
            near = [m for m in cities if m != n and big(m) and abs(xy(m)[0] - x) < 1.5 and abs(xy(m)[1] - y) < .9 and served.get(m)]
            paint(folder / PICTURE, mine, every, [xy(m) for m in near], "Station", place(n), STATE_NAMES.get(str(c.get("state", "")).upper(), c.get("state", "")), "Running today" if any(running(r) for r in rs) else "Planned service",
                         (x - 1.6, y - 1.0, x + 1.6, y + 1.0), width=5, labels=[(xy(m), place(m)) for m in near], here=(x, y))
            image = f"{base}s/{slug(n)}/{PICTURE}" if base else None

        (folder / "index.html").write_text(page(title, f"../../?s={slug(n)}", f"{base}s/{slug(n)}/" if base else "", image, f"Map of rail lines around {title}"), encoding="utf-8")

    versions: list[Json] = [] # Every route as it runs today, and as planned where that differs, as the comparison window lists them
    for label, members in groups.items():
        now, later = [r for r in members if running(r)], [r for r in members if in_buildout(r) and proposed(r)]
        versions += [{"label": label, "era": "today", "members": now}] if now else []
        versions += [{"label": label, "era": "buildout", "members": later}] if later and [r["name"] for r in later] != [r["name"] for r in now] else []

    for v in versions:
        v["key"] = slug(v["label"]) + ("-planned" if v["era"] == "buildout" and any(o["label"] == v["label"] and o["era"] == "today" for o in versions) else "")
        v["lines"] = [line for r in v["members"] for line in r["lines"]]
        v["km"], v["kind"] = length([[flat(p) for p in line] for line in v["lines"]]), "Existing" if v["era"] == "today" else "Proposed"
        v["home"] = any(str(cities.get(n, {}).get("state", "")).upper() == focus for r in v["members"] for n in r.get("stops", []))

    def partner(v: Json) -> Json | None: # The route the comparison window suggests beside it
        pool = [o for o in versions if o["label"] != v["label"] and o["era"] != v["era"] and o["members"][0].get("typeKey") == v["members"][0].get("typeKey")] or [o for o in versions if o["label"] != v["label"]]
        return min(pool, key=lambda o: abs(o["km"] - v["km"]), default=None)

    pictured = {tuple(sorted((v["key"], o["key"]))) for v in versions for o in versions if v["home"] and o["home"] and v is not o} # Between the featured state's routes...
    pictured |= {tuple(sorted((v["key"], p["key"]))) for v in versions if (p := partner(v))} # ...and each route beside its suggestion: the comparisons most shared
    for a, b in ((x, y) for n, x in enumerate(versions) for y in versions[n + 1:]): # A page per pair, in key order: ?swap flips them
        a, b = sorted((a, b), key=lambda v: v["key"])
        name, title = f'{a["key"]}~{b["key"]}', f'{a["label"]} vs {b["label"]}'
        folder, image = DOCS / "c" / name, f"{base}r/{slug(a['label'])}/{PICTURE}" if base and (DOCS / "r" / slug(a["label"]) / PICTURE).exists() else site_image # Else the first route's own picture
        folder.mkdir(parents=True, exist_ok=True)
        kept.add(folder)
        if painter and (a["key"], b["key"]) in pictured and a["lines"] and b["lines"]:
            paint(folder / PICTURE, [(v["kind"], v["label"], v["lines"], [xy(n) for n in stops_of(v["members"]) if n in cities]) for v in (a, b)], every, pair=True)
            image = f"{base}c/{name}/{PICTURE}" if base else None

        about = f'{a["label"]} and {b["label"]} side by side, drawn to one scale: length, stations, trains and the people near them.'
        (folder / "index.html").write_text(page(title, f'../../?c={a["key"]},{b["key"]}', f"{base}c/{name}/" if base else "", image, f"Maps of the {a['label']} and {b['label']} routes", about), encoding="utf-8")

    if painter: # The site's own picture
        oh = next((s for s in data["states"] if s["id"].upper() == "OH"), None)
        box = bounds([p for ring in oh["rings"] for p in ring], pad=.3) if oh else bounds([p for line in every for p in line], pad=0)
        paint(OUT_DATA / PICTURE, [line for r in routes if in_buildout(r) for line in r["lines"]], [], [], "Proposed routes", "Passenger rail for Ohio", "", "Full buildout", box, width=4)

    for folder in ("r", "s", "c"): # Pages of routes, stations and comparisons no longer on the map, and pictures no longer drawn
        for d in (DOCS / folder).iterdir() if (DOCS / folder).exists() else []:
            if d.is_dir() and d not in kept:
                shutil.rmtree(d)

    for f in [*DOCS.glob("[rsc]/*/preview.*"), *OUT_DATA.glob("preview.*")] if painter else []:
        if f.relative_to(DOCS).as_posix() not in drawn:
            f.unlink()

    write_json(mark, {"stamp": stamp, "pictures": drawn}, pretty=True)
    print(f"  Link previews: {len(groups)} routes, {len(cities)} stations, {len(versions) * (len(versions) - 1) // 2} comparisons, {len(drawn)} pictures ({made} redrawn)" + ("" if painter else " (no pictures)"))
    return True