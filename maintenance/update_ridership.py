# Download Amtrak's newest ridership figures into data/ridership: riders by route, as Amtrak reports them, and by station
# Needs pypdf (pip install pypdf): Amtrak publishes them only as PDFs
import io
import json
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from backend.names import STATE_NAMES # noqa: E402
from backend.paths import DATA, ON_MAP # noqa: E402

OUT = DATA / "ridership"
MEDIA = "https://media.amtrak.com/wp-json/wp/v2/media?search=ridership&per_page=50&orderby=date&order=desc" # Amtrak's newsroom files, newest first
GUESS = "https://media.amtrak.com/wp-content/uploads/{y}/{m:02d}/FY{fy:02d}-Year-End-Ridership-Fact-Sheet.pdf" # Where the yearly sheet has been put, if the list can't be read
STATE = "https://www.amtrak.com/content/dam/projects/dotcom/english/public/documents/corporate/statefactsheets/{name}{fy:02d}.pdf" # Each state's sheet: its stations' riders
STATES_PAGE = "https://www.amtrak.com/about-amtrak/amtrak-facts/state-fact-sheets.html"
SAVED = DATA / "ridership" / "sheets" # State sheets saved by hand from STATES_PAGE, eg OHIO25.pdf: read before asking amtrak.com
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", "Accept": "application/pdf,application/json,text/html;q=0.9,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9"} # As a browser asks: amtrak.com stalls on requests that don't
SKIP = re.compile(r"total|special trains|bus", re.I) # Rows that aren't a route
CELLS = re.compile(r"^(?P<text>.*?)\s*(?P<vals>(?:(?:[\d,]+|-|N/A|[-+]?\d+(?:\.\d+)?%?)(?:\s+|$))*)$") # A line's words, then any figures after them: "Acela 3,153,621 3,238,130 -2.6", or each cell on a line of its own
STOP = re.compile(r"(?P<name>[A-Z](?:[^\W\d]|[.'’&/ -])*?)\s*\((?P<code>[A-Z]{3})\)\s*(?P<n>\d[\d,]*)") # "Cleveland (CLE) 61,685": no digits in a name, so a footnote mark ends the page text before it

def get(url: str, timeout: float = 45, tries: int = 3) -> bytes: # A file, asked for again after a stall or dropped connection
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=timeout) as response:
                return response.read()
        except urllib.error.HTTPError: # A real answer, eg not found: no use asking again
            raise
        except OSError: # Timed out or cut off
            if k == tries - 1:
                raise

            time.sleep(3 * (k + 1))

    raise OSError(f"couldn't fetch {url}")

def text_of(pdf: bytes) -> str: # A PDF's words, page by page, with its joined letters apart: "Springﬁeld" -> "Springfield"
    from pypdf import PdfReader
    return unicodedata.normalize("NFKC", "\n".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(pdf)).pages))

def number(s: str) -> int | None:
    return int(s.replace(",", "")) if s.replace(",", "").isdigit() else None

def this_fy() -> int: # Amtrak's fiscal year ends in September: the newest finished one
    today = date.today()
    return today.year % 100 if today.month >= 10 else today.year % 100 - 1

def route_sheet() -> tuple[str, bytes]: # The newest yearly ridership sheet: its address and the PDF
    found: list[str] = []
    try:
        found = [m["source_url"] for m in json.loads(get(MEDIA)) if re.search(r"year.?end.?ridership", m.get("source_url", ""), re.I) and m["source_url"].lower().endswith(".pdf")]
    except (OSError, ValueError, KeyError) as e:
        print(f"  (Couldn't read Amtrak's newsroom file list: {e}. Trying the usual addresses.)")

    fy = this_fy()
    found += [GUESS.format(y=2000 + y, m=m, fy=y) for y in range(fy, fy - 3, -1) for m in (11, 10, 12)]
    for url in dict.fromkeys(found):
        try:
            return url, get(url)
        except urllib.error.HTTPError:
            continue

    raise OSError("no year-end ridership sheet found on media.amtrak.com")

def routes(text: str) -> tuple[str, str, list[dict[str, Any]]]: # The sheet's two years and its route rows, in its own words
    years = list(dict.fromkeys(re.findall(r"FY ?(\d{2})\b", text)))[:2]
    rows: list[dict[str, Any]] = []
    name, vals, section = "", list[str](), ""
    for line in (re.sub(r"\s+", " ", l).strip() for l in text.splitlines()):
        m = CELLS.match(line)
        if not m or not line:
            continue

        if m["text"]:
            if name and not vals and not re.search(r"[\d%]", name):
                section = name # Words with no figures after them: a heading, "State Supported: Midwest Routes"

            name, vals = m["text"], []

        vals += m["vals"].split()
        if name and len(vals) >= 3: # A route's riders, the year before's, and the change
            if not SKIP.search(name) and not name.startswith("Route"):
                rows.append({"name": name, "section": section, "riders": number(vals[0]), "prior": number(vals[1])})

            name, vals = "", []

    if len(years) < 2 or len(rows) < 10:
        raise ValueError(f"the sheet's layout wasn't recognised ({len(rows)} route rows found)")

    return f"FY{years[0]}", f"FY{years[1]}", rows

