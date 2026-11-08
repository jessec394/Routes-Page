from backend import clips, density, network, people, previews, ridership, schedules, site
from backend.server import Steps, serve

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

def refresh() -> None: # Map data and the page, on every page load
    network.build(density.summary())
    schedules.build()
    ridership.build()
    people.build()
    previews.build(DOMAIN)
    site.build(domain=DOMAIN)

def build() -> None: # Everything: new or changed clips and population maps, map data and the page
    step = Steps(8)
    step("Video clips")
    queue = clips.build(CLIP_ORDER)
    step("Population maps")
    summary = density.build()
    step("Routes and stations")
    network.build(summary)
    step("Train schedules")
    schedules.build()
    step("Ridership")
    ridership.build()
    step("People near stations")
    people.build()
    step("Link previews")
    previews.build(DOMAIN)
    step("Page")
    site.build(*queue, DOMAIN)

if __name__ == "__main__":
    serve(refresh, background=build)