# Present-day train times
import csv
import datetime as dt
import io
import json
import math
import re
import zipfile
from collections.abc import Iterable
from dataclasses import dataclass, field
from functools import cache
from pathlib import Path
from zoneinfo import ZoneInfo

from .geometry import Pt, lonlat
from .names import bare, codes_of, label_of, route_key
from .paths import DATA, OUT_DATA, Json, cache_get, cache_set, listing, read_json, stamp, write_json

GTFS = DATA / "gtfs"
OUT = OUT_DATA / "schedules.json"
NIGHT = (22, 6) # Overnight: from 10 PM until 6 AM, station time
NEAR_KM = 3 # A stop with no station code on the map: this close to a map station with none, it's that station
CODE = re.compile(r"^[A-Z]{3}$") # Amtrak's station codes, its stops' ids
COMMUTER = re.compile(r"\bcommuter\b", re.I) # Amtrak's schedule files its partners' commuter trains as "Commuter Rail"
DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] # calendar.txt's columns
SOURCE = {"name": "Amtrak", "via": "Mobility Database", "url": "https://mobilitydatabase.org/feeds/gtfs/mdb-11"} # Credit shown with the times

Row = dict[str, str] # A line of a GTFS table
Call = tuple[int, str, int, str, str] # A trip at a stop: order, stop id, seconds into the day, pickup and drop-off types
Run = tuple[str, ...] # A train's map stations, in order
Mark = tuple[tuple[float, float, int], ...] # A train by where and when it calls, to spot the same train in two schedules

@dataclass(frozen=True)
class Feed: # One schedule, a folder or a .zip
    path: Path
    inner: str = "" # Its folder inside the .zip

    @property
    def name(self) -> str: # Keeps its ids apart from other schedules'
        return "" if self.path == GTFS else self.path.relative_to(GTFS).with_suffix("").as_posix()

    def read(self, name: str) -> str: # A file's text
        if self.path.suffix.lower() == ".zip":
            with zipfile.ZipFile(self.path) as z:
                return z.read(self.inner + name).decode("utf-8-sig") if self.inner + name in z.namelist() else ""

        path = self.path / name
        return path.read_bytes().decode("utf-8-sig") if path.exists() else ""

    def table(self, name: str) -> list[Row]: # A GTFS table as dicts
        text = self.read(name)
        return [{k.strip(): (v or "").strip() for k, v in row.items() if k} for row in csv.DictReader(io.StringIO(text))] if text else []

@dataclass
class Timetable: # Every schedule's trains, their ids kept apart per schedule
    stamp: str = ""
    rail: dict[str, Row] = field(default_factory=dict) # Intercity routes
    stops: dict[str, Row] = field(default_factory=dict)
    trips: dict[str, Row] = field(default_factory=dict)
    calls: dict[str, list[Call]] = field(default_factory=dict) # Trip -> its stops, in order
    calendar: dict[str, Row] = field(default_factory=dict) # Service -> its weekdays and dates
    extra: dict[str, dict[str, bool]] = field(default_factory=dict) # Service -> dates added or taken away
    sources: list[Json] = field(default_factory=list) # Whose schedules, for the credit

def overnight_at(minutes: int) -> bool: # Is a station time overnight
    a, b = NIGHT[0] * 60, NIGHT[1] * 60
    return a <= minutes < b if a < b else minutes >= a or minutes < b

def folders() -> list[Feed]: # Schedules: data/gtfs itself, and any other in it, at any depth, unzipped or not
    if not GTFS.exists():
        return []

    found = [Feed(d) for d in sorted({p.parent for p in GTFS.rglob("stops.txt")}, key=lambda d: (d != GTFS, str(d)))]
    for z in sorted(GTFS.rglob("*.zip")):
        try:
            with zipfile.ZipFile(z) as f:
                inner = next((n[:-len("stops.txt")] for n in f.namelist() if n.endswith("stops.txt") and n.count("/") <= 1), None)
        except zipfile.BadZipFile:
            continue

        if inner is not None:
            found.append(Feed(z, inner))

    seen: set[int] = set()
    out: list[Feed] = []
    for f in found: # A schedule both unzipped and still zipped: once
        mark = hash(f.read("stops.txt") + f.read("agency.txt"))
        if mark not in seen:
            seen.add(mark)
            out.append(f)

    return out

