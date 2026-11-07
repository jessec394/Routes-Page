# Where things live, plus small file helpers shared by the build steps
import json
from collections.abc import Iterable
from pathlib import Path
from typing import Any

Json = dict[str, Any] # A JSON object as read: routes, stations, cache entries

ROOT = Path(__file__).resolve().parent.parent
DATA, FRONTEND, DOCS = ROOT / "data", ROOT / "frontend", ROOT / "docs" # Sources, page code, published site
CLIPS, ROUTES, STATES, NETWORK = DATA / "clips", DATA / "routes", DATA / "states", DATA / "network.json"
CENSUS = STATES / "census" # Tract maps by state, tract points and populations
INTERCITY, REGIONAL = ROUTES / "intercity", ROUTES / "regional" # Amtrak routes' track
OUT_DATA = DOCS / "data" # Built data: map.json, clips.json, clips/, states/<ID>/density.json
CACHE = ROOT / ".preprocess.json" # What was built from what
ON_MAP = set("AL AR AZ CA CO CT DC DE FL GA IA ID IL IN KS KY LA MA MD ME MI MN MO MS MT NC ND NE NH NJ NM NV NY OH OK OR PA RI SC SD TN TX UT VA VT WA WI WV WY".split()) # The lower 48 and DC: no Alaska, Hawaii or territories

def listing(folder: Path, pattern: str) -> list[Path]: # Sorted matches, or none if the folder is missing
    return sorted(folder.glob(pattern)) if folder.exists() else []

def census_files(pattern: str) -> list[Path]: # Census files in data/states/census/, else where they used to live
    return [f for folder in (CENSUS, STATES, DATA) for f in listing(folder, pattern)]

def read_json(path: Path, default: Any = None) -> Any:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default

def write_json(path: Path, data: Any, pretty: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=1) if pretty else json.dumps(data, separators=(",", ":")), encoding="utf-8")

def cache_get(key: str) -> Json:
    return read_json(CACHE, {}).get(key, {})

def cache_set(key: str, value: Json) -> None:
    write_json(CACHE, {**read_json(CACHE, {}), key: value}, pretty=True)

def newest(paths: Iterable[Path]) -> float: # Latest change among existing files
    return max((p.stat().st_mtime for p in paths if p.exists()), default=0)

def stamp(paths: Iterable[Path]) -> str: # What a build was made from: each file and when it last changed
    return "|".join(f"{p}:{p.stat().st_mtime if p.exists() else 0}" for p in paths)