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

def refresh():
    network.build(density.summary())
    site.build(domain=DOMAIN)

def build():
    queue = clips.build(CLIP_ORDER)
    network.build(density.summary() or density.build())
    site.build(*queue, DOMAIN)

if __name__ == "__main__":
    serve(refresh, background=build)