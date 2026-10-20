"""Where things live, plus small file helpers shared by the build steps"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA, FRONTEND, DOCS = ROOT / "data", ROOT / "frontend", ROOT / "docs"  # Sources, page code, published site
CLIPS, ROUTES, STATES, NETWORK = DATA / "clips", DATA / "routes", DATA / "states", DATA / "network.json"
OUT_DATA = DOCS / "data"  # Built data: map.json, clips.json, clips/, states/<ID>/density.json
CACHE = ROOT / ".preprocess.json"  # What was built from what (not published; name kept so nothing rebuilds)
ON_MAP = set("AL AR AZ CA CO CT DC DE FL GA IA ID IL IN KS KY LA MA MD ME MI MN MO MS MT NC ND NE NH NJ NM NV NY OH OK OR PA RI SC SD TN TX UT VA VT WA WI WV WY".split())  # The lower 48 and DC: no Alaska, Hawaii or territories

def listing(folder, pattern):  # Sorted matches, or none if the folder is missing
    return sorted(folder.glob(pattern)) if folder.exists() else []

def read_json(path, default=None):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default

def write_json(path, data, pretty=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=1) if pretty else json.dumps(data, separators=(",", ":")), encoding="utf-8")

def cache_get(key):
    return read_json(CACHE, {}).get(key, {})

def cache_set(key, value):
    write_json(CACHE, {**read_json(CACHE, {}), key: value}, pretty=True)

def newest(paths):  # Latest change among existing files (0 if none)
    return max((p.stat().st_mtime for p in paths if p.exists()), default=0)
