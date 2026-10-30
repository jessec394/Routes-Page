"""Link previews: a small page for every route and station (docs/r/<slug>/, docs/s/<slug>/) whose tags make a shared link show that route or station, then open the map there.
Route pictures (docs/r/<slug>/preview.png) and the site's own (docs/data/preview.png) are drawn when Pillow is installed (pip install pillow); without it, links still show their titles and descriptions."""
import hashlib
import html
import math
import re
import shutil

from .paths import DATA, DOCS, OUT_DATA, read_json

W, H = 1200, 630  # The size link previews use
NAVY, DEEP, RED, WHITE = (13, 35, 68), (8, 24, 51), (224, 64, 44), (255, 255, 255)
SITE = "All Aboard Ohio"
STATE_NAMES = dict(x.split(" ", 1) for x in "AL Alabama|AK Alaska|AZ Arizona|AR Arkansas|CA California|CO Colorado|CT Connecticut|DE Delaware|DC Washington, D.C.|FL Florida|GA Georgia|HI Hawaii|ID Idaho|IL Illinois|IN Indiana|IA Iowa|KS Kansas|KY Kentucky|LA Louisiana|ME Maine|MD Maryland|MA Massachusetts|MI Michigan|MN Minnesota|MS Mississippi|MO Missouri|MT Montana|NE Nebraska|NV Nevada|NH New Hampshire|NJ New Jersey|NM New Mexico|NY New York|NC North Carolina|ND North Dakota|OH Ohio|OK Oklahoma|OR Oregon|PA Pennsylvania|RI Rhode Island|SC South Carolina|SD South Dakota|TN Tennessee|TX Texas|UT Utah|VT Vermont|VA Virginia|WA Washington|WV West Virginia|WI Wisconsin|WY Wyoming|ON Ontario|QC Quebec|BC British Columbia".split("|"))  # (For the previews' words: "Ohio", not "OH")
ABOUT = "All Aboard Ohio's map of passenger rail: the Amtrak routes running today, and what the full buildout would bring."

def slug(s):  # As the page makes them (util.js slug): "Chicago - Cleveland" -> "chicago-cleveland"
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", str(s).lower()))

def running(r):  # A route of today (made from Amtrak's schedule; older map data: not a proposal, not temporary)
    return r["today"] or r.get("both", False) if "today" in r else not proposed(r) and "temporary" not in str(r.get("status", "")).lower()

def in_buildout(r):  # A route of the full buildout
    if "today" in r:
        return not r["today"] and "temporary" not in str(r.get("status", "")).lower()
    return proposed(r) or r["label"] not in BUILDOUT_NAMES[0]

BUILDOUT_NAMES = [set()]  # (Older map data: names with a proposal, set in build)

def proposed(r):
    return str(r.get("status", "")).lower().startswith(("proposed", "funded"))

def status_text(r, today_labels):  # As the page writes it (state.js statusText)
    s = str(r.get("status", ""))
    if s.lower().startswith("funded"):
        return "Funded"
    if s.lower().startswith("proposed"):
        return ("Extension: " if r["label"] in today_labels else "New Route: ") + re.sub(r"^Proposed:\s*", "", s, flags=re.I)
    return re.sub(r"^Exists:\s*", "", s, flags=re.I) or "Exists"

def page(title, about, target, url, image, alt="", facts=()):  # A preview page: its tags for the link, then straight on to the map
    e = lambda s: html.escape(s, quote=True)
    tags = [f'<meta property="og:title" content="{e(title)}">', f'<meta property="og:description" content="{e(about)}">', f'<meta property="og:site_name" content="{SITE}">', '<meta property="og:type" content="website">',
            f'<meta name="description" content="{e(about)}">', f'<meta name="twitter:card" content="{"summary_large_image" if image else "summary"}">', f'<meta name="twitter:title" content="{e(title)}">', f'<meta name="twitter:description" content="{e(about)}">']
    if url:
        tags.append(f'<meta property="og:url" content="{e(url)}">')
    for k, (label, value) in enumerate(facts[:2], 1):  # (Slack and others show these under the preview)
        tags += [f'<meta name="twitter:label{k}" content="{e(label)}">', f'<meta name="twitter:data{k}" content="{e(value)}">']
    tags.append('<meta name="theme-color" content="#0d2344">')
    if image:
        tags += [f'<meta property="og:image:alt" content="{e(alt or title)}">', f'<meta name="twitter:image:alt" content="{e(alt or title)}">']
        tags += [f'<meta property="og:image" content="{e(image)}">', f'<meta property="og:image:width" content="{W}">', f'<meta property="og:image:height" content="{H}">', f'<meta name="twitter:image" content="{e(image)}">']
    return (f'<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<title>{e(title)} · {SITE}</title>\n' + "\n".join(tags) +
            f'\n<link rel="canonical" href="{e(url or target)}">\n<meta http-equiv="refresh" content="0; url={e(target)}">\n'
            f'<script>location.replace({target!r} + (location.search ? "&" + location.search.slice(1) : "") + location.hash)</script>\n'  # (Keeps ?state= and the like)
            f'</head>\n<body style="background:#0d2344;color:#fff;font-family:sans-serif"><p><a style="color:#fff" href="{e(target)}">Open the map</a></p></body>\n</html>\n')

