# Download the newest census tract maps, tract points and tract populations into data/states/census, removing older copies
import csv
import io
import json
import os
import re
import shutil
import sys
import tempfile
import urllib.error
import urllib.request
import zipfile
from datetime import date
from collections.abc import Callable
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from backend.paths import CENSUS, DATA, ON_MAP, census_files # noqa: E402
from backend.people import FIPS # noqa: E402

CODE = {st: code for code, st in FIPS.items()} # "OH" -> "39"
TIGER = "https://www2.census.gov/geo/tiger/TIGER{y}/TRACT/tl_{y}_{code}_tract.zip" # Tract outlines, one state each
GAZETTEER = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/{y}_Gazetteer/{y}_Gaz_tracts_national.zip" # Every tract's middle point
ACS = "https://api.census.gov/data/{y}/acs/acs5?get=NAME,B01003_001E,B01003_001M&for=tract:*&in=state:{code}&in=county:*" # People per tract, 5-year estimates
ACS_YEAR = "https://api.census.gov/data/{y}/acs/acs5?get=B01003_001E&for=state:39" # A small ask, to find the newest year
SHAPE = (".shp", ".dbf", ".shx", ".prj", ".cpg") # What the build reads of a shapefile
YEARS = range(date.today().year, date.today().year - 6, -1) # Newest first
KEY = os.environ.get("CENSUS_API_KEY", "") # Optional: only needed past 500 requests a day

def get(url: str, head: bool = False) -> bytes:
    request = urllib.request.Request(url + (f"&key={KEY}" if KEY and "api.census.gov" in url else ""), method="HEAD" if head else "GET", headers={"User-Agent": "aao-proposed-routes/1.0 (census update)"})
    with urllib.request.urlopen(request, timeout=300) as response:
        return response.read()

def table(body: bytes) -> list[list[Any]] | None: # The API's answer as rows, or None if it sent something else, eg a page about a year not out yet
    try:
        rows = json.loads(body)
        return rows if isinstance(rows, list) and len(rows) > 1 else None

    except ValueError:
        return None

def newest(url: Callable[[int], str], check: Callable[[bytes], Any] | None = None) -> int | None: # The latest year a file is published for, or None
    for y in YEARS:
        try:
            body = get(url(y), head=check is None)
            if check is None or check(body):
                return y

        except urllib.error.HTTPError as e:
            if e.code not in (400, 403, 404):
                raise

    return None

def year_of(f: Path) -> int: # The year in a file's name
    m = re.search(r"20\d\d", f.name)
    return int(m.group()) if m else 0

def remove(files: list[Path], why: str) -> None:
    for f in files:
        f.unlink()
        print(f"    removed {f.relative_to(DATA.parent).as_posix()} ({why})")

def tracts(everywhere: bool) -> None: # Each state's tract outlines
    folders = [CENSUS / st for st in sorted(ON_MAP)] # Each state's own folder in data/states/census/
    wanted = [d for d in folders if everywhere or any(d.glob("*_tract.shp"))]
    if not wanted:
        return print("Tract maps: no state folder has any yet (add --all to fetch every state's)")

    y = newest(lambda y: TIGER.format(y=y, code=CODE[wanted[0].name.upper()]))
    if not y:
        return print("Tract maps: couldn't find any on census.gov")

    print(f"Tract maps: newest are {y}'s")
    for d in wanted:
        code, have = CODE[d.name.upper()], list(d.glob("tl_*_tract.*"))
        if any(f.suffix == ".shp" and year_of(f) == y for f in have):
            print(f"  {d.name}: up to date")
            remove([f for f in have if year_of(f) != y], "older")
            continue

        d.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(io.BytesIO(get(TIGER.format(y=y, code=code)))) as z, tempfile.TemporaryDirectory(dir=d) as tmp: # Unpacked whole, then put in place
            for n in z.namelist():
                if Path(n).suffix.lower() in SHAPE:
                    (Path(tmp) / Path(n).name).write_bytes(z.read(n))

            for f in Path(tmp).iterdir():
                shutil.move(f, d / f.name)

        print(f"  {d.name}: downloaded tl_{y}_{code}_tract")
        remove([f for f in have if year_of(f) != y and f.exists()], "older")

def points() -> None: # Where each tract is, nationwide
    have = census_files("*Gaz_tracts*")
    y = newest(lambda y: GAZETTEER.format(y=y))
    if not y:
        return print("Tract points: couldn't find any on census.gov")

    if any(year_of(f) == y for f in have):
        print(f"Tract points: {y}'s already here")
        return remove([f for f in have if year_of(f) != y], "older")

    with zipfile.ZipFile(io.BytesIO(get(GAZETTEER.format(y=y)))) as z:
        name = next(n for n in z.namelist() if n.lower().endswith(".txt"))
        (CENSUS / Path(name).name).write_bytes(z.read(name))

    print(f"Tract points: downloaded {Path(name).name}")
    remove([f for f in have if f.name != Path(name).name], "older")

def people() -> None: # People per tract, every state on the map
    have = census_files("*B01003*")
    y = newest(lambda y: ACS_YEAR.format(y=y), table)
    if not y:
        return print("Populations: couldn't find any 5-year estimates on api.census.gov")

    out = CENSUS / f"ACSDT5Y{y}.B01003-Data.csv"
    if out.exists():
        print(f"Populations: {y}'s already here")
        return remove([f for f in have if f != out], "older or replaced")

    print(f"Populations: downloading {y}'s 5-year estimates, one state at a time")
    rows: list[list[str]] = []
    for st in sorted(ON_MAP):
        body = get(ACS.format(y=y, code=CODE[st]))
        found = table(body)
        if not found:
            raise ValueError(f"api.census.gov sent something other than {st}'s tracts: {body[:300].decode('utf-8', 'replace').strip()}")

        at = {k: i for i, k in enumerate(found[0])}
        rows += [[f"1400000US{r[at['state']]}{r[at['county']]}{r[at['tract']]}", r[at["NAME"]], r[at["B01003_001E"]], r[at["B01003_001M"]]] for r in found[1:]]
        print(f"  {st}: {len(found) - 1} tracts")

    with tempfile.NamedTemporaryFile("w", newline="", encoding="utf-8", dir=CENSUS, suffix=".csv", delete=False) as f: # Written whole, then put in place
        w = csv.writer(f)
        w.writerows([["GEO_ID", "NAME", "B01003_001E", "B01003_001M"], ["Geography", "Geographic Area Name", "Estimate!!Total", "Margin of Error!!Total"], *rows]) # The same two header rows as data.census.gov's download

    Path(f.name).replace(out)
    print(f"  Wrote {out.name}: {len(rows)} tracts")
    remove([f for f in have if f != out and f.exists()], "older or replaced")

def main() -> int:
    CENSUS.mkdir(parents=True, exist_ok=True)
    try:
        tracts("--all" in sys.argv)
        points()
        people()

    except (OSError, ValueError, KeyError, zipfile.BadZipFile) as e: # URLError is an OSError
        print(f"Stopped: {e}. Nothing older was removed for the step that failed; run this again once census.gov answers.")
        return 1

    print("Done. preview.py rebuilds the population maps and counts on its next run.")
    return 0

if __name__ == "__main__":
    sys.exit(main())