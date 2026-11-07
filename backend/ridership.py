# Ridership: Amtrak's figures from data/ridership, matched to the map's routes and stations -> docs/data/ridership.json
# Amtrak reports some routes together and some in parts, so each figure keeps its own name and the map routes it covers: never one route's figure set against another's combined one
# Stations by the Amtrak codes network.json gives them; routes by name, compared in names.py, with the schedules step's record of Amtrak's names for each map route's trains
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .names import aka, alike, codes_of, label_of, place_key, spelt, state_of, states_in, without_states
from .paths import DATA, NETWORK, OUT_DATA, Json, cache_get, cache_set, read_json, stamp, write_json
from .schedules import present

SRC = DATA / "ridership"
OUT = OUT_DATA / "ridership.json"

@dataclass
class Route: # A map route as Amtrak's figures can name it
    own: set[str] = field(default_factory=set) # Its name and network.json's other names for it
    theirs: set[str] = field(default_factory=set) # Amtrak's names for its trains
    stops: set[str] = field(default_factory=set) # As place keys
    ends: set[str] = field(default_factory=set) # Where its trains start or end
    states: set[str] = field(default_factory=set)

def station_name(name: str) -> str: # "...ADA Investment5 Anniston" -> "Anniston": the sheet's page text before a footnote mark gone
    return re.split(r"\d", name)[-1].strip()

def first_word(name: str) -> str: # "Empire West" -> "empire"
    return next(iter(re.findall(r"[a-z0-9]+", spelt(without_states(name)).removeprefix("amtrak "))), "")

def running(routes: list[Json], cities: list[Json], identity: Json, given: dict[str, set[str]]) -> dict[str, Route]: # The routes running today, all a figure can be: never one being planned
    state = {c["name"]: state_of(c) for c in cities}
    out: dict[str, Route] = {}
    for r in routes:
        if r.get("today") or present(r):
            k, stops = out.setdefault(label_of(r), Route({label_of(r)})), r.get("stops", [])
            k.stops |= {place_key(s) for s in stops}
            k.states |= {state[s] for s in stops if state.get(s)}
            k.ends |= {place_key(stops[0]), place_key(stops[-1])} if stops and not identity else set()

    for label, d in identity.get("routes", {}).items(): # Amtrak's names for its trains, and where they really start and end
        if label in out:
            out[label].theirs |= set(d["names"])
            out[label].ends |= {place_key(s) for s in d["ends"]}

    for name, labels in given.items():
        for label in labels & out.keys():
            out[label].own.add(name)

    return out

def route_matches(units: list[Json], routes: dict[str, Route], gone: set[str], warn: list[str]) -> None: # Each figure's map routes, in place: its name, Amtrak's names for the trains, the two stations it names, or its first word where the states say which
    stations = set().union(*(r.stops for r in routes.values()))
    def by_name(part: str) -> set[str]:
        return {l for l, r in routes.items() if any(alike(part, n) for n in r.own)} or {l for l, r in routes.items() if any(alike(part, n) for n in r.theirs)}

    def by_ends(part: str) -> set[str]: # "Washington-Richmond": the routes calling at both with trains starting or ending at one, not every train passing through
        a, _, b = part.replace("–", "-").partition("-")
        keys = {place_key(a), place_key(b)}
        return {l for l, r in routes.items() if b.strip() and keys <= r.stops and keys & r.ends}

    def by_word(part: str, states: set[str]) -> set[str]: # "Empire West NY": the one route in New York whose name starts the same, not the Empire Builder
        w = first_word(part)
        found = {l for l, r in routes.items() if len(w) >= 4 and r.states & states and any(first_word(n) == w for n in r.own | r.theirs)}
        return found if len(found) == 1 else set()

    for u in units:
        whole, states = without_states(u["name"]), set(states_in(u["name"]))
        named = [p.strip() for p in whole.split("/") if p.strip()]
        if len(named) == 2 and all(place_key(p) in stations for p in named) and not any(by_name(p) for p in named):
            named = ["-".join(named)] # "Washington/Roanoke": two stations, its ends

        found, missed = by_name(whole) if len(named) > 1 else set(), list[str]()
        for part in named:
            mine = by_name(part) or by_ends(part) or by_word(part, states)
            found |= mine
            missed += [] if mine else [part]

        u["labels"] = sorted(found)
        warn += [f'Ridership: "{part}" in Amtrak\'s "{u["name"]}" matches no route running today. If it is one, add "aka": ["{part}"] to that route in network.json' for part in missed if not any(place_key(part) in place_key(l) for l in found) and not any(alike(part, l) for l in gone)] # "Saluki" in "Illini-Saluki" is found; a route on the map that no longer runs needs no figure