def schedule_files() -> list[Path]: # Every file the schedules come from
    return [p for f in folders() for p in ([f.path] if f.path.suffix.lower() == ".zip" else listing(f.path, "*.txt"))]

def km(a: Pt, b: Pt) -> float: # Great-circle distance between points
    r = math.pi / 180
    h = math.sin((b[1] - a[1]) * r / 2) ** 2 + math.cos(a[1] * r) * math.cos(b[1] * r) * math.sin((b[0] - a[0]) * r / 2) ** 2
    return 12742 * math.asin(min(1, math.sqrt(h)))

def seconds(t: str) -> int: # "25:10:00" -> seconds after the service day's start
    h, m, s = (int(x) for x in t.split(":"))
    return h * 3600 + m * 60 + s

def date(s: str) -> dt.date:
    return dt.date(int(s[:4]), int(s[4:6]), int(s[6:8]))

def clock(minutes: int) -> str: # 135 -> "2:15 AM"
    h, m = divmod(minutes, 60)
    return f"{(h % 12) or 12}:{m:02d} {'AM' if h < 12 else 'PM'}"

def nice_date(s: str) -> str: # "20261025" -> "Oct 25, 2026"
    d = date(s)
    return f"{d:%b} {d.day}, {d.year}"

def days_text(days: set[int]) -> str: # {0, 2, 4} -> "Mon, Wed, Fri"
    if len(days) == 7:
        return "Daily"

    return {frozenset(range(5)): "Weekdays", frozenset({5, 6}): "Weekends"}.get(frozenset(days)) or ", ".join(DAYS[d] for d in sorted(days))

def route_name(route: Row) -> str: # Amtrak's name for a route
    return route.get("route_long_name") or route.get("route_short_name") or "Amtrak"

def utc_shift(tz: str) -> float: # A zone's winter offset in seconds, to compare times across schedules
    try:
        return (ZoneInfo(tz).utcoffset(dt.datetime(2026, 1, 15)) or dt.timedelta()).total_seconds()
    except Exception: # No time zone data on this computer
        return 0

_timetable = Timetable()

def feed() -> Timetable: # Every schedule's trains, read again only when a file changed
    global _timetable
    mark = stamp(schedule_files())
    if _timetable.stamp == mark:
        return _timetable

    f = Timetable(mark)
    seen: set[Mark] = set() # Trains already read: where schedules overlap, each once
    for folder in folders():
        tag = folder.name + ":" if folder.name else ""
        agency = (folder.table("agency.txt") or [{}])[0]
        tz = agency.get("agency_timezone") or "America/New_York" # Every time in a schedule is in its agency's zone, whatever the station's
        info = (folder.table("feed_info.txt") or [{}])[0]
        own = {tag + r["route_id"]: r for r in folder.table("routes.txt") if r.get("route_type") == "2" and not COMMUTER.search(route_name(r))} # Intercity trains only
        f.rail.update(own)
        for s in folder.table("stops.txt"):
            f.stops[tag + s["stop_id"]] = {**s, "parent_station": tag + s["parent_station"] if s.get("parent_station") else ""}

        before = len(f.trips)
        for t in folder.table("trips.txt"):
            if tag + t.get("route_id", "") in own:
                f.trips[tag + t["trip_id"]] = {**t, "route_id": tag + t["route_id"], "service_id": tag + t["service_id"], "tz": tz, "feed": tag}

        for st in folder.table("stop_times.txt"):
            tid, t = tag + st.get("trip_id", ""), st.get("departure_time") or st.get("arrival_time")
            if tid in f.trips and t:
                f.calls.setdefault(tid, []).append((int(st.get("stop_sequence") or 0), tag + st["stop_id"], seconds(t), st.get("pickup_type", "0"), st.get("drop_off_type", "0")))

        shift, stops = utc_shift(tz), f.stops
        marks: set[Mark] = set()
        for tid in list(f.trips)[before:]: # Within one schedule, the same times on other days stay
            mark = tuple((round(float(stops[sid].get("stop_lat") or 0), 2), round(float(stops[sid].get("stop_lon") or 0), 2), round((secs - shift) / 60)) for _, sid, secs, *_ in sorted(f.calls.get(tid, [])) if sid in stops)
            if mark in seen:
                del f.trips[tid]
                f.calls.pop(tid, None)
            else:
                marks.add(mark)

        seen |= marks
        mine = {tag + c["service_id"]: c for c in folder.table("calendar.txt")}
        f.calendar.update(mine)
        for e in folder.table("calendar_dates.txt"):
            f.extra.setdefault(tag + e["service_id"], {})[e["date"]] = e.get("exception_type") == "1"

        if len(f.trips) == before: # Nothing of its own
            continue

        try: # Whose it is: as update_schedules.py noted it, else the schedule's own say
            provider = str(json.loads(folder.read("source.json") or "{}").get("provider", ""))
        except ValueError:
            provider = ""

        first = info.get("feed_start_date") or min((c["start_date"] for c in mine.values()), default="")
        last = info.get("feed_end_date") or max((c["end_date"] for c in mine.values()), default="")
        f.sources.append({"tag": tag, "name": provider or info.get("feed_publisher_name") or agency.get("agency_name") or folder.name, "from": first, "to": last, "version": info.get("feed_version", ""), "trains": len(f.trips) - before})

    for c in f.calls.values():
        c.sort()

    _timetable = f
    return f

