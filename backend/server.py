"""Local preview server for docs/ (what GitHub Pages will publish), used by serve.py"""
import traceback
import webbrowser
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock, Thread, Timer

from .paths import DOCS

def attempt(step):  # Run a build step; if it breaks, say what broke and carry on with the last build
    try:
        step()
    except Exception:
        print("Couldn't refresh the build (showing the last one):")
        traceback.print_exc()

class Handler(SimpleHTTPRequestHandler):
    refresh, lock = None, Lock()  # Page rebuild (set by serve); one at a time

    def log_message(self, *args):  # Quiet terminal
        pass

    def end_headers(self):  # Always fetch fresh: the build changes underneath
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self):  # Rebuild the page on each load, then serve the file
        if self.path.split("?")[0] in ("/", "/index.html") and self.refresh:
            with self.lock:
                attempt(self.refresh)
        if self.headers.get("Range") and self.path.split("?")[0].endswith(".mp4"):
            return self.ranged()
        super().do_GET()

    def ranged(self):  # Byte ranges, so videos can seek and loop like on GitHub Pages
        try:
            data = open(self.translate_path(self.path), "rb").read()
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
        except (BrokenPipeError, ConnectionResetError):  # The browser moved on
            pass

def serve(refresh, background=None, port=5000):  # Preview docs/ and open it in the browser (background: slow build steps, run alongside)
    Handler.refresh = staticmethod(refresh)
    if background:
        def run():  # (Page loads wait for it rather than build twice)
            with Handler.lock:
                attempt(background)
        Thread(target=run, daemon=True).start()
    url = f"http://127.0.0.1:{port}"
    try:
        server = ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, directory=str(DOCS)))
    except OSError:
        print(f"Port {port} is already in use, probably by another preview. Stop it (Ctrl+C in its terminal), then run this again.")
        return
    print(f"Previewing at {url} (Ctrl+C to stop)")
    Timer(1, webbrowser.open, [url]).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print()
