"""Present-day train times: Amtrak's published schedule (GTFS, in data/gtfs/) -> docs/data/schedules.json, by map station.
Uses stops, routes, trips, stop_times, calendar (and calendar_dates if present), agency and feed_info; not shapes (the map draws its own track)."""
import csv
import io
import json
import zipfile
import re
import datetime as dt
import math
from zoneinfo import ZoneInfo

from .paths import DATA, OUT_DATA, cache_get, cache_set, listing, read_json, write_json

GTFS = DATA / "gtfs"
OUT = OUT_DATA / "schedules.json"
NIGHT = (22, 6)  # Overnight: from 10 PM until 6 AM, station time (the page uses this one definition everywhere; it may run past midnight)

def overnight_at(minutes):  # Is a station time (minutes after midnight) overnight
    a, b = NIGHT[0] * 60, NIGHT[1] * 60
    return a <= minutes < b if a < b else minutes >= a or minutes < b
NEAR_KM = 3  # A schedule stop this close to a map station is that station
NAMED_KM = 30  # ...or this close, if their names match (map coordinates can be rough)
PLAIN = re.compile(r"\b(amtrak|station|union|depot|intermodal|transportation|transit|center|centre|terminal|multimodal|rail|train|street)\b")  # Words station names add
COMMUTER = re.compile(r"\bcommuter\b", re.I)  # Amtrak's schedule files its partners' commuter trains (MARC, Shore Line East, CTrail) as "Commuter Rail"; the map is intercity
DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
SOURCE = {"name": "Amtrak", "via": "Mobility Database", "url": "https://mobilitydatabase.org/feeds/gtfs/mdb-11"}  # Credit shown with the times

class Feed:  # One schedule: a folder of GTFS files, or a .zip of them as downloaded (its files may sit in a folder inside)
    def __init__(self, path, inner=""):
        self.path, self.inner = path, inner
        self.name = "" if path == GTFS else path.relative_to(GTFS).with_suffix("").as_posix()  # (Keeps its ids apart from other schedules')

    def read(self, name):  # A file's text ("" if it's not there)
        if self.path.suffix.lower() == ".zip":
            with zipfile.ZipFile(self.path) as z:
                return z.read(self.inner + name).decode("utf-8-sig") if self.inner + name in z.namelist() else ""
        path = self.path / name
        return path.read_bytes().decode("utf-8-sig") if path.exists() else ""

def folders():  # Schedules: data/gtfs itself (Amtrak's), and any other in it, at any depth, unzipped or not (e.g. data/gtfs/san-joaquins, or the San Joaquins' .zip as downloaded); one of each
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
    seen, out = set(), []
    for feed_ in found:  # (A schedule both unzipped and still zipped: once)
        mark = hash(feed_.read("stops.txt") + feed_.read("agency.txt"))
        if mark not in seen:
            seen.add(mark)
            out.append(feed_)
    return out

def schedule_files():
    return [p for f in folders() for p in ([f.path] if f.path.suffix.lower() == ".zip" else listing(f.path, "*.txt"))]

def table(name, folder=None):  # A GTFS table as dicts ([] if it's not there)
    text = (folder or Feed(GTFS)).read(name)
    return [{k.strip(): (v or "").strip() for k, v in row.items() if k} for row in csv.DictReader(io.StringIO(text))] if text else []

def km(a, b):  # Great-circle distance between (lon, lat) points
    r = math.pi / 180
    h = math.sin((b[1] - a[1]) * r / 2) ** 2 + math.cos(a[1] * r) * math.cos(b[1] * r) * math.sin((b[0] - a[0]) * r / 2) ** 2
    return 12742 * math.asin(min(1, math.sqrt(h)))

def seconds(t):  # "25:10:00" -> seconds after the service day's start (may run past midnight)
    h, m, s = (int(x) for x in t.split(":"))
    return h * 3600 + m * 60 + s

def date(s):
    return dt.date(int(s[:4]), int(s[4:6]), int(s[6:8]))

