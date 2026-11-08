# Download the newest train schedules into data/gtfs, replacing what's there
import csv
import io
import json
import re
import shutil
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

SEARCH = "amtrak" # Schedules whose operator or name says this
GTFS = Path(__file__).resolve().parent.parent / "data" / "gtfs"
CATALOG = "https://files.mobilitydatabase.org/feeds_v2.csv" # Every schedule the Mobility Database knows, with the address of its latest copy
LATEST = "https://files.mobilitydatabase.org/{}/latest.zip" # That address as it's usually written, if the list can't be read
ID_FILE = "source.json" # Kept in each schedule's folder
TABLES = {"agency.txt", "stops.txt", "routes.txt", "trips.txt", "stop_times.txt", "calendar.txt", "calendar_dates.txt", "feed_info.txt"} # What the site reads

def get(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "aao-proposed-routes/1.0 (schedule update)"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read()

def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "schedule"

def credit(row: dict[str, str]) -> str: # Whose schedule it is, as the site credits it
    provider, name = row.get("provider") or "", row.get("name") or ""
    return provider if SEARCH in provider.lower() or not name else name

Found = tuple[str, str, list[str], str] # A schedule: its Mobility Database id, folder, addresses to try and whose it is

def schedules() -> list[Found]: # Every current Amtrak schedule
    try:
        rows = list(csv.DictReader(io.StringIO(get(CATALOG).decode("utf-8-sig"))))
    except Exception as e:
        known: list[tuple[str, str, str]] = []
        for f in sorted(GTFS.glob("*/" + ID_FILE)):
            try:
                about = json.loads(f.read_text(encoding="utf-8"))
                known.append((about["id"], f.parent.name, about.get("provider", "")))
            except (ValueError, KeyError):
                pass

        known = known or [("mdb-11", "amtrak", "Amtrak")]
        print(f"  (Couldn't read the Mobility Database's list of schedules: {e}. Refreshing the ones already here: {', '.join(i for i, _, _ in known)}.)")
        return [(i, folder, [LATEST.format(i)], provider) for i, folder, provider in known]

    found: list[Found] = []
    names: set[str] = set()
    for row in rows:
        about = f"{row.get('provider', '')} {row.get('name', '')}".lower()
        if (row.get("data_type") or "gtfs") != "gtfs" or SEARCH not in about:
            continue

        if (row.get("status") or "").lower() in ("deprecated", "inactive") or row.get("redirect.id"): # Replaced by another, or no longer published
            continue

        folder = slug(credit(row) or row["id"])
        if folder in names:
            folder = f"{folder}-{row['id']}"

        names.add(folder)
        urls = [row[k] for k in ("urls.latest", "urls.direct_download") if row.get(k)]
        found.append((row["id"], folder, list(dict.fromkeys(urls + [LATEST.format(row["id"])])), credit(row)))

    return found

def unpack(data: bytes) -> dict[str, bytes]: # A downloaded GTFS .zip -> {file name: bytes}
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        inner = next((n[:-len("stops.txt")] for n in z.namelist() if n.endswith("stops.txt") and n.count("/") <= 1), None)
        if inner is None:
            raise ValueError("no stops.txt in it: not a GTFS schedule")

        return {n[len(inner):]: z.read(n) for n in z.namelist() if n.startswith(inner) and n[len(inner):] in TABLES}

def describe(files: dict[str, bytes]) -> str: # "Oct 24, 2026 to Oct 25, 2027"
    info = (list(csv.DictReader(io.StringIO(files.get("feed_info.txt", b"").decode("utf-8-sig")))) or [{}])[0]
    def day(d: str) -> str:
        return f"{['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][int(d[4:6]) - 1]} {int(d[6:])}, {d[:4]}" if len(d) == 8 and d.isdigit() else d

    return " to ".join(day(d) for d in (info.get("feed_start_date", ""), info.get("feed_end_date", "")) if d)

def main() -> int:
    print("Finding Amtrak's train schedules on the Mobility Database...")
    found = schedules()
    if not found:
        print("No schedules found: check your internet connection and run this again.")
        return 1

    fetched: dict[str, tuple[dict[str, str], dict[str, bytes]]] = {} # Folder -> where it came from, and its files
    for mdb, folder, urls, provider in found:
        for url in urls:
            try:
                fetched[folder] = ({"id": mdb, "provider": provider}, unpack(get(url)))
                span = describe(fetched[folder][1])
                print(f"  {provider or folder} ({mdb})" + (f": {span}" if span else ""))
                break
            except Exception as e:
                print(f"  {mdb}: {url} didn't work ({e})")
        else:
            print(f"  {mdb}: not updated; the copy already in data/gtfs (if any) stays")

    if not fetched:
        print("Nothing downloaded: check your internet connection and run this again.")
        return 1

    GTFS.mkdir(parents=True, exist_ok=True)
    everything = len(fetched) == len(found)
    for old in GTFS.iterdir(): # Clear what came before
        if everything and old.is_file() and old.suffix.lower() in (".txt", ".zip"):
            old.unlink()
        elif old.is_dir() and (old.name in fetched or everything and any(old.rglob("stops.txt"))):
            shutil.rmtree(old)

    for folder, (about, files) in fetched.items():
        with tempfile.TemporaryDirectory(dir=GTFS) as tmp: # Written whole, then put in place
            for name, data in files.items():
                (Path(tmp) / name).write_bytes(data)

            (Path(tmp) / ID_FILE).write_text(json.dumps(about, indent=4), encoding="utf-8")
            shutil.copytree(tmp, GTFS / folder)

    print(f"Done: {len(fetched)} schedule{'s' if len(fetched) != 1 else ''} in data/gtfs. The site uses them on preview.py's next build.")
    return 0

if __name__ == "__main__":
    sys.exit(main())