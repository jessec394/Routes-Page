# Population density
import csv
import struct
import sys
import time
from array import array
from pathlib import Path
from typing import Any

from .geometry import Point, rdp, thin
from .paths import ON_MAP, OUT_DATA, Json, cache_get, cache_set, census_files, read_json, write_json

FORMAT = 4 # Changing this rebuilds every state
SCALE_AT = .995 # Share of all tracts below full height

def population_csv() -> Path | None: # The ACS B01003 data file in data/states/ or data/
    found = [f for f in census_files("*.csv") if "B01003" in f.name]
    for f in sorted(found, key=lambda f: "data" not in f.name.lower()):
        with open(f, newline="", encoding="utf-8-sig") as fh:
            if "GEO_ID" in next(csv.reader(fh), []):
                return f

    return None

def read_population(path: Path) -> dict[str, int]: # Tract GEOID -> people
    people: dict[str, int] = {}
    with open(path, newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            geo, n = row.get("GEO_ID", ""), row.get("B01003_001E", "")
            if geo.startswith("1400000US") and n.isdigit():
                people[geo[-11:]] = int(n)

    return people

def read_dbf(path: Path, *wanted: str) -> list[list[str] | None]: # Columns from a dBase table
    raw = path.read_bytes()
    count, head, size = struct.unpack("<IHH", raw[4:12])
    cols: dict[str, tuple[int, int]] = {}
    pos, off = 32, 1
    while raw[pos] != 0x0D:
        cols[raw[pos:pos + 11].split(b"\0")[0].decode()] = (off, raw[pos + 16])
        off, pos = off + raw[pos + 16], pos + 32

    picks = [next((cols[c] for c in cols if c.startswith(w)), None) for w in wanted] # A column the file lacks reads as ""
    rows = (head + n * size for n in range(count))
    return [None if raw[at] == 0x2A else [raw[at + p[0]:at + p[0] + p[1]].decode("latin-1").strip() if p else "" for p in picks] for at in rows] # 0x2A marks a deleted record

def read_shp(path: Path) -> list[list[list[Point]]]: # Polygon records -> rings of points
    raw, pos = path.read_bytes(), 100
    out: list[list[list[Point]]] = []
    while pos + 8 <= len(raw):
        length = struct.unpack(">i", raw[pos + 4:pos + 8])[0] * 2
        body, pos = raw[pos + 8:pos + 8 + length], pos + 8 + length
        if len(body) < 44 or struct.unpack("<i", body[:4])[0] not in (5, 15, 25):
            out.append([])
            continue

        parts, points = struct.unpack("<ii", body[36:44])
        starts = list(struct.unpack(f"<{parts}i", body[44:44 + 4 * parts])) + [points]
        xy = array("d")
        xy.frombytes(body[44 + 4 * parts:44 + 4 * parts + 16 * points])
        if sys.byteorder == "big":
            xy.byteswap()

        out.append([list(zip(xy[2 * a:2 * b:2], xy[2 * a + 1:2 * b:2])) for a, b in zip(starts, starts[1:])])

    return out

def packed(ring: list[Point]) -> list[int]: # Ring -> [lon, lat, dlon, dlat, ...] in 1/10000 degree steps
    out: list[int] = []
    last = (0, 0)
    for x, y in ((round(x * 1e4), round(y * 1e4)) for x, y in rdp(thin(ring, .0003), .0006)):
        if (x, y) != last:
            out += [x - last[0], y - last[1]]
            last = (x, y)

    return out

def point(lon: str, lat: str) -> list[float] | None: # A tract's census internal point -> [lon, lat], or None
    try:
        return [round(float(lon), 5), round(float(lat), 5)]
    except ValueError:
        return None

def build() -> Json: # Pack states whose tract or population files changed
    shapes = {shp.parent.name: shp for shp in reversed(census_files("*/*_tract.shp")) if shp.with_suffix(".dbf").exists() and shp.parent.name.upper() in ON_MAP} # Lower 48 and DC only; census/ last, so its copy wins
    csv_path = population_csv()
    if shapes and not csv_path:
        print("  Tract shapefiles found, but no ACS B01003 population CSV in data/states/ or data/: skipping")
        shapes = {}

    built = cache_get("density")
    def out(sid: str) -> Path:
        return OUT_DATA / "states" / sid / "density.json"

    def stamp(sid: str) -> str:
        return f"{FORMAT}|{csv_path.name}|{csv_path.stat().st_mtime}|{shapes[sid].stat().st_mtime}|{shapes[sid].with_suffix('.dbf').stat().st_mtime}" if csv_path else ""

    todo = [sid for sid in shapes if not out(sid).exists() or built.get(sid, {}).get("stamp") != stamp(sid)]
    if todo and csv_path:
        people = read_population(csv_path)
        for sid in todo:
            start = time.time()
            tracts: list[tuple[list[Any], str, list[float] | None]] = []
            for row, rings in zip(read_dbf(shapes[sid].with_suffix(".dbf"), "GEOID", "ALAND", "INTPTLAT", "INTPTLON"), read_shp(shapes[sid])):
                n, land = (people.get(row[0][-11:]), float(row[1] or 0)) if row else (None, 0)
                kept = [r for r in map(packed, rings) if len(r) >= 6] if row and n and land > 0 else []
                if row and n and kept:
                    tracts.append(([round(n / (land / 1e6), 1), n, *kept], row[0][-11:], point(row[3], row[2]))) # Density, people and outlines; tract ID; census internal point

            tracts.sort(key=lambda t: t[0][0])
            write_json(out(sid), { # Tract IDs and points ride alongside
                "tracts": [t[0] for t in tracts], "ids": [t[1] for t in tracts], "points": [t[2] for t in tracts],
                "source": {"population": csv_path.name.split("-")[0], "tracts": shapes[sid].stem}
            })
            built[sid] = {"v": int(time.time()), "stamp": stamp(sid)}
            print(f"  {sid}: {len(tracts)} tracts, {out(sid).stat().st_size // 1024} KB, {time.time() - start:.1f}s" + ("" if tracts else " (no tracts matched the CSV's GEO_IDs)"))

    removed = [s for s in built if s not in shapes] # States whose tracts were removed
    for sid in removed:
        built.pop(sid)
        out(sid).unlink(missing_ok=True)

    if todo or removed or "scale" not in cache_get("density_scale"): # One height scale for all states
        densities = sorted(t[0] for sid in built for t in read_json(out(sid))["tracts"])
        cache_set("density_scale", {"scale": densities[min(len(densities) - 1, int(len(densities) * SCALE_AT))] if densities else 0})

    cache_set("density", built)
    return summary()

def summary() -> Json: # Population map info for map.json, from the last build
    built = cache_get("density")
    if any(not s.get("stamp", "").startswith(f"{FORMAT}|") for s in built.values()):
        return {} # Built in an older format: build again

    return {"scale": cache_get("density_scale").get("scale", 0), "states": {sid: s["v"] for sid, s in built.items()}} if built else {}