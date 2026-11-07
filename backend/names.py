# Names: one way to tell when two names mean the same station or route, wherever they're written: network.json, the schedules, Amtrak's figures
import re
import unicodedata
from collections.abc import Iterator
from typing import Any

from .paths import Json

STATE_NAMES = {k: v for k, v in (x.split(" ", 1) for x in "AL Alabama|AK Alaska|AZ Arizona|AR Arkansas|CA California|CO Colorado|CT Connecticut|DE Delaware|DC Washington, D.C.|FL Florida|GA Georgia|HI Hawaii|ID Idaho|IL Illinois|IN Indiana|IA Iowa|KS Kansas|KY Kentucky|LA Louisiana|ME Maine|MD Maryland|MA Massachusetts|MI Michigan|MN Minnesota|MS Mississippi|MO Missouri|MT Montana|NE Nebraska|NV Nevada|NH New Hampshire|NJ New Jersey|NM New Mexico|NY New York|NC North Carolina|ND North Dakota|OH Ohio|OK Oklahoma|OR Oregon|PA Pennsylvania|RI Rhode Island|SC South Carolina|SD South Dakota|TN Tennessee|TX Texas|UT Utah|VT Vermont|VA Virginia|WA Washington|WV West Virginia|WI Wisconsin|WY Wyoming|ON Ontario|QC Quebec|BC British Columbia".split("|"))} # "Ohio", not "OH"
CODES = "|".join(STATE_NAMES)
STATES_AFTER = re.compile(rf"\s*(?:\(({CODES})\)|\b((?:{CODES})(?:/(?:{CODES}))*))\s*$") # "(ME)" or "VT/MA/CT" after a name
FILLER = re.compile(r"\b(amtrak|station|union|depot|intermodal|transportation|transit|center|centre|terminal|multimodal|rail|train|street)\b") # Words station names add
SHORT = re.compile(r"\b(ft|mt|st|col|s|n|e|w)\.\s*|^(ft|mt|st)\s+") # "Ft. Madison", "St Paul"
WORDS = {"ft": "fort", "mt": "mount", "st": "saint", "col": "colonel", "s": "south", "n": "north", "e": "east", "w": "west"}

def plain(s: str) -> str: # "Montréal" / "Springﬁeld" -> "montreal" / "springfield": no accents or joined letters
    return "".join(ch for ch in unicodedata.normalize("NFKD", s) if not unicodedata.combining(ch)).lower()

def spelt(s: str) -> str: # Plain, abbreviations in full: "Ft. Madison" -> "fort madison"
    return SHORT.sub(lambda m: WORDS[m[1] or m[2]] + " ", plain(s))

def alnum(s: str) -> str:
    return "".join(ch for ch in s if ch.isalnum())

def bare(name: str) -> str: # "Springfield (IL)" -> "Springfield"
    return re.sub(r"\s*\([^)]*\)\s*$", "", name)

def states_in(name: str) -> list[str]: # "Vermonter VT/MA/CT" / "Auburn (CA)" -> its states
    m = STATES_AFTER.search(name)
    return (m[1] or m[2]).split("/") if m else []

def without_states(name: str) -> str: # "Vermonter VT/MA/CT" -> "Vermonter"
    return STATES_AFTER.sub("", name)

def state_of(c: Json) -> str: # A map station's state: given, else in its name
    return str(c.get("state") or "".join(states_in(str(c["name"])))).upper()

def name_key(name: str) -> str: # The whole name, brackets too: "St. Louis" ~ "Saint Louis", "Lake Shore Limited" -> "lakeshorelimited"
    return alnum(spelt(name))

def place_key(name: str) -> str: # A station, without what stations' names add: "Ardmore Amtrak Station" / "Toledo, OH" / "Ft. Madison" -> "ardmore" / "toledo" / "fortmadison"
    return alnum(FILLER.sub(" ", spelt(bare(name.split(",")[0]))))

def codes_of(c: Json) -> list[str]: # A station's Amtrak codes, as network.json gives them: "code": "DEN", or a list where Amtrak has two stops
    code = c.get("code")
    return [code] if isinstance(code, str) else [x for x in code if isinstance(x, str)] if isinstance(code, list) else []

def route_key(name: str) -> str: # "Amtrak Cascades WA/OR" -> "cascades"
    return alnum(plain(without_states(name))).removeprefix("amtrak")

def alike(a: str, b: str) -> bool: # Names of one route: "Keystone" ~ "Keystone Service", "Cascades" ~ "Amtrak Cascades", not "Hiawatha" ~ "North Coast Hiawatha"
    a, b = sorted((route_key(a), route_key(b)), key=len)
    return len(a) >= 5 and b.startswith(a)

def label_of(r: Json) -> str: # A route's name, or its group's for a branch
    return r.get("group") or r["name"]

def aka(node: Any, key: str = "") -> Iterator[tuple[str, str]]: # Every other name network.json gives a route or station, at any depth: "Empire Service": {"aka": ["Empire South"]}; "ridership" read the same
    if isinstance(node, dict):
        for field in ("aka", "ridership"):
            say = node.get(field)
            yield from ((key, n) for n in ([say] if isinstance(say, str) else say or []) if isinstance(n, str))

        for k, v in node.items():
            yield from aka(v, key if isinstance(v, list) else k)

    elif isinstance(node, list):
        for v in node:
            yield from aka(v, key)