class Painter:  # Pictures with Pillow: the routes over the states, and text beside them
    def __init__(self, data):
        from PIL import Image, ImageDraw, ImageFont
        self.Image, self.Draw, self.Font = Image, ImageDraw, ImageFont
        self.states = data["states"]
        logo = DATA / "logo.png"
        self.logo = Image.open(logo).convert("RGBA") if logo.exists() else None

    def font(self, size):
        try:
            return self.Font.load_default(size=size)  # (Pillow 10.1+: a scalable font)
        except TypeError:
            return self.Font.load_default()

    def draw(self, path, lines, others, stops, texts, box, width=7, labels=(), here=None):  # labels: (lon/lat, name) shown beside their dots; here: one station ringed  # One picture: `lines` bold over `others` faint, stations, and text on the left
        img = self.Image.new("RGB", (W, H), NAVY)
        d = self.Draw.Draw(img, "RGBA")
        for y in range(H):  # A soft darkening downward
            d.line([(0, y), (W, y)], fill=DEEP + (int(110 * y / H),))
        x0, y0, x1, y1 = box
        k = math.cos(math.radians((y0 + y1) / 2))
        left, top, right, bottom = 520, 40, W - 40, H - 40  # The map's part of the picture
        s = min((right - left) / max(1e-6, (x1 - x0) * k), (bottom - top) / max(1e-6, y1 - y0))
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        at = lambda p: ((right + left) / 2 + (p[0] - cx) * k * s, (bottom + top) / 2 - (p[1] - cy) * s)
        for st in self.states:
            for ring in st["rings"]:
                pts = [at(p) for p in ring]
                if len(pts) > 2:
                    d.polygon(pts, fill=(255, 255, 255, 10), outline=(255, 255, 255, 60))
        for line in others:
            d.line([at(p) for p in line], fill=(255, 255, 255, 55), width=3, joint="curve")
        for line in lines:
            pts = [at(p) for p in line]
            d.line(pts, fill=RED + (70,), width=round(width * 2.3), joint="curve")
            d.line(pts, fill=RED, width=width, joint="curve")
        for p in stops:
            x, y = at(p)
            d.ellipse([x - 7, y - 7, x + 7, y + 7], fill=WHITE, outline=NAVY, width=3)
        if here:
            x, y = at(here)
            d.ellipse([x - 22, y - 22, x + 22, y + 22], outline=WHITE, width=4)
            d.ellipse([x - 13, y - 13, x + 13, y + 13], fill=WHITE, outline=NAVY, width=4)
        font = self.font(22)
        for p, name in labels:
            x, y = at(p)
            if left + 10 < x < right - 10 and top < y < bottom:
                d.text((x + 13, y - 13), name, font=font, fill=WHITE, stroke_width=4, stroke_fill=DEEP)
        for x in range(0, 640, 2):  # The text's side fades to plain navy
            d.line([(x, 0), (x, H)], fill=NAVY + (round(255 * min(1, max(0, (640 - x) / 200))),), width=2)
        d.rectangle([0, 0, W, 9], fill=(199, 91, 89))
        y = 64
        if self.logo:
            w = 210
            logo = self.logo.resize((w, round(w * self.logo.height / self.logo.width)))
            img.paste(logo, (64, y), logo)
            y += logo.height + 50
        for text, size, color in texts:
            font = self.font(size)
            for row in self.wrap(d, text, font, 430):
                d.text((64, y), row, font=font, fill=color)
                y += round(size * 1.25)
            y += round(size * .55)
        path.parent.mkdir(parents=True, exist_ok=True)
        img.save(path, optimize=True)

    def wrap(self, d, text, font, width):  # Lines that fit
        rows, row = [], ""
        for word in text.split():
            test = f"{row} {word}".strip()
            if row and d.textlength(test, font=font) > width:
                rows.append(row)
                row = word
            else:
                row = test
        return rows + ([row] if row else [])