def stations_of(cities: Iterable[Json]) -> dict[str, str]: # Schedule stop -> map station: by the station code network.json gives it, else a stop on the spot of a station with no code, eg another railroad's
    stops, station_of = feed().stops, dict[str, str]()
    cities = list(cities)
    by_code = {code: str(c["name"]) for c in cities for code in codes_of(c)}
    places = [(str(c["name"]), lonlat(c)) for c in cities if not codes_of(c)]
    for sid, s in stops.items():
        if (code := sid.split(":")[-1]) in by_code:
            station_of[sid] = by_code[code]
            continue

        try:
            p = (float(s["stop_lon"]), float(s["stop_lat"]))
        except (KeyError, ValueError):
            continue

        best = min(((km(p, at), name) for name, at in places), default=(math.inf, ""))
        if best[0] <= NEAR_KM:
            station_of[sid] = best[1]

    for sid, s in stops.items(): # Platforms count as their station
        parent = s.get("parent_station")
        if parent and sid not in station_of and parent in station_of:
            station_of[sid] = station_of[parent]

    return station_of

def stopping(seq: Iterable[Call], station_of: dict[str, str]) -> Run: # A trip's map stations, in order, where it stops
    return tuple(dict.fromkeys(station_of[sid] for _, sid, _, pickup, dropoff in seq if sid in station_of and not (pickup == "1" and dropoff == "1")))

def today_routes(cities: list[Json], future: list[Json], notes: dict[str, Json | str]) -> list[Json]: # Today's routes from the schedule
    if not schedule_files():
        return []

    f, station_of, match = feed(), stations_of(cities), Matcher(future)
    kinds: dict[str, str] = {}
    lists: dict[str, list[list[str]]] = {}
    for r in future:
        kinds.setdefault(label_of(r), r.get("type", ""))
        lists.setdefault(label_of(r), []).append(r.get("stops", []))

    runs: dict[str, set[Run]] = {} # Route name -> its trains' station runs
    for tid, trip in f.trips.items():
        run = stopping(f.calls.get(tid, []), station_of)
        if len(run) < 2:
            continue

        theirs = route_name(f.rail[trip["route_id"]])
        for label, part in match.pieces(theirs, run) or [(theirs, run)]:
            runs.setdefault(label, set()).add(part)

    where = {c["name"]: lonlat(c) for c in cities}
    building = {c["name"] for c in cities if str(c.get("status", "")).lower() == "under construction" or str(c.get("type", "")).lower() == "future"} # Stations being built
    def passing(run: Run, label: str) -> Run: # A run with the stations being built that it passes
        out = list(run)
        for stops in lists.get(label, []):
            for k, n in enumerate(stops[1:-1], 1):
                if n in building and n not in out:
                    a, b = stops[k - 1], stops[k + 1]
                    for i in range(len(out) - 1):
                        if {out[i], out[i + 1]} == {a, b}:
                            out.insert(i + 1, n)
                            break

        return tuple(out)

    out: list[Json] = []
    for label, found in sorted(runs.items()):
        branches = [passing(run, label) for run in trunk_runs(found)]
        length = max(sum(km(where[a], where[b]) for a, b in zip(run, run[1:])) for run in branches)
        kind = kinds.get(label) or ("Long-Distance" if length > 1207 else "State-Supported") # Not a network.json route: Amtrak's own line, 750 miles
        note = notes.get(label)
        note = note.get("status") if isinstance(note, dict) else note
        names: dict[str, int] = {}
        for run in branches:
            name = f"{bare(run[0])} - {bare(run[-1])}"
            names[name] = names.get(name, 0) + 1
            out.append({"name": name if names[name] == 1 else f"{name} ({names[name]})", "group": label, "type": kind, "status": f"Exists: {note}" if note else "Exists", "stops": list(run), "today": True})

    return out