def clock(minutes):  # 135 -> "2:15 AM"
    h, m = divmod(minutes, 60)
    return f"{(h % 12) or 12}:{m:02d} {'AM' if h < 12 else 'PM'}"

def nice_date(s):  # "20261025" -> "Oct 25, 2026"
    d = date(s)
    return f"{d:%b} {d.day}, {d.year}"

def place_key(name):  # "Ardmore Amtrak Station" / "Toledo, OH" / "Ardmore (PA)" -> "ardmore", for matching stations by name
    name = re.sub(r"\s*\([^)]*\)\s*$", "", name.split(",")[0].lower())
    return "".join(ch for ch in PLAIN.sub(" ", name) if ch.isalnum())

def fold(s):  # For matching names: "Amtrak Cascades" ~ "cascades"
    return "".join(ch for ch in s.lower() if ch.isalnum()).removeprefix("amtrak")

def days_text(days):  # {0, 2, 4} -> "Mon, Wed, Fri"; all seven -> "Daily"
    if len(days) == 7:
        return "Daily"
    if days == {0, 1, 2, 3, 4}:
        return "Weekdays"
    if days == {5, 6}:
        return "Weekends"
    return ", ".join(DAYS[d] for d in sorted(days))

_feed = {}

def feed():  # Every schedule's trains (read once per change of their files), their ids kept apart per schedule: rail routes, stops, trips (with their schedule's time zone), each trip's calls in order, service days, and whose schedules they are
    stamp = "|".join(f"{p}:{p.stat().st_mtime}" for p in schedule_files())
    if _feed.get("stamp") == stamp:
        return _feed
    rail, stops, trips, calls, calendar, extra, sources = {}, {}, {}, {}, {}, {}, []
    seen = set()  # Trains already read: where schedules overlap (a partner's schedule repeating trains in Amtrak's), each once
    for folder in folders():
        tag = folder.name + ":" if folder.name else ""
        agency = (table("agency.txt", folder) or [{}])[0]
        tz = agency.get("agency_timezone") or "America/New_York"  # Every time in a schedule is in its agency's zone (GTFS rule), whatever the station's
        info = (table("feed_info.txt", folder) or [{}])[0]
        own = {tag + r["route_id"]: r for r in table("routes.txt", folder) if r.get("route_type") == "2" and not COMMUTER.search(route_name(r))}  # Intercity trains only (not Thruway buses, nor the commuter trains Amtrak's schedule carries: MARC, Shore Line East...)
        rail.update(own)
        for s in table("stops.txt", folder):
            stops[tag + s["stop_id"]] = {**s, "parent_station": tag + s["parent_station"] if s.get("parent_station") else ""}
        before = len(trips)
        for t in table("trips.txt", folder):
            if tag + t.get("route_id", "") in own:
                trips[tag + t["trip_id"]] = {**t, "route_id": tag + t["route_id"], "service_id": tag + t["service_id"], "tz": tz, "feed": tag}
        for st in table("stop_times.txt", folder):
            tid = tag + st.get("trip_id", "")
            t = st.get("departure_time") or st.get("arrival_time")
            if tid in trips and t:
                calls.setdefault(tid, []).append((int(st.get("stop_sequence") or 0), tag + st["stop_id"], seconds(t), st.get("pickup_type", "0"), st.get("drop_off_type", "0")))
        try:  # (Times in UTC, to compare across schedules)
            shift = ZoneInfo(tz).utcoffset(dt.datetime(2026, 1, 15)).total_seconds()
        except Exception:  # (No time zone data on this computer)
            shift = 0
        marks = set()
        for tid in list(trips)[before:]:  # (Within one schedule, the same times on other days stay: they're other trains)
            seq = sorted(calls.get(tid, []))
            mark = tuple((round(float(stops[sid].get("stop_lat") or 0), 2), round(float(stops[sid].get("stop_lon") or 0), 2), round((secs - shift) / 60)) for _, sid, secs, *_ in seq if sid in stops)
            if mark in seen:
                del trips[tid]
                calls.pop(tid, None)
            else:
                marks.add(mark)
        seen |= marks
        mine = {tag + c["service_id"]: c for c in table("calendar.txt", folder)}
        calendar.update(mine)
        for e in table("calendar_dates.txt", folder):
            extra.setdefault(tag + e["service_id"], {})[e["date"]] = e.get("exception_type") == "1"
        first = info.get("feed_start_date") or min((c["start_date"] for c in mine.values()), default="")
        last = info.get("feed_end_date") or max((c["end_date"] for c in mine.values()), default="")
        if len(trips) == before:  # (Nothing of its own)
            continue
        try:  # Whose it is: as update_schedules.py noted it (the Mobility Database's name for its publisher), else the schedule's own say
            provider = json.loads(folder.read("source.json") or "{}").get("provider", "")
        except ValueError:
            provider = ""
        sources.append({"tag": tag, "name": provider or info.get("feed_publisher_name") or agency.get("agency_name") or folder.name, "from": first, "to": last, "version": info.get("feed_version", ""), "trains": len(trips) - before})
    for c in calls.values():
        c.sort()
    _feed.clear()
    _feed.update(stamp=stamp, rail=rail, stops=stops, trips=trips, calls=calls, calendar=calendar, extra=extra, sources=sources)
    return _feed

