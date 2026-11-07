# Background clips
import shutil
import subprocess
import time
from pathlib import Path

from .paths import CLIPS, OUT_DATA, cache_get, cache_set, listing, write_json

ENCODE = "3: 1080p30 h264 main crf27 maxrate5M" # Changing this re-encodes every clip
SMALL_ENCODE = "1: 720p30 h264 main crf30 maxrate1.5M" # Phones' copies: a third of the download
OUT, SMALL = OUT_DATA / "clips", OUT_DATA / "clips-small"
def ffmpeg_args(width: int, crf: int, rate: str, buffer: str, keyframes: int) -> list[str]: # No audio, 30 fps at most, plays while loading
    return ["-an", "-vf", f"scale=w='min({width},iw)':h=-2", "-fpsmax", "30", "-c:v", "libx264", "-preset", "veryfast", "-profile:v", "main", "-crf", str(crf),
            "-maxrate", rate, "-bufsize", buffer, "-g", str(keyframes), "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-threads", "0"]

FFMPEG = ffmpeg_args(1920, 27, "5M", "10M", 60) # 1080p at most
SMALL_FFMPEG = ffmpeg_args(1280, 30, "1500k", "3M", 30) # 720p: plays sooner on a phone's connection

def clip_list() -> list[str]: # Source clips as paths inside data/clips/
    return [p.relative_to(CLIPS).as_posix() for p in listing(CLIPS, "**/*.mp4") if not any(part.startswith(".") for part in p.relative_to(CLIPS).parts)]

def queue(names: list[str], order: list[str]) -> tuple[list[str], int]: # Clips in `order` first, then the rest
    lookup, ordered = {n.lower(): n for n in names}, list[str]()
    for name in order:
        n = lookup.get(name.replace("\\", "/").strip("/").lower())
        if not n:
            print(f"  CLIP_ORDER: {name} not found in data/clips/, skipping it")
        elif n not in ordered:
            ordered.append(n)

    return ordered + [n for n in names if n not in ordered], len(ordered)

def encode(ffmpeg: str, src: Path, dst: Path, args: list[str] = FFMPEG) -> str | None: # One clip, or why it failed
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_name(dst.stem + ".part.mp4")
    result = subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-i", str(src), *args, str(tmp)], capture_output=True, text=True)
    if result.returncode:
        tmp.unlink(missing_ok=True)
        return result.stderr.strip()[:200] or "ffmpeg failed"

    tmp.replace(dst)
    return None

def variant(names: list[str], key: str, encoding: str, out: Path, args: list[str], label: str = "") -> dict[str, float]: # Encode one size of every new or changed clip, and drop removed ones
    done = cache_get(key)
    made: dict[str, float] = done.get("clips", {}) if done.get("encode") == encoding else {} # Clip -> source timestamp it was made from
    made = {n: t for n, t in made.items() if n in names and (out / n).exists()}
    todo = [n for n in names if made.get(n) != (CLIPS / n).stat().st_mtime]
    ffmpeg = shutil.which("ffmpeg") if todo else None
    if todo and not ffmpeg and not label: # Said once, for the full-size clips
        print("  ffmpeg was not found, so new clips can't be prepared.\n"
              "    Windows: run  winget install Gyan.FFmpeg  in a terminal, then fully restart VS Code so it picks up the new PATH.\n"
              "    macOS:   brew install ffmpeg")

    for k, n in enumerate(todo, 1):
        if not ffmpeg:
            break

        start = time.time()
        print(f"  Encoding {n}{label} ({k} of {len(todo)}) ...", end="", flush=True)
        error = encode(ffmpeg, CLIPS / n, out / n, args)
        if not error:
            made[n] = (CLIPS / n).stat().st_mtime

        print(f" failed: {error}" if error else f" {(out / n).stat().st_size / 1e6:.1f} MB, {time.time() - start:.0f}s")

    for f in listing(out, "**/*.mp4"): # Removed clips and half-finished encodes
        if f.relative_to(out).as_posix() not in made:
            f.unlink()

    for d in sorted((p for p in listing(out, "**/*") if p.is_dir()), reverse=True): # Folders left empty
        if not any(d.iterdir()):
            d.rmdir()

    cache_set(key, {"encode": encoding, "clips": made})
    return made

def build(order: list[str]) -> tuple[list[str], int]: # Encode new or changed clips in both sizes, write clips.json
    names = clip_list()
    made = variant(names, "clips", ENCODE, OUT, FFMPEG)
    small = variant(names, "clips-small", SMALL_ENCODE, SMALL, SMALL_FFMPEG, " for phones")
    files, ordered = queue([n for n in names if n in made], order)
    write_json(OUT_DATA / "clips.json", {"clips": files, "ordered": ordered, "small": all(n in small for n in files)}, pretty=True)
    return files, ordered