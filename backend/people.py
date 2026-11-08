# People near stations
import csv
import io
import math
import zipfile
from pathlib import Path

from .density import read_dbf, read_population, read_shp
from .geometry import Point, lonlat
from .paths import OUT_DATA, cache_get, cache_set, census_files, read_json, stamp, write_json

OUT = OUT_DATA / "people.json"
MILES = 10 # As the station windows count them
FIPS: dict[str, str] = dict(zip("01 04 05 06 08 09 10 11 12 13 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40 41 42 44 45 46 47 48 49 50 51 53 54 55 56".split(), "AL AZ AR CA CO CT DE DC FL GA ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split()))

def sources() -> tuple[list[Path], list[Path]]: # Population tables, and tract points
    counts = [f for f in census_files("*.csv") if "B01003" in f.name and "Metadata" not in f.name]
    gazetteer = [f for f in census_files("*Gaz_tracts*") if f.suffix.lower() in (".txt", ".zip")]
    return counts, gazetteer or census_files("*/*_tract.dbf")

def points(files: list[Path]) -> dict[str, Point]: # Tract GEOID -> its middle
    out: dict[str, Point] = {}
    for f in files:
        if f.suffix.lower() == ".dbf":
            for row, rings in zip(read_dbf(f, "GEOID", "INTPTLAT", "INTPTLON"), read_shp(f.with_suffix(".shp"))):
                ring = max(rings, key=len, default=[])
                if row and (row[1] and row[2] or ring):
                    out[row[0][-11:]] = (float(row[2]), float(row[1])) if row[1] and row[2] else (sum(x for x, _ in ring) / len(ring), sum(y for _, y in ring) / len(ring)) # No internal point: the outline's middle

            continue

        if f.suffix.lower() == ".zip":
            with zipfile.ZipFile(f) as z:
                text = z.read(next(n for n in z.namelist() if n.endswith(".txt"))).decode("latin-1")
        else:
            text = f.read_text(encoding="latin-1")

        text = text.lstrip("\ufeffï»¿")
        rows = csv.reader(io.StringIO(text), delimiter=max("\t|,", key=text.partition("\n")[0].count)) # Tabs in older years, pipes in newer
        head = [h.strip().upper() for h in next(rows)]
        geo, lat = head.index("GEOID"), next(i for i, h in enumerate(head) if h.startswith("INTPTLAT"))
        lon = next(i for i, h in enumerate(head) if h.startswith("INTPTLON")) # INTPTLONG in most years, INTPTLON in some
        for row in rows:
            try:
                out[row[geo].strip()[-11:]] = (float(row[lon]), float(row[lat]))
            except (IndexError, ValueError):
                pass

    return out

def build() -> bool: # Write people.json when the tract files or stations change
    counts, places = sources()
    cities = read_json(OUT_DATA / "map.json", {}).get("cities", [])
    if not counts or not places or not cities:
        return False

    mark = stamp([*counts, *places, OUT_DATA / "map.json", Path(__file__)])
    if OUT.exists() and cache_get("people").get("stamp") == mark:
        return False

    people: dict[str, int] = {}
    for f in counts:
        people |= read_population(f)

    where, cell = points(places), .25 # Stations bucketed by quarter degree
    grid: dict[tuple[int, int], list[Point]] = {}
    for c in cities:
        lon, lat = lonlat(c)
        grid.setdefault((math.floor(lon / cell), math.floor(lat / cell)), []).append((lon, lat))

    def near(lon: float, lat: float) -> bool: # Within 10 miles of any station
        gx, gy = math.floor(lon / cell), math.floor(lat / cell)
        for i in (-1, 0, 1):
            for j in (-1, 0, 1):
                for x, y in grid.get((gx + i, gy + j), ()):
                    if math.hypot((x - lon) * math.cos(math.radians(lat)) * 69.17, (y - lat) * 69.05) <= MILES:
                        return True

        return False

    kept: list[int] = []
    states: set[str] = set()
    for geo, n in people.items():
        if geo in where and n:
            states.add(FIPS.get(geo[:2], ""))
            lon, lat = where[geo]
            if near(lon, lat):
                kept += [round(lon * 1e4), round(lat * 1e4), n]

    write_json(OUT, {"miles": MILES, "states": sorted(states - {""}), "tracts": kept})
    cache_set("people", {"stamp": mark})
    print(f"  People: {len(kept) // 3} tracts near stations in {len(states - {''})} states")
    return True