"""Population density: census tracts per state (TIGER shapefile + ACS B01003 CSV) -> docs/data/states/<ID>/density.json"""
import csv
import struct
import sys
import time
from array import array

from .geometry import rdp, thin
from .paths import DATA, ON_MAP, OUT_DATA, STATES, cache_get, cache_set, listing, read_json, write_json

FORMAT = 3  # Changing this rebuilds every state
SCALE_AT = .995  # Share of all tracts below full height

def population_csv():  # The ACS B01003 data file in data/states/ or data/ (not its metadata file)
    found = [f for folder in (STATES, DATA) for f in listing(folder, "*.csv") if "B01003" in f.name]
    for f in sorted(found, key=lambda f: "data" not in f.name.lower()):
        with open(f, newline="", encoding="utf-8-sig") as fh:
            if "GEO_ID" in next(csv.reader(fh), []):
                return f
    return None

def read_population(path):  # Tract GEOID -> people
    people = {}
    with open(path, newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            geo, n = row.get("GEO_ID", ""), row.get("B01003_001E", "")
            if geo.startswith("1400000US") and n.isdigit():
                people[geo[-11:]] = int(n)
    return people

def read_dbf(path, *wanted):  # Columns (by name prefix, e.g. "GEOID") from a dBase table
    raw = path.read_bytes()
    count, head, size = struct.unpack("<IHH", raw[4:12])
    cols, pos, off = {}, 32, 1
    while raw[pos] != 0x0D:
        cols[raw[pos:pos + 11].split(b"\0")[0].decode()] = (off, raw[pos + 16])
        off, pos = off + raw[pos + 16], pos + 32
    picks = [next(cols[c] for c in cols if c.startswith(w)) for w in wanted]
    rows = []
    for n in range(count):
        at = head + n * size
        rows.append(None if raw[at] == 0x2A else [raw[at + o:at + o + w].decode("latin-1").strip() for o, w in picks])  # 0x2A marks a deleted record
    return rows

def read_shp(path):  # Polygon records -> rings of (lon, lat)
    raw, pos, out = path.read_bytes(), 100, []
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

def packed(ring):  # Ring -> [lon, lat, dlon, dlat, ...] in 1/10000 degree steps (about 10 m)
    out, last = [], (0, 0)
    for x, y in ((round(x * 1e4), round(y * 1e4)) for x, y in rdp(thin(ring, .0003), .0006)):
        if (x, y) != last:
            out += [x - last[0], y - last[1]]
            last = (x, y)
    return out

def build():  # Pack states whose tract or population files changed; returns the summary for map.json
    shapes = {shp.parent.name: shp for shp in listing(STATES, "*/*_tract.shp") if shp.with_suffix(".dbf").exists() and shp.parent.name.upper() in ON_MAP}  # (Lower 48 and DC only)
    csv_path = population_csv()
    if shapes and not csv_path:
        print("  Tract shapefiles found, but no ACS B01003 population CSV in data/states/ or data/: skipping")
        shapes = {}
    built, out = cache_get("density"), lambda sid: OUT_DATA / "states" / sid / "density.json"
    stamp = lambda sid: f"{FORMAT}|{csv_path.name}|{csv_path.stat().st_mtime}|{shapes[sid].stat().st_mtime}|{shapes[sid].with_suffix('.dbf').stat().st_mtime}"
    todo = [sid for sid in shapes if not out(sid).exists() or built.get(sid, {}).get("stamp") != stamp(sid)]
    if todo:
        people = read_population(csv_path)
        for sid in todo:
            start, tracts = time.time(), []
            for row, rings in zip(read_dbf(shapes[sid].with_suffix(".dbf"), "GEOID", "ALAND"), read_shp(shapes[sid])):
                n, land = (people.get(row[0][-11:]), float(row[1] or 0)) if row else (None, 0)
                if n and land > 0 and rings:
                    rings = [r for r in map(packed, rings) if len(r) >= 6]
                    if rings:
                        tracts.append([round(n / (land / 1e6), 1), n, *rings])  # People per km2, people, rings
            tracts.sort(key=lambda t: t[0])
            write_json(out(sid), {"tracts": tracts})
            built[sid] = {"v": int(time.time()), "stamp": stamp(sid)}
            print(f"  {sid}: {len(tracts)} tracts, {out(sid).stat().st_size // 1024} KB, {time.time() - start:.1f}s" + ("" if tracts else " (no tracts matched the CSV's GEO_IDs)"))
    removed = [s for s in built if s not in shapes]  # States whose tracts were removed
    for sid in removed:
        built.pop(sid)
        out(sid).unlink(missing_ok=True)
    if todo or removed or "scale" not in cache_get("density_scale"):  # One height scale for all states
        densities = sorted(t[0] for sid in built for t in read_json(out(sid))["tracts"])
        cache_set("density_scale", {"scale": densities[min(len(densities) - 1, int(len(densities) * SCALE_AT))] if densities else 0})
    cache_set("density", built)
    if not todo:
        print(f"  {len(built)} state(s) up to date" if built else "  No tract data")
    return summary()

def summary():  # Population map info for map.json, from the last build
    built = cache_get("density")
    return {"scale": cache_get("density_scale").get("scale", 0), "states": {sid: s["v"] for sid, s in built.items()}} if built else {}