def bounds(points, pad=.15, least=1.5):  # Lon/lat box around points, padded, at least `least` degrees across
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    w, h = max(least, (x1 - x0) * (1 + 2 * pad)), max(least * .6, (y1 - y0) * (1 + 2 * pad))
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    return cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2

def build(domain=None):  # Write the preview pages (and pictures) when the map data or this file changed; returns True if it did
    data = read_json(OUT_DATA / "map.json")
    if not data:
        return False
    stamp = hashlib.md5((OUT_DATA / "map.json").read_bytes() + open(__file__, "rb").read() + str(domain).encode()).hexdigest()
    mark = DOCS / "r" / ".built"
    if mark.exists() and mark.read_text() == stamp:
        return False
    base = f"https://{domain}/" if domain else ""
    try:
        painter = Painter(data)
    except ImportError:
        painter = None
        print("  Link previews: install Pillow (pip install pillow) for route pictures; pages are made without them")
    for folder in ("r", "s"):
        shutil.rmtree(DOCS / folder, ignore_errors=True)

    routes, cities = data["routes"], {c["name"]: c for c in data["cities"]}
    for r in routes:
        r["label"] = r.get("group") or r["name"]
    today_labels = {r["label"] for r in routes if running(r)}
    groups = {}
    for r in routes:
        groups.setdefault(r["label"], []).append(r)
    every = [line for r in routes if not r.get("today") for line in r["lines"]]  # (The buildout's track)
    BUILDOUT_NAMES[0] = {r["label"] for r in routes if proposed(r)}
    place = lambda n: re.sub(r"\s*\([^)]*\)\s*$", "", n)

    xy = lambda n: (float(cities[n]["lon"]), float(cities[n]["lat"]))
    big = lambda n: str(cities.get(n, {}).get("size", "S")).upper() in ("L", "M")
    def miles(lines):  # Track length (the drawn lines), great-circle
        total = 0
        for line in lines:
            for (x0, y0), (x1, y1) in zip(line, line[1:]):
                k = math.cos(math.radians((y0 + y1) / 2))
                total += math.hypot((x1 - x0) * k, y1 - y0) * 69.1
        return round(total / 10) * 10
    def listed(names):  # "Columbus and Dayton", "A, B and C"
        names = list(names)
        return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1] if names else ""

    for label, members in groups.items():  # A page per route (its proposal, where there is one: that's what people share)
        shown = [r for r in members if proposed(r)] or [r for r in members if not r.get("today")] or members
        lead, stops = shown[0], list(dict.fromkeys(n for r in shown for n in r.get("stops", [])))
        ends = f"{place(stops[0])} to {place(stops[-1])}" if len(stops) > 1 else ""
        via = [place(n) for n in stops[1:-1] if str(cities.get(n, {}).get("size", "")).upper() == "L"][:2]
        lines = [line for r in shown for line in r["lines"]]
        length = miles(lines) if lines else 0
        states = list(dict.fromkeys(STATE_NAMES.get(str(cities[n]["state"]).upper(), cities[n]["state"]) for n in stops if n in cities and cities[n].get("state")))
        stats = " · ".join(x for x in [f"{len(stops)} stations" if stops else "", f"about {length:,} miles" if length else "", listed(states)] if x)
        status = status_text(lead, today_labels)
        about = f"{lead.get('type', 'Route')} route · {status}" + (f" · {ends}" + (f" via {listed(via)}" if via else "") if ends else "") + (f" · {stats}" if stats else "")
        folder, image = DOCS / "r" / slug(label), None
        if painter and lines:
            pts = [p for line in lines for p in line]
            painter.draw(folder / "preview.png", lines, every, [xy(n) for n in stops if n in cities],
                         [(f"{lead.get('type', '').upper()} ROUTE", 22, (150, 190, 228)), (label, 54, WHITE), (status, 26, (230, 166, 163)), (ends + (f" via {listed(via)}" if via else ""), 24, (255, 255, 255, 200)), (stats.upper(), 20, (150, 190, 228))],
                         bounds(pts), labels=[(xy(n), place(n)) for n in stops if n in cities and big(n)])
            image = f"{base}r/{slug(label)}/preview.png" if base else None
        folder.mkdir(parents=True, exist_ok=True)
        alt = f"Map of the {label} route" + (f", {ends}" if ends else "")
        facts = [("Stations", str(len(stops))), ("Length", f"About {length:,} miles")] if length else [("Stations", str(len(stops)))]
        (folder / "index.html").write_text(page(label, about, f"../../?route={slug(label)}", f"{base}r/{slug(label)}/" if base else "", image, alt, facts), encoding="utf-8")

    served = {}
    for r in routes:
        for n in r.get("stops", []):
            served.setdefault(n, []).append(r)
    focus = str(data.get("focus") or "OH").upper()
    site_image = f"{base}data/preview.png" if base and (painter or (OUT_DATA / "preview.png").exists()) else None
    drawn = 0
    for n, c in cities.items():  # A page per station; its own picture for the featured state's and the big ones (hundreds more would weigh the site down: those use the site's)
        rs = served.get(n, [])
        now = list(dict.fromkeys(r["label"] for r in rs if running(r)))
        later = list(dict.fromkeys(r["label"] for r in rs if proposed(r)))
        about = (f"Served today by {listed(now)}." if now else "No intercity rail service today.") + (f" Planned: {listed(later)}." if later else "")
        title = place(n) + (f", {c['state']}" if c.get("state") else "")
        folder, image = DOCS / "s" / slug(n), site_image
        folder.mkdir(parents=True, exist_ok=True)
        if painter and rs and (str(c.get("state", "")).upper() == focus or str(c.get("size", "")).upper() == "L"):
            x, y = xy(n)
            box = (x - 1.6, y - 1.0, x + 1.6, y + 1.0)
            mine = [line for r in rs if in_buildout(r) or running(r) for line in r["lines"]]
            near = [m for m in cities if m != n and big(m) and abs(xy(m)[0] - x) < 1.5 and abs(xy(m)[1] - y) < .9 and served.get(m)]
            line3 = f"Today: {listed(now)}" if now else "No intercity rail service today"
            painter.draw(folder / "preview.png", mine, every, [xy(m) for m in near], [("STATION", 22, (150, 190, 228)), (place(n), 54, WHITE), (STATE_NAMES.get(str(c.get("state", "")).upper(), c.get("state", "")), 26, (230, 166, 163)), (line3, 22, (255, 255, 255, 200)), (f"{len(later)} planned route{'s' if len(later) != 1 else ''}".upper() if later else "", 20, (150, 190, 228))],
                         box, width=6, labels=[(xy(m), place(m)) for m in near] , here=(x, y))
            image, drawn = (f"{base}s/{slug(n)}/preview.png" if base else None), drawn + 1
        facts = [("Today", listed(now) or "No service"), ("Planned", f"{len(later)} route{'s' if len(later) != 1 else ''}")]
        (folder / "index.html").write_text(page(title, about, f"../../?station={slug(n)}", f"{base}s/{slug(n)}/" if base else "", image, f"Map of rail lines around {title}", facts), encoding="utf-8")

    if painter:  # The site's own picture: Ohio and around, every route of the buildout
        oh = next((s for s in data["states"] if s["id"].upper() == "OH"), None)
        box = bounds([p for ring in oh["rings"] for p in ring], pad=.3) if oh else bounds([p for line in every for p in line], pad=0)
        painter.draw(OUT_DATA / "preview.png", [line for r in routes if in_buildout(r) for line in r["lines"]], [], [],
                     [("PROPOSED ROUTES", 24, (150, 190, 228)), ("Passenger rail for Ohio", 50, WHITE), ("What runs today, and what the full buildout would bring", 26, (255, 255, 255, 190))], box, width=4)
    mark.parent.mkdir(parents=True, exist_ok=True)
    mark.write_text(stamp)
    print(f"  Link previews: {len(groups)} routes, {len(cities)} stations ({drawn} with their own picture)" + ("" if painter else " (no pictures)"))
    return True