def stations_of(cities):  # Schedule stop -> map station (the nearest within NEAR_KM, else one of the same name within NAMED_KM)
    stops = feed()["stops"]
    station_of = {}
    keys = [(place_key(c["name"]), c) for c in cities]
    for sid, s in stops.items():
        try:
            p = (float(s["stop_lon"]), float(s["stop_lat"]))
        except (KeyError, ValueError):
            continue
        best = min(((km(p, (float(c["lon"]), float(c["lat"]))), c["name"]) for c in cities), default=(math.inf, None))
        key = place_key(s.get("stop_name", ""))
        named = min(((km(p, (float(c["lon"]), float(c["lat"]))), c["name"]) for k, c in keys if key and k and (k == key or k.startswith(key) or key.startswith(k))), default=(math.inf, None))
        if best[0] <= NEAR_KM:
            station_of[sid] = best[1]
        elif named[0] <= NAMED_KM:
            station_of[sid] = named[1]
    for sid, s in stops.items():  # (Platforms count as their station)
        parent = s.get("parent_station")
        if parent and sid not in station_of and parent in station_of:
            station_of[sid] = station_of[parent]
    return station_of

def route_name(route):  # Amtrak's name for a route
    return route.get("route_long_name") or route.get("route_short_name") or "Amtrak"

def stopping(seq, station_of):  # A trip's map stations, in order, where it stops (not where it passes through)
    return tuple(dict.fromkeys(station_of[sid] for _, sid, _, pickup, dropoff in seq if sid in station_of and not (pickup == "1" and dropoff == "1")))

def today_routes(cities, future, notes):  # Today's routes from the schedule: named after (and typed like) the network.json route each train matches, one branch per distinct run
    if not schedule_files():
        return []
    f, station_of = feed(), stations_of(cities)
    match, kinds = matcher(future), {}
    for r in future:
        kinds.setdefault(r.get("group") or r["name"], r.get("type"))
    where = {c["name"]: (float(c["lon"]), float(c["lat"])) for c in cities}
    runs = {}  # Route name -> its trains' station runs
    for tid, trip in f["trips"].items():
        run = stopping(f["calls"].get(tid, []), station_of)
        if len(run) < 2:
            continue
        theirs = route_name(f["rail"][trip["route_id"]])
        for label, part in match.pieces(theirs, run) or [(theirs, run)]:
            runs.setdefault(label, set()).add(part)
    building = {c["name"] for c in cities if str(c.get("type", "")).lower() == "future"}  # Stations being built: today's trains pass them (shown so on Present Day), stopping once they open
    lists = {}
    for r in future:
        lists.setdefault(r.get("group") or r["name"], []).append(r.get("stops", []))
    def passing(run, label):  # A run with the stations being built that it passes (between two stops it makes, as the route's network.json version lists them)
        run = list(run)
        for stops in lists.get(label, []):
            for k, n in enumerate(stops[1:-1], 1):
                if n in building and n not in run:
                    a, b = stops[k - 1], stops[k + 1]
                    for i in range(len(run) - 1):
                        if {run[i], run[i + 1]} == {a, b}:
                            run.insert(i + 1, n)
                            break
        return tuple(run)
    out = []
    for label, found in sorted(runs.items()):
        branches = [passing(run, label) for run in trunk_runs(found)]
        length = max(sum(km(where[a], where[b]) for a, b in zip(run, run[1:])) for run in branches)
        kind = kinds.get(label) or ("Long-Distance" if length > 1207 else "State-Supported")  # (Not a network.json route: Amtrak's own line, 750 miles)
        note = notes.get(label)
        note = note.get("status") if isinstance(note, dict) else note
        names = {}
        for run in branches:
            name = f"{bare(run[0])} - {bare(run[-1])}"
            names[name] = names.get(name, 0) + 1
            out.append({"name": name if names[name] == 1 else f"{name} ({names[name]})", "group": label, "type": kind, "status": f"Exists: {note}" if note else "Exists", "stops": list(run), "today": True})
    return out