def station_matches(found: list[Json], cities: list[Json], warn: list[str]) -> dict[str, int]: # Map station -> its riders, by the Amtrak code network.json gives it
    by_code = {code: c["name"] for c in cities for code in codes_of(c)}
    out: dict[str, int] = {}
    missed = []
    for s in found:
        if name := by_code.get(s["code"]):
            out[name] = out.get(name, 0) + s["riders"] # Two codes, one map station: both counted
        else:
            missed.append(f'{station_name(s["name"])} ({s["code"]}, {s["state"]})')

    if missed:
        warn.append(f"Ridership: {len(missed)} of Amtrak's stations have no station with their code on the map: {', '.join(missed[:8])}{' and more' if len(missed) > 8 else ''}. If one is on it, add its \"code\" to it in network.json")

    return out

def build() -> bool: # Write ridership.json when Amtrak's figures, the map or the schedule changed
    files = [SRC / "routes.json", SRC / "stations.json"]
    if not any(f.exists() for f in files):
        return False

    mark = stamp([*files, OUT_DATA / "map.json", OUT_DATA / "schedules.json", NETWORK, Path(__file__)])
    if OUT.exists() and cache_get("ridership").get("stamp") == mark:
        return False

    data, identity, warn = read_json(OUT_DATA / "map.json", {}), cache_get("identity"), list[str]()
    cities, given = data.get("cities", []), dict[str, set[str]]()
    for key, name in aka(read_json(NETWORK, {})):
        given.setdefault(name, set()).add(key)

    routes = running(data.get("routes", []), cities, identity, given)
    warn += [f'Ridership: network.json gives "{key}" the other name "{name}", but it\'s no route running today' for name, keys in given.items() for key in keys if key not in routes]
    by_route, by_station = read_json(SRC / "routes.json", {}), read_json(SRC / "stations.json", {})
    units: list[Json] = [dict(u) for u in by_route.get("routes", []) if u.get("riders")]
    route_matches(units, routes, {label_of(r) for r in data.get("routes", [])} - routes.keys(), warn)
    kept = [u for u in units if u["labels"]]
    labels: dict[str, list[int]] = {}
    for k, u in enumerate(kept):
        for l in u["labels"]:
            labels.setdefault(l, []).append(k)

    riders = station_matches(by_station.get("stations", []), cities, warn) if by_station else {}
    out: dict[str, Any] = {"routes": {"year": by_route.get("year", ""), "prior": by_route.get("prior", ""), "url": by_route.get("url", ""), "units": [{"name": without_states(u["name"]), **{k: u[k] for k in ("riders", "prior", "labels")}} for u in kept], "labels": dict(sorted(labels.items()))},
                           "stations": {"year": by_station.get("year", ""), "url": by_station.get("url", ""), "riders": riders}}
    write_json(OUT, out)
    for w in warn:
        print("  " + w)

    cache_set("ridership", {"stamp": mark, "warnings": warn}) # For publish.py
    print(f"  Ridership: {len(kept)} of {len(units)} Amtrak routes and {len(riders)} stations on the map")
    return True