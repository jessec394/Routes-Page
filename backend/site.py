"""The page: frontend/ and the logo and map art -> docs/, with version stamps so browsers never keep stale copies"""
import hashlib
import html
import json
import re
import shutil
from urllib.parse import quote, unquote

from .paths import DATA, DOCS, FRONTEND, OUT_DATA, listing, read_json

ART = ("logo.png", "map.avif")  # Images from data/ the page uses
REF = r'(src|href)="((?:frontend|data)/[^"?#]+)"'  # A local file the page loads

def copy(src, dst):  # Only when it changed
    if not (dst.exists() and dst.read_bytes() == src.read_bytes()):
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)

def stamped(m):  # Add ?v=<content hash> to a file reference
    f = DOCS / unquote(m[2])  # (Clip paths are URL-encoded: "Columbus%20%28OH%29")
    if not f.is_file():
        print(f"  Warning: index.html uses {m[2]}, but it's missing" + (" (is it in your project folder?)" if m[2].startswith("frontend/") else ""))
    return m[0] if not f.is_file() or f.suffix == ".mp4" else f'{m[1]}="{m[2]}?v={hashlib.md5(f.read_bytes()).hexdigest()[:10]}"'

def build(clips=None, ordered=0, domain=None):  # Copy the page's files and write docs/index.html (`clips` from clips.build; None reuses the last list)
    if clips is None:
        q = read_json(OUT_DATA / "clips.json", {})
        clips, ordered = q.get("clips", []), q.get("ordered", 0)
    for p in listing(FRONTEND, "*"):
        if p.is_file() and p.name != "index.html":
            copy(p, DOCS / "frontend" / p.name)
    for p in listing(DOCS / "frontend", "*"):  # Files removed from frontend/
        if not (FRONTEND / p.name).exists():
            p.unlink()
    for name in ART:
        if (DATA / name).exists():
            copy(DATA / name, OUT_DATA / name)
    page = (FRONTEND / "index.html").read_text(encoding="utf-8")
    if clips:  # The first clip loads with the page (a random one if there's no CLIP_ORDER)
        src = f' src="data/clips/{quote(clips[0])}"' if ordered else ""
        page = re.sub(r'<video class="bg"[^>]*>', f'<video class="bg"{src} muted playsinline preload="auto" data-clips="{html.escape(json.dumps(clips))}" data-ordered="{ordered}">', page, count=1)
    (DOCS / "index.html").write_text(re.sub(REF, stamped, page), encoding="utf-8")
    (DOCS / ".nojekyll").touch()  # GitHub Pages: publish files as they are
    if domain:
        (DOCS / "CNAME").write_text(domain + "\n", encoding="utf-8")  # GitHub Pages: serve the site at this address
