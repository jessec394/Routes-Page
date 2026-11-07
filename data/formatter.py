import json
import re
from collections import defaultdict
from pathlib import Path

path = Path(__file__).with_name("network.json")
text = path.read_text(encoding="utf-8")
data = json.loads(text)
key = "stations" if "stations" in data else "cities"
if not isinstance(data.get(key), dict):
    raise SystemExit(f'"{key}" isn\'t keyed by station name yet: run convert_cities.py first.')

start = text.index(f'"{key}"')
open_at, depth, i, in_str = text.index("{", start), 0, text.index("{", start), False
while True:
    c = text[i]
    if in_str:
        in_str = not (c == '"' and text[i - 1] != "\\")
    elif c == '"':
        in_str = True
    elif c in "[{":
        depth += 1
    elif c in "]}":
        depth -= 1
        if depth == 0:
            break
    i += 1

pairs = []
json.loads(text[open_at:i + 1], object_pairs_hook=lambda p: pairs.append(p) or dict(p))
groups = defaultdict(list)
for name, _ in pairs[-1]:
    groups[re.sub(r"\s+", " ", name).strip().casefold()].append(name)
clashes = [names for names in groups.values() if len(names) > 1]

places = defaultdict(list)
for name, station in data[key].items():
    lat, lon = station.get("coords") or (station.get("lat"), station.get("lon"))
    places[(round(float(lat), 5), round(float(lon), 5))].append(name)
shared = [(where, names) for where, names in places.items() if len(names) > 1]

def stop_lists(node, path):
    if isinstance(node, dict):
        if isinstance(node.get("stops"), list):
            yield path, node["stops"]
        for k, v in node.items():
            if k != "stops":
                yield from stop_lists(v, path + ([] if k == "branches" else [k]))
    elif isinstance(node, list):
        for n, v in enumerate(node):
            yield from stop_lists(v, path + [v.get("name", str(n)) if isinstance(v, dict) else str(n)])

missing = [(" > ".join(map(str, path)), stop) for path, stops in stop_lists(data.get("routes", {}), []) for stop in stops if stop not in data[key]]

if clashes or shared or missing:
    print("Problems found (nothing was changed):")
    for names in clashes:
        print("  Same name: " + ", ".join(f'"{n}"' for n in names))
    for (lat, lon), names in shared:
        print(f"  Same coordinates ({lat}, {lon}): " + ", ".join(f'"{n}"' for n in names))
    for route, stop in missing:
        print(f'  Undefined station "{stop}" in {route}')
    raise SystemExit(1)

indent = text[text.rfind("\n", 0, start) + 1:start]
lines = {json.loads(m[1]): m[2] for m in re.finditer(r'^\s*("(?:[^"\\]|\\.)*")\s*:\s*(\{.*?\})\s*,?\s*$', text[open_at + 1:i], re.M)}
names = sorted(data[key], key=lambda n: (n.casefold(), n))
entries = [f"{indent}    {json.dumps(n, ensure_ascii=False)}: {lines.get(n) or json.dumps(data[key][n], ensure_ascii=False)}" for n in names]
new = text[:open_at] + "{\n" + ",\n".join(entries) + f"\n{indent}}}" + text[i + 1:]

result = json.loads(new)
assert result == data, "Formatting check failed; nothing was written"
if new == text:
    print("Already tidy.")
else:
    path.write_text(new, encoding="utf-8")
    print(f"Sorted {len(names)} stations.")