def trunk_runs(runs: Iterable[Run]) -> list[Run]: # A route's runs as branches
    ordered = sorted(set(runs), key=lambda run: (-len(run), run)) # Ties in a fixed order: the same build every time
    pos = {n: k for k, n in enumerate(ordered[0])}
    turned: list[Run] = []
    for run in ordered:
        shared = [pos[n] for n in run if n in pos]
        turned.append(run[::-1] if len(shared) > 1 and shared[0] > shared[-1] else run)

    keep: list[Run] = []
    for run in sorted(dict.fromkeys(turned), key=len, reverse=True):
        if not any(set(run) <= set(k) for k in keep):
            keep.append(run)

    return keep

def typical_week(calendar: dict[str, Row], extra: dict[str, dict[str, bool]], today: dt.date | None = None) -> dt.date: # Monday of a coming week without holiday changes, else the schedule's last full week
    today = today or dt.date.today()
    first = min((date(c["start_date"]) for c in calendar.values() if c.get("start_date")), default=today)
    end = max((date(c["end_date"]) for c in calendar.values() if c.get("end_date")), default=today)
    last = end - dt.timedelta(days=6 + (end - dt.timedelta(days=6)).weekday()) # Monday of the last whole week
    start = max(today, first)
    start += dt.timedelta(days=(7 - start.weekday()) % 7)
    weeks = [start + dt.timedelta(weeks=k) for k in range(8)] if start <= last else [last - dt.timedelta(weeks=k) for k in range(8)] # Past its end: the same pattern repeats
    weeks = [m for m in weeks if first <= m <= last] or [max(first, min(start, last))]
    changes = {d for days in extra.values() for d in days}
    return min(weeks, key=lambda m: (sum((m + dt.timedelta(days=k)).strftime("%Y%m%d") in changes for k in range(7)), abs((m - start).days)))

