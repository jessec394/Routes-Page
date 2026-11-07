# Draw the train pictures the page uses from the 3D models in data/models -> frontend/trains/<car>-side.webp, and for cabs <car>-rear.webp (its other side, nose to the left, for the far end) and <car>-front.webp: flat views with see-through backgrounds
# The page couples side views into trains: they share one scale and the same rail line, so any cars line up. Only needed when the models change: the pictures are kept with the page
# Needs Playwright: pip install playwright, then python -m playwright install chromium. The models are drawn by three.js in a browser that's never shown, so the page itself loads no 3D
import base64
import functools
import http.server
import io
import sys
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from backend.paths import DATA, FRONTEND # noqa: E402

MODELS = DATA / "models"
OUT = FRONTEND / "trains"
CARS = {"charger": "Charger", "venture": "Venture"} # Picture name -> its model in data/models
CABS = ["charger"] # Cars drawn from their other side and nose-on too
HEIGHT = {"side": 160, "rear": 160, "front": 320} # Pixels tall: twice the most the page shows, for sharp screens
THREE = "https://cdn.jsdelivr.net/npm/three@0.170.0/" # three.js, fetched by the hidden browser
PAGE = """<!doctype html><meta charset="utf-8"><script type="importmap">{"imports": {"three": "%(three)sbuild/three.module.js", "three/addons/": "%(three)sexamples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const load = f => new GLTFLoader().loadAsync(f).then(g => g.scene);
window.heights = async files => Promise.all(files.map(async f => { const b = new THREE.Box3().setFromObject(await load(f)); return [b.min.y, b.max.y]; })); // Each car's bottom and top
window.draw = async (file, view, height, y0, y1) => { // One car seen square from the side, nose to the right, from its other side, nose to the left, or nose-on: y0 to y1 fills the picture's height
    const car = await load(file), scene = new THREE.Scene(), b = new THREE.Box3().setFromObject(car), mid = b.getCenter(new THREE.Vector3()), size = b.getSize(new THREE.Vector3());
    scene.add(car);
    const flat = view !== 'front', w = flat ? size.z : size.x, h = y1 - y0, y = (y0 + y1) / 2, canvas = document.createElement('canvas');
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.setClearColor(0x000000, 0);
    r.setSize(Math.round(2 * height * w / h), 2 * height, false); // Twice the size, scaled down after: smoother edges
    const cam = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, .1, 1000); // Flat: no perspective
    cam.position.set(view === 'side' ? b.min.x - 50 : view === 'rear' ? b.max.x + 50 : mid.x, y, flat ? mid.z : b.max.z + 50);
    cam.lookAt(mid.x, y, mid.z);
    r.render(scene, cam);
    return canvas.toDataURL('image/png');
};
window.ready = true;
</script>"""

class Quiet(http.server.SimpleHTTPRequestHandler): # Serves the drawing page without a line per request
    def log_message(self, format: str, *args: object) -> None:
        pass

def main() -> int:
    try:
        from PIL import Image
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("Needs Playwright and Pillow: run  pip install playwright pillow  then  python -m playwright install chromium")
        return 1

    missing = sorted(m for m in CARS.values() if not (MODELS / f"{m}.glb").exists())
    if missing:
        print(f"Missing in data/models: {', '.join(f'{m}.glb' for m in missing)}")
        return 1

    local = Path(sys.argv[1]) if len(sys.argv) > 1 else None # A three.js package folder to use instead of fetching it
    folder = Path(__file__).resolve().parent / "_render"
    folder.mkdir(exist_ok=True)
    (folder / "index.html").write_text(PAGE % {"three": "/three/" if local else THREE}, encoding="utf-8")
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(folder)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    OUT.mkdir(parents=True, exist_ok=True)
    try:
        with sync_playwright() as pw:
            try:
                browser = pw.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]) # Software drawing: the same on every computer
            except Exception as e:
                if "Executable doesn't exist" not in str(e):
                    raise

                print("Playwright's browser isn't downloaded yet: run  python -m playwright install chromium  once, then this again")
                return 1

            page = browser.new_page()
            page.route("**/models/*.glb", lambda route: route.fulfill(path=str(MODELS / route.request.url.rsplit("/", 1)[-1]), content_type="model/gltf-binary"))
            if local:
                page.route("**/three/**", lambda route: route.fulfill(path=str(local / route.request.url.split("/three/", 1)[1]), content_type="text/javascript"))

            page.goto(f"http://127.0.0.1:{server.server_address[1]}/index.html")
            page.wait_for_function("window.ready", timeout=120000)
            files = {name: f"models/{model}.glb" for name, model in CARS.items()}
            ys = page.evaluate("f => heights(f)", list(files.values()))
            y0, y1 = min(y[0] for y in ys), max(y[1] for y in ys) # Every side view the same scale and rail line
            jobs = [(name, "side", y0, y1) for name in CARS] + [(name, "rear", y0, y1) for name in CABS] + [(name, "front", *ys[list(CARS).index(name)]) for name in CABS]
            for name, view, lo, hi in jobs:
                url = page.evaluate("([f, v, h, a, b]) => draw(f, v, h, a, b)", [files[name], view, HEIGHT[view], lo, hi])
                img = Image.open(io.BytesIO(base64.b64decode(url.split(",", 1)[1]))).convert("RGBA")
                img = img.resize((round(img.width / 2), round(img.height / 2)), Image.Resampling.LANCZOS)
                box = img.getbbox() or (0, 0, img.width, img.height)
                img = img.crop((box[0], 0, box[2], img.height) if view != "front" else box) # Side views keep their full height, so cars line up
                path = OUT / f"{name}-{view}.webp"
                img.save(path, "WEBP", quality=88, method=6)
                print(f"  {path.relative_to(FRONTEND.parent).as_posix()}: {img.width} x {img.height}, {path.stat().st_size // 1024} KB")

            browser.close()
    finally:
        server.shutdown()
        for f in folder.iterdir():
            f.unlink()

        folder.rmdir()

    return 0

if __name__ == "__main__":
    sys.exit(main())