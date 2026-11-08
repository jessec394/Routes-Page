# The page: frontend/ and the logo and map art -> docs/
import hashlib
import html
import json
import re
import shutil
from pathlib import Path
from re import Match
from urllib.parse import unquote

from .paths import DATA, DOCS, FRONTEND, OUT_DATA, STATES, read_json

ART = ("logo.png", "map.avif") # Images from data/ the page uses
REF = r'(src|href)="((?:frontend|data)/[^"?#]+)"' # A local file the page loads

def copy(src: Path, dst: Path) -> None: # Only when it changed
    if not (dst.exists() and dst.read_bytes() == src.read_bytes()):
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)

def stamped(m: Match[str]) -> str: # Add ?v=<content hash> to a file reference
    f = DOCS / unquote(m[2]) # Clip paths are URL-encoded: "Columbus%20%28OH%29"
    if not f.is_file():
        print(f"  Warning: index.html uses {m[2]}, but it's missing" + (" (is it in your project folder?)" if m[2].startswith("frontend/") else ""))

    return m[0] if not f.is_file() or f.suffix == ".mp4" else f'{m[1]}="{m[2]}?v={hashlib.md5(f.read_bytes()).hexdigest()[:10]}"'

def build(clips: list[str] | None = None, ordered: int = 0, domain: str | None = None) -> None: # Copy the page's files and write docs/index.html
    if clips is None:
        q = read_json(OUT_DATA / "clips.json", {})
        clips, ordered = q.get("clips", []), q.get("ordered", 0)

    for p in sorted(FRONTEND.rglob("*")): # Its folders too: frontend/fonts
        if p.is_file() and p != FRONTEND / "index.html":
            to = DOCS / "frontend" / p.relative_to(FRONTEND)
            to.parent.mkdir(parents=True, exist_ok=True)
            copy(p, to)

    for p in sorted((DOCS / "frontend").rglob("*"), reverse=True) if (DOCS / "frontend").exists() else []: # Files removed from frontend/
        if p.is_file() and not (FRONTEND / p.relative_to(DOCS / "frontend")).exists():
            p.unlink()

    for name in ART:
        if (DATA / name).exists():
            copy(DATA / name, OUT_DATA / name)

    flags = {p.stem.upper(): p for p in sorted((STATES / "flags").glob("*.webp")) if len(p.stem) == 2} # State flags: data/states/flags/OH.webp
    for st, p in flags.items():
        copy(p, OUT_DATA / "flags" / f"{st}.webp")

    for p in (OUT_DATA / "flags").glob("*.webp") if (OUT_DATA / "flags").exists() else []: # Flags since removed
        if p.stem not in flags:
            p.unlink()

    page = (FRONTEND / "index.html").read_text(encoding="utf-8").replace("<body>", f'<body data-flags="{" ".join(flags)}">', 1) # Which states have one
    if clips: # The clip list in the page: the first clip starts loading straight away, in the size the screen needs
        small = ' data-small="1"' if read_json(OUT_DATA / "clips.json", {}).get("small") else ""
        page = re.sub(r'<video class="bg"[^>]*>', f'<video class="bg" muted playsinline preload="auto" data-clips="{html.escape(json.dumps(clips))}" data-ordered="{ordered}"{small} aria-hidden="true" tabindex="-1">', page, count=1) # Background footage: decorative, hidden from screen readers

    if domain: # Link previews for the site itself
        image = f'<meta property="og:image" content="https://{domain}/data/preview.jpg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:image" content="https://{domain}/data/preview.jpg">' if (OUT_DATA / "preview.jpg").exists() else ""
        about = "All Aboard Ohio's map of passenger rail: the Amtrak routes running today, and what the full buildout would bring."
        page = page.replace("</head>", f'    <meta name="description" content="{about}"><meta property="og:title" content="Proposed Routes · All Aboard Ohio"><meta property="og:description" content="{about}"><meta property="og:site_name" content="All Aboard Ohio"><meta property="og:type" content="website"><meta property="og:url" content="https://{domain}/"><meta name="twitter:card" content="summary_large_image">{image}\n</head>', 1)

    (DOCS / "index.html").write_text(re.sub(REF, stamped, page), encoding="utf-8")
    (DOCS / ".nojekyll").touch() # GitHub Pages: publish files as they are
    if domain:
        (DOCS / "CNAME").write_text(domain + "\n", encoding="utf-8") # GitHub Pages: serve the site at this address