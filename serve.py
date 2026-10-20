from backend import clips, density, network, site
from backend.server import serve

DOMAIN = "routes.jebbes-trains.com"
CLIP_ORDER = [
    "Columbus (OH)/Bridge.mp4",
    "Cleveland (OH)/Snow.mp4",
    "Cincinnati (OH)/Union.mp4",
    "Dayton (OH)/Stop.mp4",
    "Toledo (OH)/Stop.mp4",
    "Pittsburgh (PA)/Bridge.mp4",
    "Indianapolis (IN)/Stadium.mp4",
    "Chicago (IL)/Sears.mp4",
]

def build():
    print("Clips")
    queue = clips.build(CLIP_ORDER)
    print("Population maps")
    summary = density.build()
    print("Map data")
    print("  map.json updated" if network.build(summary) else "  map.json up to date")
    site.build(*queue, DOMAIN)

if __name__ == "__main__":
    build()
    serve(lambda: (network.build(density.summary()), site.build()))