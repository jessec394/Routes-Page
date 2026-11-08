# Link preview pictures, drawn with Pillow
import math
from collections.abc import Callable, Iterable, Sequence
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont

from .geometry import Box, Point, Pt, bounds, span
from .paths import DATA, FRONTEND, Json
from .previews import H, W

X = 2 # Drawn at twice the size then halved, for smooth edges
NAVY, DEEP, RED, WHITE, SKY = (13, 35, 68), (7, 20, 43), (224, 64, 44), (255, 255, 255), (150, 190, 228)
SIDES = (78, 168, 245), (199, 91, 89) # A comparison's left and right, as the page colours them
PANEL = 470 # Width of the solid navy side
Color = tuple[int, ...] # RGB, or RGBA to blend
Side = tuple[str, str, list[list[Pt]], list[Point]] # A comparison's side: kind, name, lines and stops

class Painter: # Pictures with Pillow
    def __init__(self, data: Json, domain: str | None) -> None:
        self.domain, self.fonts = domain, dict[tuple[str, int], ImageFont.FreeTypeFont | ImageFont.ImageFont]()
        logo = DATA / "logo.png"
        self.logo = Image.open(logo).convert("RGBA") if logo.exists() else None
        if self.logo: # Sized once for every picture
            self.logo = self.logo.resize((190 * X, round(190 * X * self.logo.height / self.logo.width)), Image.Resampling.LANCZOS)

        self.rings = [(span(ring), ring) for st in data["states"] for ring in st["rings"] if len(ring) > 2]
        self.spans: dict[int, Box] = {} # Line -> its lon/lat box, so lines off the picture are skipped
        self.cars: dict[str, Image.Image] = {} # Car pictures from frontend/trains, sized once

    def span(self, line: Sequence[Pt]) -> Box:
        return self.spans.get(id(line)) or self.spans.setdefault(id(line), span(line))

    def font(self, name: str, size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont: # The site's own fonts, else Pillow's
        key = (name, size)
        if key not in self.fonts:
            try:
                self.fonts[key] = ImageFont.truetype(str(FRONTEND / "fonts" / f"{name}.woff2"), size * X)
            except OSError: # No WOFF2 support in this Pillow
                self.fonts[key] = ImageFont.load_default(size=size * X)

        return self.fonts[key]

    def text(self, d: ImageDraw.ImageDraw, xy: Pt, text: str, font: Any, fill: Color, track: float = 0, **kw: Any) -> float: # Text at 1x coordinates, with optional letter spacing
        x, y = xy[0] * X, xy[1] * X
        if not track:
            d.text((x, y), text, font=font, fill=fill, **kw)
            return float(d.textlength(text, font=font)) / X

        for ch in text:
            d.text((x, y), ch, font=font, fill=fill, **kw)
            x += d.textlength(ch, font=font) + track * X

        return x / X - xy[0] - track

    def tracked(self, d: ImageDraw.ImageDraw, text: str, font: Any, track: float) -> float: # Width of letter-spaced text at 1x
        return sum(d.textlength(ch, font=font) for ch in text) / X + track * (len(text) - 1)

    def canvas(self) -> tuple[Image.Image, ImageDraw.ImageDraw]: # A blank picture
        img = Image.new("RGB", (W * X, H * X), NAVY)
        return img, ImageDraw.Draw(img, "RGBA")

    def fit(self, d: ImageDraw.ImageDraw, text: str, name: str, size: int, width: float, rows: int = 2) -> tuple[Any, int, list[str]]: # The largest font up to `size` fitting `rows` lines
        while True:
            font = self.font(name, size)
            lines = wrap(text, lambda s: float(d.textlength(s, font=font)) / X, width)
            if len(lines) <= rows or size <= 28:
                return font, size, lines

            size -= 4

    def draw(self, path: Path, lines: list[list[Pt]], others: list[list[Pt]], stops: list[Point], kicker: str, title: str, under: str, chip: str, box: Box, width: float = 7, labels: Iterable[tuple[Point, str]] = (), train: Sequence[str] = (), here: Point | None = None) -> None: # One route's or station's picture
        img, d = self.canvas()
        x0, y0, x1, y1 = box
        k = math.cos(math.radians((y0 + y1) / 2))
        left, top, right, bottom = PANEL - 60, 50, W - 50, H - (110 if train else 50) # Where the map fits, reaching under the panel's fade, clear of a train along the bottom
        s = min((right - left) / max(1e-6, (x1 - x0) * k), (bottom - top) / max(1e-6, y1 - y0))
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        at = to_pixels(cx, cy, k, s, (right + left) / 2, (bottom + top) / 2)
        seen = in_view(cx, cy, W / 2 / k / s, H / 2 / s) # What the picture shows
        def thin(line: Sequence[Pt]) -> list[Point]: # Points at least two pixels apart: far fewer to draw
            out: list[Point] = []
            for p in map(at, line):
                if not out or abs(p[0] - out[-1][0]) + abs(p[1] - out[-1][1]) > 2 * X:
                    out.append(p)

            return out if len(out) > 1 else out * 2

        for b, ring in self.rings:
            if seen(b):
                d.polygon(thin(ring), fill=(255, 255, 255, 9), outline=(255, 255, 255, 45), width=X)

        for line in others:
            if seen(self.span(line)):
                d.line(thin(line), fill=SKY + (48,), width=round(2.5 * X))

        drawn = [thin(line) for line in lines if seen(self.span(line))]
        for glow, fill in ((width * 3.4, RED + (28,)), (width * 2, RED + (55,)), (width + 5, DEEP), (width, RED)): # Glow, casing, line
            for pts in drawn:
                stroke(d, pts, fill, glow)

        for n, p in enumerate(stops):
            x, y = at(p)
            dot(d, x, y, (10 if n in (0, len(stops) - 1) and not here else 8 if len(stops) < 15 else 6) * X, fill=WHITE, outline=DEEP, width=3 * X)

        if here:
            x, y = at(here)
            for r, w, fill in ((34, 0, RED + (60,)), (22, 5, None), (13, 4, WHITE)):
                dot(d, x, y, r * X, fill=fill, outline=WHITE if w else None, width=w * X)

        font, taken = self.font("montserrat-600", 19), list[Box]() # Station names, none overlapping
        for p, name in labels:
            x, y = at(p)
            box_ = (x + 14 * X, y - 13 * X, x + 14 * X + d.textlength(name, font=font), y + 13 * X)
            if box_[0] > (PANEL + 30) * X and box_[2] < (W - 12) * X and 12 * X < box_[1] < box_[3] < (H - 12) * X and not any(a[0] < box_[2] and box_[0] < a[2] and a[1] < box_[3] and box_[1] < a[3] for a in taken):
                taken.append(box_)
                d.text((box_[0], y - 12 * X), name, font=font, fill=WHITE, stroke_width=4 * X, stroke_fill=DEEP)

        if train:
            self.train(img, d, train)

        for x in range(0, PANEL + 230): # The side panel fades into the map
            t = min(1, max(0, (x - PANEL + 170) / 400))
            d.line([(x * X, 0), (x * X, H * X)], fill=NAVY + (round(255 * (1 - t * t * (3 - 2 * t))),), width=X)

        if self.logo:
            img.paste(self.logo, (56 * X, 56 * X), self.logo)

        tf, size, rows = self.fit(d, title, "poppins-700", 60, PANEL - 100)
        gap = round(size * 1.12)
        y = H - 92 - 52 - 30 - len(rows) * gap - (34 if under else 0)
        self.text(d, (60, y), kicker.upper(), self.font("montserrat-700", 16), SKY, track=2.2)
        y += 30
        for row in rows:
            self.text(d, (58, y), row, tf, WHITE)
            y += gap

        if under:
            self.text(d, (60, y + 4), under, self.font("montserrat-500", 22), (255, 255, 255, 200))
            y += 34

        cf = self.font("montserrat-700", 15) # Status chip
        w = self.tracked(d, chip.upper(), cf, 1.6) + 24
        d.rounded_rectangle([60 * X, (y + 18) * X, (60 + w) * X, (y + 52) * X], radius=17 * X, fill=(180, 76, 74) if chip != "Running today" else (255, 255, 255, 30))
        self.text(d, (72, y + 26), chip.upper(), cf, WHITE, track=1.6)
        if self.domain:
            self.text(d, (60, H - 46), self.domain, self.font("jetbrains-mono-700", 14), (255, 255, 255, 110))

        save(img, d, path)

    def car(self, name: str, h: int) -> Image.Image | None: # One car's side view, h pixels tall at 2x
        if name not in self.cars:
            path = FRONTEND / "trains" / f"{name}.webp"
            if not path.exists():
                return None

            pic = Image.open(path).convert("RGBA")
            self.cars[name] = pic.resize((round(pic.width * h / pic.height), h), Image.Resampling.LANCZOS)

        return self.cars[name]

    def train(self, img: Image.Image, d: ImageDraw.ImageDraw, cars: Sequence[str], h: int = 50) -> None: # The route's train along the bottom, nose at the right, its tail going under the panel's fade
        rail = H - 26
        d.line([(0, rail * X), (W * X, rail * X)], fill=WHITE + (70,), width=2 * X)
        x = (W - 36) * X
        for name in reversed(cars):
            pic = self.car(name, h * X)
            if pic is None:
                return

            x -= pic.width
            img.paste(pic, (x, (rail - 1 - h) * X), pic)
            x -= round(h * X * .03) # As the page couples them

    def pair(self, path: Path, sides: list[Side], every: list[list[Pt]]) -> None: # Two routes side by side at one scale, as the comparison window shows them
        img, d = self.canvas()
        PW, PH, top = 545, 380, 128 # Each map's frame
        boxes = [bounds([p for line in lines for p in line], pad=.12, least=.8) for _, _, lines, _ in sides]
        mid = sum((b[1] + b[3]) / 2 for b in boxes) / 2
        k = math.cos(math.radians(mid))
        s = min(min(PW / ((b[2] - b[0]) * k), PH / (b[3] - b[1])) for b in boxes) # One scale for both
        for n, ((kind, name, lines, stops), b) in enumerate(zip(sides, boxes)):
            x0, color = 40 + n * (PW + 30), SIDES[n]
            pane = Image.new("RGB", (PW * X, PH * X), DEEP)
            p = ImageDraw.Draw(pane, "RGBA")
            cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
            at, seen = to_pixels(cx, cy, k, s, PW / 2, PH / 2), in_view(cx, cy, PW / 2 / k / s, PH / 2 / s)
            for bb, ring in self.rings:
                if seen(bb):
                    p.polygon([at(q) for q in ring], fill=(255, 255, 255, 10), outline=(255, 255, 255, 50), width=X)

            for line in every:
                if seen(self.span(line)):
                    p.line([at(q) for q in line], fill=SKY + (40,), width=round(2 * X))

            for w, fill in ((22, color + (40,)), (11, DEEP), (6, color)): # Glow, casing, line
                for line in lines:
                    stroke(p, [at(q) for q in line], fill, w)

            for q in stops:
                dot(p, *at(q), (6 if len(stops) < 20 else 4.5) * X, fill=WHITE, outline=DEEP, width=2 * X)

            mask = Image.new("L", pane.size, 0)
            ImageDraw.Draw(mask).rounded_rectangle([0, 0, *pane.size], radius=16 * X, fill=255)
            img.paste(pane, (x0 * X, top * X), mask)
            d.rounded_rectangle([x0 * X, top * X, (x0 + PW) * X, (top + 6) * X], radius=3 * X, fill=color) # Its side's colour along the top
            right = n == 1
            kf, nf = self.font("montserrat-700", 15), self.fit(d, name, "poppins-700", 30, PW, rows=1)[0]
            kw = self.tracked(d, kind.upper(), kf, 2)
            nw = min(PW, float(d.textlength(name, font=nf)) / X)
            self.text(d, (x0 + PW - kw if right else x0, top + PH + 14), kind.upper(), kf, color, track=2)
            self.text(d, (x0 + PW - nw if right else x0, top + PH + 36), name, nf, WHITE)

        cx, cy, r = W // 2, top + PH // 2, 30 # Vs, between the maps
        dot(d, cx * X, cy * X, r * X, fill=RED + (255,), outline=NAVY, width=5 * X)
        vf = self.font("poppins-800", 22)
        d.text((cx * X, cy * X), "VS", font=vf, fill=WHITE, anchor="mm")
        mid, x = 66, 40 # The header's middle line: logo, divider, title and address all centred on it
        if self.logo:
            logo = self.logo.resize((150 * X, round(150 * X * self.logo.height / self.logo.width)), Image.Resampling.LANCZOS)
            img.paste(logo, (x * X, round(mid * X - logo.height / 2)), logo)
            x += 150 + 24
            d.line([(x * X, (mid - 24) * X), (x * X, (mid + 24) * X)], fill=(255, 255, 255, 64), width=2 * X) # As the printed sheets have it
            x += 24

        d.text((x * X, mid * X), "Route Comparison", font=self.font("poppins-700", 36), fill=WHITE, anchor="lm")
        if self.domain:
            d.text(((W - 40) * X, mid * X), self.domain, font=self.font("jetbrains-mono-700", 14), fill=(255, 255, 255, 110), anchor="rm")

        save(img, d, path)

def to_pixels(cx: float, cy: float, k: float, s: float, px: float, py: float) -> Callable[[Pt], Point]: # Lon/lat -> drawing pixels: the middle (cx, cy) at (px, py), s pixels a degree north, k times that east
    return lambda p: ((px + (p[0] - cx) * k * s) * X, (py - (p[1] - cy) * s) * X)

def in_view(cx: float, cy: float, rx: float, ry: float) -> Callable[[Box], bool]: # Does a lon/lat box reach into the view
    return lambda b: b[0] < cx + rx and b[2] > cx - rx and b[1] < cy + ry and b[3] > cy - ry

def dot(d: ImageDraw.ImageDraw, x: float, y: float, r: float, **kw: Any) -> None: # A circle round x, y
    d.ellipse([x - r, y - r, x + r, y + r], **kw)

def stroke(d: ImageDraw.ImageDraw, pts: Sequence[Point], fill: Color, w: float) -> None: # A line w wide at 1x, its ends rounded
    d.line(pts, fill=fill, width=round(w * X), joint="curve")
    for x, y in (pts[0], pts[-1]):
        dot(d, x, y, w * X / 2, fill=fill)

def save(img: Image.Image, d: ImageDraw.ImageDraw, path: Path) -> None: # The site's red strip along the top, then down to size as a JPEG
    d.rectangle([0, 0, W * X, 8 * X], fill=(199, 91, 89))
    path.parent.mkdir(parents=True, exist_ok=True)
    img.reduce(X).save(path, quality=85, optimize=True)

def wrap(text: str, measure: Callable[[str], float], width: float) -> list[str]: # Lines that fit
    rows, row = list[str](), ""
    for word in text.split():
        test = f"{row} {word}".strip()
        if row and measure(test) > width:
            rows.append(row)
            row = word
        else:
            row = test

    return rows + ([row] if row else [])