def build() -> bool: # Write schedules.json when the schedule files or the map's stations changed
    files = schedule_files()
    if not files:
        return False

    mark = stamp([*files, OUT_DATA / "map.json", Path(__file__)])
    if OUT.exists() and cache_get("schedules").get("stamp") == mark:
        return False

    try:
        ZoneInfo("America/Chicago")
    except Exception:
        print("  Schedules: skipped. This computer's Python has no time zone data: run  pip install tzdata  and start preview.py again")
        return False

    data = read_json(OUT_DATA / "map.json", {})
    f, station_of = feed(), stations_of(data.get("cities", []))
    monday = typical_week(f.calendar, f.extra)
    week = [monday + dt.timedelta(days=k) for k in range(7)]
    def runs(service: str, day: dt.date) -> bool: # Does a service run on this date
        key = day.strftime("%Y%m%d")
        if key in f.extra.get(service, {}):
            return f.extra[service][key]

        c = f.calendar.get(service)
        if not c:
            return False

        return c.get(WEEKDAYS[day.weekday()]) == "1" and date(c["start_date"]) <= day <= date(c["end_date"])

    match = Matcher([r for r in data.get("routes", []) if not r.get("today")])
    stations: dict[str, dict[tuple[str, int], Json]] = {} # Station -> (route, minutes) -> its days and directions
    joined: dict[str, str] = {} # Trains: trips calling together are one
    first: dict[tuple[str, str, int, dt.date], str] = {}
    visits: dict[str, list[tuple[str, str, dt.date]]] = {}
    used: set[str] = set()
    routes: dict[str, dict[str, set[str]]] = {} # Map route -> Amtrak's names for its trains and the stations they start or end at
    def train(t: str) -> str: # The train a trip is part of
        while joined.get(t, t) != t:
            t = joined[t] = joined.get(joined[t], joined[t])

        return t

    def end(sid: str, said: str = "") -> str: # A trip's end as the map names it
        return bare(station_of[sid]) if sid in station_of else said or (f.stops.get(sid, {}).get("stop_name") or "").split(",")[0]

    for tid, trip in f.trips.items():
        seq = sorted(f.calls.get(tid, []))
        if len(seq) < 2:
            continue

        toward, origin = end(seq[-1][1], trip.get("trip_headsign", "")), end(seq[0][1])
        theirs = route_name(f.rail[trip["route_id"]])
        run = stopping(seq, station_of)
        parts = match.pieces(theirs, run)
        for label, part in parts or [(theirs, run)]:
            known = routes.setdefault(label, {"names": set(), "ends": set()})
            known["names"].add(theirs)
            known["ends"].update((part[0], part[-1]) if part else ())

        days_run, home_tz = [d for d in week if runs(trip["service_id"], d)], ZoneInfo(trip["tz"])
        for k, (_, sid, secs, pickup, dropoff) in enumerate(seq):
            station = station_of.get(sid)
            if not station or (pickup == "1" and dropoff == "1"): # Passes without stopping
                continue

            tz = ZoneInfo(f.stops[sid].get("stop_timezone") or str(home_tz))
            heading = "" if k == len(seq) - 1 else toward # The last stop: an arrival
            name = next((label for label, part in reversed(parts) if station in part), theirs) # The map's name for it
            for d in days_run:
                at = (dt.datetime(d.year, d.month, d.day, 12, tzinfo=home_tz) - dt.timedelta(hours=12) + dt.timedelta(seconds=secs)).astimezone(tz) # GTFS times count from noon minus 12 h, so they hold across clock changes
                minutes = at.hour * 60 + at.minute
                call = stations.setdefault(station, {}).setdefault((name, minutes), {"days": set(), "to": set(), "from": set()}) # One train per route, time and day
                call["days"].add(at.weekday())
                key = (station, name, minutes, d)
                if key in first:
                    a, b = train(tid), train(first[key])
                    if a != b:
                        joined[a] = b
                else:
                    first[key] = tid

                visits.setdefault(tid, []).append((station, name, d))
                used.add(trip["feed"])
                call["to" if heading else "from"].add(heading or origin)

    per_route: dict[tuple[str, str], set[tuple[str, dt.date]]] = {} # (route, station) -> trains calling there
    per_station: dict[str, set[tuple[str, dt.date]]] = {}
    for tid, seen in visits.items():
        t = train(tid)
        for station, name, d in seen:
            per_route.setdefault((name, station), set()).add((t, d))
            per_station.setdefault(station, set()).add((t, d))

    counts: dict[str, list[int]] = {}
    for (name, _), v in per_route.items():
        counts.setdefault(name, []).append(len(v))

    lines = {name: sorted(c)[len(c) // 2] for name, c in counts.items()} # A route's trains a week, both ways
    out: dict[str, Json] = {}
    for station, keyed in stations.items():
        by_route: dict[str, list[Json]] = {}
        weekly = overnight = 0
        for (route, minutes), call in sorted(keyed.items()):
            days, heading = call["days"], " / ".join(sorted(call["to"])) if call["to"] else "From " + " / ".join(sorted(call["from"]))
            by_route.setdefault(route, []).append({"to": heading, "time": clock(minutes), "min": minutes, "days": days_text(days), "n": len(days)})
            weekly += len(days)
            overnight += len(days) if overnight_at(minutes) else 0

        out[station] = {"weekly": len(per_station.get(station, ())) or weekly, "overnight": overnight, "routes": [{"name": r, "calls": c} for r, c in by_route.items()]}

    srcs = [x for x in f.sources if x["tag"] in used] # Credited if its trains are on the map
    start, last = min((x["from"] for x in srcs if x["from"]), default=""), max((x["to"] for x in srcs if x["to"]), default="")
    names = list(dict.fromkeys(x["name"] for x in srcs))
    write_json(OUT, {"source": {**SOURCE, "name": " and ".join(names) if len(names) < 3 else ", ".join(names[:-1]) + ", and " + names[-1], "version": srcs[0]["version"] if srcs else "", "from": nice_date(start) if start else "", "to": nice_date(last) if last else "", "week": f"{monday:%b} {monday.day}, {monday.year}"},
                     "night": list(NIGHT), "stations": out, "routes": lines})
    coded = {code for c in data.get("cities", []) for code in codes_of(c)}
    called = {sid for tid in f.trips for _, sid, *_ in f.calls.get(tid, [])}
    missing = sorted({(station_of[sid], code) for sid in called & station_of.keys() if CODE.match(code := sid.split(":")[-1]) and code not in coded})
    warn = [f'Schedules: {name} has Amtrak trains at its stop {code}, but no code: add "code": "{code}" to it in network.json' for name, code in missing] if len(missing) <= 5 else [f"Schedules: {len(missing)} stations have Amtrak trains but no code, eg {', '.join(f'{n} ({c})' for n, c in missing[:5])}. Run data/add_station_codes.py to add them all"] # Found by place for now
    for w in warn:
        print("  " + w)

    cache_set("schedules", {"stamp": mark, "warnings": warn}) # For publish.py
    cache_set("identity", {"routes": {k: {n: sorted(v) for n, v in d.items()} for k, d in sorted(routes.items())}}) # Who's who, for every other source: ridership.py
    each = "; ".join(f"{x['name']}: {x['trains']}" for x in srcs)
    print(f"  Schedules: {len(f.trips)} trains ({each}), {len(out)} stations")
    return True

def present(r: Json) -> bool: # A route running unchanged in network.json
    status = str(r.get("status", "")).lower()
    return not r.get("today") and status.startswith("exists") and "suspended" not in status

class Matcher: # Amtrak's name and a train's stations -> the network.json route it is, by its stations: no list of renamings to keep
    def __init__(self, routes: Iterable[Json]) -> None:
        self.running: dict[str, set[str]] = {} # Route name -> every station its branches list
        self.planned: dict[str, set[str]] = {}
        self.branches: dict[str, list[set[str]]] = {} # Route name -> each branch's stations
        for r in routes:
            if not r.get("today") and "suspended" not in str(r.get("status", "")).lower():
                label = label_of(r)
                (self.running if present(r) else self.planned).setdefault(label, set()).update(r.get("stops", []))
                self.branches.setdefault(label, []).append(set(r.get("stops", [])))

        self.every = {**self.planned, **self.running}

    def fits(self, stations: set[str], ours: dict[str, set[str]], least: float) -> list[tuple[float, float, str]]: # Routes holding enough of the run: how much of it they hold, and how much of their best branch it is
        found = [(len(stations & st) / len(stations), max(len(stations & b) / len(b) for b in self.branches[label] if b), label) for label, st in ours.items() if st]
        return [f for f in found if f[0] >= least]

    @cache
    def match(self, name: str, run: Run) -> str | None: # The one route a whole train is
        stations, theirs = set(run), route_key(name)
        if len(stations) < 2:
            return None

        same = [f for f in self.fits(stations, self.every, .6) if (ours := route_key(f[2])) and (ours in theirs or theirs in ours)]
        close = [f for f in self.fits(stations, self.planned, .8) if f[1] >= .5]
        return max(same or self.fits(stations, self.running, .6) or close, default=(0, 0, None))[2] # A short line beats a long one passing the same stations

    @cache
    def pieces(self, name: str, run: Run) -> list[tuple[str, Run]]: # The routes a train is, each with its part of the run
        whole = self.match(name, run)
        if whole:
            return [(whole, run)]

        mine = [label for label, st in self.every.items() if route_key(label) and route_key(label) in route_key(name) and len(set(run) & st) >= 2]
        if len(mine) < 2:
            return []

        out: list[tuple[str, list[str]]] = []
        for k, n in enumerate(run):
            holders = [label for label in mine if n in self.every[label]]
            if out and out[-1][0] in holders:
                out[-1][1].append(n)
            elif holders:
                nxt = next((label for label in holders if k + 1 < len(run) and run[k + 1] in self.every[label]), holders[0])
                start = [run[k - 1]] if k and run[k - 1] in self.every[nxt] else [] # Picking up where the last part left off
                out.append((nxt, start + [n]))

        parts = [(label, tuple(part)) for label, part in out if len(part) > 1]
        return parts if sum(len(part) for _, part in parts) >= .8 * len(run) else []