def bare(name):  # "Lafayette (IN)" -> "Lafayette"
    return re.sub(r"\s*\([^)]*\)\s*$", "", name)

def trunk_runs(runs):  # A route's runs as branches: each pointing the same way, and none that only repeats part of another (expresses skipping stops, short turns)
    runs = sorted(set(runs), key=len, reverse=True)
    pos = {n: k for k, n in enumerate(runs[0])}
    turned = []
    for run in runs:
        shared = [pos[n] for n in run if n in pos]
        turned.append(run[::-1] if len(shared) > 1 and shared[0] > shared[-1] else run)
    keep = []
    for run in sorted(dict.fromkeys(turned), key=len, reverse=True):
        if not any(set(run) <= set(k) for k in keep):
            keep.append(run)
    return keep

def build():  # Write schedules.json when the schedule files or the map's stations changed; returns True if it did
    files = schedule_files()
    if not files:
        return False
    stamp = "|".join(f"{p}:{p.stat().st_mtime}" for p in files) + f"|{(OUT_DATA / 'map.json').stat().st_mtime if (OUT_DATA / 'map.json').exists() else 0}|{__import__('pathlib').Path(__file__).stat().st_mtime}"
    if OUT.exists() and cache_get("schedules").get("stamp") == stamp:
        return False
    try:
        ZoneInfo("America/Chicago")
    except Exception:
        print("  Schedules: skipped. This computer's Python has no time zone data: run  pip install tzdata  and start serve.py again")
        return False
    data = read_json(OUT_DATA / "map.json", {})
    cities = data.get("cities", [])
    f = feed()
    rail, stops, trips, calls = f["rail"], f["stops"], f["trips"], f["calls"]
    station_of = stations_of(cities)

    # A typical week: the coming Monday onward, kept inside the schedule's dates
    calendar, extra = f["calendar"], f["extra"]
    starts = [date(c["start_date"]) for c in calendar.values() if c.get("start_date")] or [dt.date.today()]
    ends = [date(c["end_date"]) for c in calendar.values() if c.get("end_date")] or [dt.date.today()]
    monday = max(dt.date.today(), min(starts))
    monday += dt.timedelta(days=(7 - monday.weekday()) % 7)
    if monday + dt.timedelta(days=6) > max(ends):
        monday = max(min(starts), max(ends) - dt.timedelta(days=6 + (max(ends) - dt.timedelta(days=6)).weekday()))
    week = [monday + dt.timedelta(days=k) for k in range(7)]

    def runs(service, day):  # Does a service run on this date
        key = day.strftime("%Y%m%d")
        if key in extra.get(service, {}):
            return extra[service][key]
        c = calendar.get(service)
        return bool(c) and c.get(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"][day.weekday()]) == "1" and date(c["start_date"]) <= day <= date(c["end_date"])

    match = matcher([r for r in data.get("routes", []) if not r.get("today")])
    stations = {}  # Station -> (route, local minutes) -> its days and directions
    joined, first, visits, used = {}, {}, {}, set()  # Trains: trips calling together (a branched train's sections, e.g. the Lake Shore Limited's New York and Boston cars, share its stops) are one; each trip's (station, route, day)
    def train(t):  # The train a trip is part of
        while joined.get(t, t) != t:
            t = joined[t] = joined.get(joined[t], joined[t])
        return t
    for tid, trip in trips.items():
        seq = sorted(calls.get(tid, []))
        if len(seq) < 2:
            continue
        end = lambda sid, said="": bare(station_of[sid]) if sid in station_of else said or (stops.get(sid, {}).get("stop_name") or "").split(",")[0]  # A trip's end as the map names it ("Quincy", not "Quincy Amtrak Station"); off the map, as the schedule says
        toward, origin = end(seq[-1][1], trip.get("trip_headsign")), end(seq[0][1])
        theirs = route_name(rail[trip["route_id"]])
        parts = match.pieces(theirs, stopping(seq, station_of))
        days_run, home_tz = [d for d in week if runs(trip["service_id"], d)], ZoneInfo(trip["tz"])
        for k, (_, sid, secs, pickup, dropoff) in enumerate(seq):
            station = station_of.get(sid)
            if not station or (pickup == "1" and dropoff == "1"):  # (Passes without stopping)
                continue
            tz = ZoneInfo(stops[sid].get("stop_timezone") or str(home_tz))
            heading = "" if k == len(seq) - 1 else toward  # (The last stop: an arrival)
            name = next((label for label, part in reversed(parts) if station in part), theirs)  # The map's name for it (Amtrak's schedule may still use an old one; a through train: the route it goes on with, where one hands over to the next)
            for d in days_run:
                at = (dt.datetime(d.year, d.month, d.day, 12, tzinfo=home_tz) - dt.timedelta(hours=12) + dt.timedelta(seconds=secs)).astimezone(tz) # (GTFS times count from noon minus 12 h, so they hold across clock changes)
                call = stations.setdefault(station, {}).setdefault((name, at.hour * 60 + at.minute), {"days": set(), "to": set(), "from": set()}) # One train per route, time and day: a branched train's sections (e.g. the Lake Shore Limited's New York and Boston cars) are one stop
                call["days"].add(at.weekday())
                key = (station, name, at.hour * 60 + at.minute, d)
                if key in first:
                    a, b = train(tid), train(first[key])
                    if a != b:
                        joined[a] = b
                else:
                    first[key] = tid
                visits.setdefault(tid, []).append((station, name, d))
                used.add(trip["feed"])
                call["to" if heading else "from"].add(heading or origin)

    per_route, per_station = {}, {}  # (Route, station) / station -> the (train, day)s calling there: each train once a day, however many sections
    for tid, seen in visits.items():
        t = train(tid)
        for station, name, d in seen:
            per_route.setdefault((name, station), set()).add((t, d))
            per_station.setdefault(station, set()).add((t, d))
    counts = {}
    for (name, _), v in per_route.items():
        counts.setdefault(name, []).append(len(v))
    lines = {name: sorted(c)[len(c) // 2] for name, c in counts.items()}  # A route's trains a week, both ways: at a typical station of its (the middle count: not where sections meet, e.g. the Lake Shore Limited's at Albany, nor a branch's end)
    out = {}
    for station, keyed in stations.items():
        by_route = {}
        weekly = overnight = 0
        for (route, minutes), call in sorted(keyed.items()):
            days, heading = call["days"], " / ".join(sorted(call["to"])) if call["to"] else "From " + " / ".join(sorted(call["from"]))
            by_route.setdefault(route, []).append({"to": heading, "time": clock(minutes), "min": minutes, "days": days_text(days), "n": len(days)})
            weekly += len(days)
            overnight += len(days) if overnight_at(minutes) else 0
        out[station] = {"weekly": len(per_station.get(station, ())) or weekly, "overnight": overnight, "routes": [{"name": r, "calls": c} for r, c in by_route.items()]}

    srcs = [x for x in f["sources"] if x["tag"] in used]  # (Credited if its trains are on the map)
    first, last = min((x["from"] for x in srcs if x["from"]), default=""), max((x["to"] for x in srcs if x["to"]), default="")
    names = list(dict.fromkeys(x["name"] for x in srcs))
    write_json(OUT, {"source": {**SOURCE, "name": " and ".join(names) if len(names) < 3 else ", ".join(names[:-1]) + ", and " + names[-1], "version": srcs[0]["version"] if srcs else "", "from": nice_date(first) if first else "", "to": nice_date(last) if last else "", "week": f"{monday:%b} {monday.day}, {monday.year}"},
                     "night": list(NIGHT), "stations": out, "routes": lines})
    cache_set("schedules", {"stamp": stamp})
    each = "; ".join(f"{x['name']}: {x['trains']}" for x in srcs)
    print(f"  Schedules: {len(trips)} trains ({each}), {len(out)} stations")
    return True

def present(r):  # A route running unchanged in network.json (not one made from the schedule): not a proposal, not suspended
    status = str(r.get("status", "")).lower()
    return not r.get("today") and status.startswith("exists") and "suspended" not in status

def matcher(routes):  # Amtrak's name and a train's stations -> the network.json route it is (or None)
    running, planned = {}, {}  # Route name -> every station its branches list: routes running unchanged; proposals
    for r in routes:
        if r.get("today") or "suspended" in str(r.get("status", "")).lower():
            continue
        (running if present(r) else planned).setdefault(r.get("group") or r["name"], set()).update(r.get("stops", []))
    memo = {}
    def fits(stations, ours, least):  # (Share of the train's stations on the route, share of the route's stations the train calls at, name), for routes holding at least `least` of them
        found = [(len(stations & st) / len(stations), len(stations & st) / len(st), label) for label, st in ours.items() if st]
        return [f for f in found if f[0] >= least]
    def match(name, run):  # By its stations, no list of renamings to keep: the route of the same name; else a running route holding most of them; else a proposal that is mostly this train (a renamed route, e.g. the San Joaquins as the Gold Runner)
        key = (name, run)
        if key not in memo:
            stations = set(run)
            if len(stations) < 2:
                memo[key] = None
            else:
                same = [f for f in fits(stations, {**planned, **running}, .6) if fold(f[2]) and (fold(f[2]) == fold(name) or fold(f[2]) in fold(name) or fold(name) in fold(f[2]))]
                close = [f for f in fits(stations, planned, .8) if f[1] >= .5]
                memo[key] = max(same or fits(stations, running, .6) or close, default=(0, 0, None))[2]  # (A short line beats a long one passing the same stations)
        return memo[key]
    def pieces(name, run):  # The routes a train is, each with its part of the run: one route, or a through train named for several (e.g. "Lincoln Service Missouri River Runner": Chicago to St. Louis, then on to Kansas City); [] if none
        whole = match(name, run)
        if whole:
            return [(whole, run)]
        key = ("pieces", name, run)
        if key not in memo:
            every = {**planned, **running}
            mine = [label for label, st in every.items() if fold(label) and fold(label) in fold(name) and len(set(run) & st) >= 2]
            out = []
            if len(mine) > 1:
                for k, n in enumerate(run):
                    holders = [label for label in mine if n in every[label]]
                    if out and out[-1][0] in holders:
                        out[-1][1].append(n)
                    elif holders:
                        nxt = next((label for label in holders if k + 1 < len(run) and run[k + 1] in every[label]), holders[0])
                        start = [run[k - 1]] if k and run[k - 1] in every[nxt] else []  # (Picking up where the last part left off)
                        out.append((nxt, start + [n]))
                out = [(label, tuple(part)) for label, part in out if len(part) > 1]
                if sum(len(part) for _, part in out) < .8 * len(run):
                    out = []
            memo[key] = out
        return memo[key]
    match.pieces = pieces
    return match
