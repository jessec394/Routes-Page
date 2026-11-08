# Lines and points: lon/lat pairs, or km on a rough flat plane
from collections.abc import Iterable, Sequence
from typing import Any, TypeVar

Pt = Sequence[float] # A point as given: a tuple, or a list from JSON
Point = tuple[float, float]
Line = list[Point]
Box = tuple[float, float, float, float] # Lon/lat bounds: west, south, east, north
P = TypeVar("P", bound=Pt) # Points kept as they came

def thin(line: Sequence[P], step: float) -> list[P]: # Drop points closer than `step` to the last one kept
    out = [line[0]]
    for pt in line[1:]:
        if abs(pt[0] - out[-1][0]) + abs(pt[1] - out[-1][1]) > step:
            out.append(pt)

    return out + ([line[-1]] if out[-1] != line[-1] else [])

def rdp(line: Sequence[P], eps: float) -> list[P]: # Drop points that move the line less than `eps`
    if len(line) < 3:
        return list(line)

    keep, stack = {0, len(line) - 1}, [(0, len(line) - 1)]
    while stack:
        i, j = stack.pop()
        (x1, y1), (x2, y2) = line[i], line[j]
        dx, dy = x2 - x1, y2 - y1
        norm = (dx * dx + dy * dy) ** .5
        far, k = 0.0, None
        for n in range(i + 1, j):
            px, py = line[n]
            d = abs(dy * px - dx * py + x2 * y1 - y2 * x1) / norm if norm else ((px - x1) ** 2 + (py - y1) ** 2) ** .5
            if d > far:
                far, k = d, n

        if k is not None and far > eps:
            keep.add(k)
            stack += [(i, k), (k, j)]

    return [line[n] for n in sorted(keep)]

def lonlat(c: Any) -> Point: # A station's place, its numbers sometimes written as text
    return float(c["lon"]), float(c["lat"])

def flat(pt: Pt) -> Point: # Lon/lat -> rough km plane, for distances
    return (pt[0] * 77, -pt[1] * 100)

def dist(a: Pt, b: Pt) -> float:
    return ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** .5

def length(lines: Iterable[Sequence[Pt]]) -> float: # Total length of some lines
    return sum(dist(a, b) for line in lines for a, b in zip(line, line[1:]))

def nearest(p: Pt, line: Sequence[Pt]) -> tuple[float, int, float]: # Closest spot on a line to p: distance, segment end and how far along
    best = (float("inf"), 1, 0.0)
    for k in range(1, len(line)):
        (ax, ay), (bx, by) = line[k - 1], line[k]
        dx, dy = bx - ax, by - ay
        t = max(0, min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy or 1)))
        d = dist(p, (ax + t * dx, ay + t * dy))
        if d < best[0]:
            best = (d, k, t)

    return best

def gap_to(p: Pt, lines: Iterable[Sequence[Pt]]) -> float: # Distance from p to the nearest of some lines
    return min((nearest(p, line)[0] for line in lines if len(line) > 1), default=float("inf"))

def span(pts: Sequence[Pt]) -> Box: # Lon/lat box round some points
    return min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts)

def bounds(points: Sequence[Pt], pad: float = .15, least: float = 1.5) -> Box: # Lon/lat box around points, padded, at least `least` degrees across
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    w, h = max(least, (max(xs) - min(xs)) * (1 + 2 * pad)), max(least * .6, (max(ys) - min(ys)) * (1 + 2 * pad))
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    return cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2