def file_name(state: str) -> list[str]: # "NORTHCAROLINA"; DC tried both ways
    return [re.sub(r"[^A-Z]", "", n.upper()) for n in ([STATE_NAMES[state]] + (["District of Columbia"] if state == "DC" else []))]

def sheet(st: str, fy: int, online: bool = True) -> tuple[str, int, bytes] | None: # A state's newest sheet: saved by hand, else from amtrak.com; None if it has none
    tried = [(name, y) for y in (fy, fy - 1) for name in file_name(st)]
    for name, y in tried:
        if (SAVED / f"{name}{y:02d}.pdf").exists():
            return (SAVED / f"{name}{y:02d}.pdf").relative_to(DATA.parent).as_posix(), y, (SAVED / f"{name}{y:02d}.pdf").read_bytes()

    if not online:
        raise OSError("not asked: amtrak.com kept stalling")

    for name, y in tried:
        url = STATE.format(name=name, fy=y)
        try:
            return url, y, get(url)
        except urllib.error.HTTPError: # Not out for this year, or named otherwise
            continue

    return None

def stations(old: list[dict[str, Any]]) -> tuple[str, dict[str, str], list[dict[str, Any]], list[str]]: # Every state's stations and riders: the year, each sheet, the stations and the states that couldn't be fetched
    fy, sheets, found, years, failed = this_fy(), dict[str, str](), dict[str, dict[str, Any]](), dict[int, int](), list[str]()
    stalls = 0 # In a row: three, and amtrak.com isn't answering scripts today
    for st in sorted(ON_MAP):
        try:
            got = sheet(st, fy, stalls < 3)
            stalls = 0
        except OSError as e: # Stalled even after asking again: the next state may still come
            if stalls < 3:
                print(f"  {st}: {e}" + (": not asking for the rest" if stalls == 2 else ""))

            failed.append(st)
            stalls += 1
            continue

        if not got:
            continue

        sheets[st], y, pdf = got
        years[y] = years.get(y, 0) + 1
        for m in STOP.finditer(re.sub(r"\s+", " ", text_of(pdf))):
            if (n := number(m["n"])) is not None and m["code"] not in found:
                found[m["code"]] = {"code": m["code"], "name": m["name"].strip(), "state": st, "riders": n}

        print(f"  {st}: {sum(s['state'] == st for s in found.values())} stations")

    for s in old: # States that couldn't be fetched keep their earlier figures
        if s["state"] in failed and s["code"] not in found:
            found[s["code"]] = s

    return f"FY{max(years, key=lambda y: years[y], default=fy):02d}", sheets, list(found.values()), failed

def write(path: Path, data: Any) -> None: # Written whole, then put in place
    tmp = path.with_suffix(".part")
    tmp.write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)

def main() -> int:
    try:
        import pypdf # noqa: F401
    except ImportError:
        print("Amtrak's ridership comes as PDFs: run  pip install pypdf  and then this again.")
        return 1

    OUT.mkdir(parents=True, exist_ok=True)
    ok = True
    print("Ridership by route: Amtrak's year-end sheet...")
    try:
        url, pdf = route_sheet()
        year, prior, rows = routes(text_of(pdf))
        write(OUT / "routes.json", {"year": year, "prior": prior, "url": url, "routes": rows})
        print(f"  {year} vs {prior}: {len(rows)} routes, from {url}")
    except (OSError, ValueError) as e:
        ok = False
        print(f"  Stopped: {e}. The copy already in data/ridership (if any) stays.")

    print("Ridership by station: each state's fact sheet...")
    old = json.loads((OUT / "stations.json").read_text(encoding="utf-8")) if (OUT / "stations.json").exists() else {}
    year, sheets, found, failed = stations(old.get("stations", []))
    if sheets:
        write(OUT / "stations.json", {"year": year, "url": STATES_PAGE, "sheets": {**old.get("sheets", {}), **sheets}, "stations": found})
        print(f"  {year}: {len(found)} stations in {len(sheets)} states")

    if failed or not sheets:
        ok = False
        print(f"  amtrak.com didn't send {'any state sheets' if not sheets else 'the sheets for ' + ', '.join(failed)}: {'their earlier figures stay' if sheets else 'the copy already in data/ridership (if any) stays'}.\n"
              f"  Run this again later, or save those states' fact sheets from {STATES_PAGE}\n  into {SAVED.relative_to(DATA.parent).as_posix()}/ as they're named there (eg OHIO25.pdf): they're read from there first")

    print("Done. preview.py matches them to the map's routes and stations on its next build." if ok else "Some figures weren't updated: run this again later.")
    return 0 if ok else 1

if __name__ == "__main__":
    sys.exit(main())