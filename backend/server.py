# Local preview server for docs/, used by preview.py
import time
import traceback
import webbrowser
from collections.abc import Callable
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock, Thread
from typing import Any, ClassVar

from .paths import DOCS

Step = Callable[[], Any] # A build step

def attempt(step: Step) -> None: # Run a build step
    try:
        step()
    except Exception:
        print("Couldn't refresh the build (showing the last one):")
        traceback.print_exc()

class Steps: # Numbered progress lines: "[2/7] Population maps"
    def __init__(self, total: int) -> None:
        self.n, self.total = 0, total

    def __call__(self, name: str) -> None:
        self.n += 1
        print(f"[{self.n}/{self.total}] {name}", flush=True)

class Handler(SimpleHTTPRequestHandler):
    lock: ClassVar = Lock() # One build at a time

    def __init__(self, *args: Any, refresh: Step, **kw: Any) -> None: # Refresh: the page rebuild
        self.refresh = refresh # Set first: the base class answers the request as it starts
        super().__init__(*args, **kw)

    def log_message(self, format: str, *args: Any) -> None: # Quiet terminal
        pass

    def end_headers(self) -> None: # Always fetch fresh: the build changes underneath
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self) -> None: # Rebuild the page on each load, then serve the file
        if self.path.split("?")[0] in ("/", "/index.html"):
            with self.lock:
                attempt(self.refresh)

        if self.headers.get("Range") and self.path.split("?")[0].endswith(".mp4"):
            return self.ranged()

        super().do_GET()

    def ranged(self) -> None: # Byte ranges, so videos can seek and loop like on GitHub Pages
        try:
            data = Path(self.translate_path(self.path)).read_bytes()
        except OSError:
            return self.send_error(HTTPStatus.NOT_FOUND)

        start, _, end = self.headers["Range"].replace("bytes=", "").partition("-")
        start, end = int(start or 0), min(int(end) if end else len(data) - 1, len(data) - 1)
        if start >= len(data):
            self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
            self.send_header("Content-Range", f"bytes */{len(data)}")
            return self.end_headers()

        self.send_response(HTTPStatus.PARTIAL_CONTENT)
        for k, v in {"Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Content-Range": f"bytes {start}-{end}/{len(data)}", "Content-Length": end - start + 1}.items():
            self.send_header(k, str(v))

        self.end_headers()
        try:
            self.wfile.write(data[start:end + 1])
        except (BrokenPipeError, ConnectionResetError): # The browser moved on
            pass

def serve(refresh: Step, background: Step | None = None, port: int = 5000) -> None: # Build, then preview docs/ in the browser
    url = f"http://127.0.0.1:{port}"
    try:
        server = ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, directory=str(DOCS), refresh=refresh))
    except OSError:
        print(f"Port {port} is already in use, probably by another preview. Stop it (Ctrl+C in its terminal), then run this again.")
        return

    def run() -> None: # The browser opens once the build is done
        if background:
            start = time.time()
            print("Building the site: the first run after changes can take a few minutes")
            with Handler.lock: # Page loads wait for it rather than build twice
                attempt(background)

            took = round(time.time() - start)
            print(f"Built in {f'{took // 60}m {took % 60}s' if took >= 60 else f'{took}s'}")

        print(f"Previewing at {url} (Ctrl+C to stop)")
        webbrowser.open(url)

    Thread(target=run, daemon=True).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print()