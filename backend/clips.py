"""Background clips: data/clips/**/*.mp4 -> web-sized copies in docs/data/clips/, plus clips.json (play order)"""
import shutil
import subprocess
import time

from .paths import CLIPS, OUT_DATA, cache_get, cache_set, listing, write_json

ENCODE = "3: 1080p30 h264 main crf27 maxrate5M"  # Changing this re-encodes every clip
OUT = OUT_DATA / "clips"
FFMPEG = ["-an", "-vf", "scale=w='min(1920,iw)':h=-2", "-fpsmax", "30", "-c:v", "libx264", "-preset", "veryfast", "-profile:v", "main",
          "-crf", "27", "-maxrate", "5M", "-bufsize", "10M", "-g", "60", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-threads", "0"]  # 1080p at most, 30 fps, no audio, plays while loading

def clip_list():  # Source clips as paths inside data/clips/ ("Columbus (OH)/Bridge.mp4")
    return [p.relative_to(CLIPS).as_posix() for p in listing(CLIPS, "**/*.mp4") if not any(part.startswith(".") for part in p.relative_to(CLIPS).parts)]

def queue(names, order):  # Clips in `order` first, then the rest; returns (clips, how many were ordered)
    lookup, ordered = {n.lower(): n for n in names}, []
    for name in order:
        n = lookup.get(name.replace("\\", "/").strip("/").lower())
        if not n:
            print(f"  CLIP_ORDER: {name} not found in data/clips/, skipping it")
        elif n not in ordered:
            ordered.append(n)
    return ordered + [n for n in names if n not in ordered], len(ordered)

def encode(ffmpeg, src, dst):  # One clip; returns an error message, or None
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_name(dst.stem + ".part.mp4")
    result = subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-i", str(src), *FFMPEG, str(tmp)], capture_output=True, text=True)
    if result.returncode:
        tmp.unlink(missing_ok=True)
        return result.stderr.strip()[:200] or "ffmpeg failed"
    tmp.replace(dst)

def build(order):  # Encode new or changed clips, drop removed ones, write clips.json
    names, done = clip_list(), cache_get("clips")
    made = done.get("clips", {}) if done.get("encode") == ENCODE else {}  # Clip -> source timestamp it was made from
    made = {n: t for n, t in made.items() if n in names and (OUT / n).exists()}
    todo = [n for n in names if made.get(n) != (CLIPS / n).stat().st_mtime]
    ffmpeg = shutil.which("ffmpeg") if todo else None
    if todo and not ffmpeg:
        print("  ffmpeg was not found, so new clips can't be prepared.\n"
              "    Windows: run  winget install Gyan.FFmpeg  in a terminal, then fully restart VS Code so it picks up the new PATH.\n"
              "    macOS:   brew install ffmpeg")
    for k, n in enumerate(todo if ffmpeg else [], 1):
        start = time.time()
        print(f"  Encoding {n} ({k} of {len(todo)}) ...", end="", flush=True)
        error = encode(ffmpeg, CLIPS / n, OUT / n)
        if not error:
            made[n] = (CLIPS / n).stat().st_mtime
        print(f" failed: {error}" if error else f" {(OUT / n).stat().st_size / 1e6:.1f} MB, {time.time() - start:.0f}s")
    for f in listing(OUT, "**/*.mp4"):  # Removed clips and half-finished encodes
        if f.relative_to(OUT).as_posix() not in made:
            f.unlink()
    for d in sorted((p for p in listing(OUT, "**/*") if p.is_dir()), reverse=True):  # Folders left empty
        if not any(d.iterdir()):
            d.rmdir()
    cache_set("clips", {"encode": ENCODE, "clips": made})
    files, ordered = queue([n for n in names if n in made], order)
    write_json(OUT_DATA / "clips.json", {"clips": files, "ordered": ordered}, pretty=True)
    return files, ordered
