"""Load the shapes zones are made from into public.area_shapes.

Kigali's sectors and cells come from geoBoundaries (Open Data Rwanda,
CC BY 4.0) - OpenStreetMap has only a third of the sectors. Site outlines
(the airport, markets, bus parks, malls) and roads come from OpenStreetMap
through Overpass (ODbL). Staff pick these on the Zones page; rider alerts
still run on the zones they save, never on these rows directly.

Re-run whenever the sources change: rows are upserted by id, and rows a
source no longer has are removed.

  NOVA_API_URL=https://<ref>.supabase.co NOVA_SERVICE_KEY=<service role key> \\
    python scripts/import_area_shapes.py [--dry-run] [--save rows.json | --from rows.json]

The public Overpass servers are often too busy to answer. --save keeps a
download that worked, and --from loads that file instead of downloading, so
one good download can fill the local database and the live one.

Standard library only.
"""
import datetime
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

GB = "https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/RWA"
# Public Overpass servers are often busy: try each in turn, several times.
OVERPASS = ("https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter")
# Some mirrors serve months-old data (kumi.systems answered with May-July 2026
# snapshots in October); loading one would undo every OSM edit since.
MAX_AGE = datetime.timedelta(days=7)
AGENT = "nova-zones-import/1.0 (+https://github.com/Stephen-crypt/Driver-app)"
KIGALI_DISTRICTS = ("Gasabo", "Kicukiro", "Nyarugenge")
# The City of Kigali, with a margin: (south, west, north, east) for Overpass.
BOX = "-2.08,29.97,-1.86,30.25"
BATCH = 500

SITES = f"""[out:json][timeout:180];
(
  way["name"]["amenity"]({BOX});
  way["name"]["aeroway"="aerodrome"]({BOX});
  way["name"]["shop"="mall"]({BOX});
  way["name"]["leisure"~"^(stadium|park|sports_centre)$"]({BOX});
  way["name"]["landuse"~"^(retail|commercial|industrial)$"]({BOX});
  way["name"]["tourism"]({BOX});
  way["name"]["healthcare"]({BOX});
  way["name"]["office"]({BOX});
  way["name"]["public_transport"="station"]({BOX});
  way["name"]["building"]({BOX});
  rel["name"]["type"="multipolygon"]["amenity"]({BOX});
  rel["name"]["type"="multipolygon"]["aeroway"="aerodrome"]({BOX});
  rel["name"]["type"="multipolygon"]["shop"="mall"]({BOX});
  rel["name"]["type"="multipolygon"]["leisure"]({BOX});
  rel["name"]["type"="multipolygon"]["landuse"~"^(retail|commercial|industrial)$"]({BOX});
  rel["name"]["type"="multipolygon"]["tourism"]({BOX});
  rel["name"]["type"="multipolygon"]["building"]({BOX});
);
out geom;"""

ROADS = """[out:json][timeout:180];
way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|track)(_link)?$"]({box});
out geom;"""


def quarters(box):
    """The box in four, so each roads query is small enough for a busy server."""
    s, w, n, e = map(float, box.split(","))
    ms, mw = (s + n) / 2, (w + e) / 2
    for a, b in ((s, ms), (ms, n)):
        for c, d in ((w, mw), (mw, e)):
            yield f"{a:.4f},{c:.4f},{b:.4f},{d:.4f}"

# What a site is, in the words staff use. First match wins.
SITE_TYPES = [
    ("aeroway", "aerodrome", "airport"),
    ("amenity", "bus_station", "bus station"),
    ("public_transport", "station", "bus station"),
    ("amenity", "marketplace", "market"),
    ("shop", "mall", "mall"),
    ("leisure", "stadium", "stadium"),
    ("amenity", "hospital", "hospital"),
    ("amenity", "clinic", "clinic"),
    ("amenity", "university", "university"),
    ("amenity", "college", "college"),
    ("amenity", "school", "school"),
    ("amenity", "place_of_worship", "place of worship"),
    ("amenity", "fuel", "fuel station"),
    ("amenity", "parking", "parking"),
    ("tourism", "hotel", "hotel"),
    ("leisure", "park", "park"),
    ("landuse", "industrial", "industrial area"),
]


def fetch(url, data=None):
    req = urllib.request.Request(url, data=data, headers={"User-Agent": AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.load(r)


def overpass(query):
    body = urllib.parse.urlencode({"data": query}).encode()
    last = None
    for attempt in range(5):
        for server in OVERPASS:
            try:
                answer = fetch(server, body)
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
                last = e
                print(f"  {server} did not answer ({e}); trying again", file=sys.stderr)
                continue
            # A query that runs out of time or memory still answers 200, with part of
            # the data and a remark. Loading it would delete everything it left out.
            if answer.get("remark"):
                last = answer["remark"]
                print(f"  {server} answered only in part ({last[:100]}); trying again", file=sys.stderr)
                continue
            as_of = answer.get("osm3s", {}).get("timestamp_osm_base", "")
            try:
                age = datetime.datetime.now(datetime.timezone.utc) - datetime.datetime.fromisoformat(as_of.replace("Z", "+00:00"))
            except ValueError:
                age = None
            if age is None or age > MAX_AGE:
                last = f"data as of {as_of or 'unknown'}"
                print(f"  {server} has old data ({last}); trying again", file=sys.stderr)
                continue
            print(f"  {server}: {len(answer['elements'])} elements, data as of {as_of}", file=sys.stderr)
            return answer["elements"]
        time.sleep(20 * (attempt + 1))
    raise SystemExit(f"Overpass would not answer: {last}")


def inside(pt, ring):
    x, y = pt
    hit = False
    for i in range(len(ring)):
        x1, y1 = ring[i]
        x2, y2 = ring[i - 1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            hit = not hit
    return hit


def outer_rings(geom):
    if geom["type"] == "Polygon":
        return [geom["coordinates"][0]]
    return [p[0] for p in geom["coordinates"]]


def ring_area(ring):
    return abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(ring, ring[1:]))) / 2


def rounded(coords):
    return [[round(x, 6), round(y, 6)] for x, y in coords]


def centre(ring):
    """The area centroid of a ring: inside any shape that is not badly bent."""
    a = cx = cy = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        cross = x1 * y2 - x2 * y1
        a += cross
        cx += (x1 + x2) * cross
        cy += (y1 + y2) * cross
    if a == 0:
        return ring[0]
    return cx / (3 * a), cy / (3 * a)


def district_of(geom, districts):
    """The Kigali district a shape's middle sits in, or None."""
    pt = centre(max(outer_rings(geom), key=ring_area))
    for name, rings in districts:
        if any(inside(pt, r) for r in rings):
            return name
    return None


def boundaries():
    adm2 = fetch(f"{GB}/ADM2/geoBoundaries-RWA-ADM2_simplified.geojson")["features"]
    districts = [(f["properties"]["shapeName"], outer_rings(f["geometry"]))
                 for f in adm2 if f["properties"]["shapeName"] in KIGALI_DISTRICTS]
    rows = []
    for level, kind in (("ADM3", "sector"), ("ADM4", "cell")):
        for f in fetch(f"{GB}/{level}/geoBoundaries-RWA-{level}.geojson")["features"]:
            district = district_of(f["geometry"], districts)
            if not district:
                continue
            g = f["geometry"]
            coords = [[rounded(r) for r in poly] for poly in g["coordinates"]] if g["type"] == "MultiPolygon" \
                else [rounded(r) for r in g["coordinates"]]
            rows.append({
                "id": "gb:" + f["properties"]["shapeID"],
                "kind": kind,
                "name": f["properties"]["shapeName"],
                "parent": district if kind == "sector" else None,
                "detail": None,
                "source": "geoboundaries",
                "geojson": json.dumps({"type": g["type"], "coordinates": coords}),
            })
    return rows


def site_type(tags):
    for key, value, words in SITE_TYPES:
        if tags.get(key) == value:
            return words
    for key in ("amenity", "shop", "leisure", "tourism", "healthcare", "office", "landuse"):
        if key in tags:
            return tags[key].replace("_", " ")
    return "building"


def sites():
    rows = []
    for e in overpass(SITES):
        if e["type"] == "way":
            rings = [[[p["lon"], p["lat"]] for p in e.get("geometry", [])]]
        else:
            rings = [[[p["lon"], p["lat"]] for p in m.get("geometry", [])]
                     for m in e.get("members", []) if m.get("role") == "outer" and m.get("type") == "way"]
        # Closed rings only; a relation whose outline is split across ways keeps its largest closed piece.
        rings = [r for r in rings if len(r) >= 4 and r[0] == r[-1]]
        if not rings:
            continue
        ring = max(rings, key=ring_area)
        rows.append({
            "id": f"osm:{e['type']}/{e['id']}",
            "kind": "site",
            "name": e["tags"]["name"],
            "parent": None,
            "detail": site_type(e["tags"]),
            "source": "osm",
            "geojson": json.dumps({"type": "Polygon", "coordinates": [rounded(ring)]}),
        })
    return rows


def roads():
    # A road crossing a quarter's edge comes back from both; keep it once.
    ways = {}
    for box in quarters(BOX):
        for e in overpass(ROADS.format(box=box)):
            ways[e["id"]] = e
    rows = []
    for e in ways.values():
        line = [[p["lon"], p["lat"]] for p in e.get("geometry", [])]
        if len(line) < 2:
            continue
        tags = e.get("tags", {})
        rows.append({
            "id": f"osm:way/{e['id']}",
            "kind": "road",
            "name": tags.get("name") or tags.get("ref"),
            "parent": None,
            "detail": tags.get("highway"),
            "source": "osm",
            "geojson": json.dumps({"type": "LineString", "coordinates": rounded(line)}),
        })
    return rows


def call(api, key, fn, body):
    req = urllib.request.Request(
        f"{api}/rest/v1/rpc/{fn}",
        data=json.dumps(body).encode(),
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.load(r)


def option(name):
    """The value after --name on the command line, or None."""
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv[:-1] else None


def main():
    dry = "--dry-run" in sys.argv
    saved = option("--from")
    if saved:
        with open(saved, encoding="utf-8") as f:
            data = json.load(f)
        gb, osm = data["geoboundaries"], data["osm"]
    else:
        gb = boundaries()
        osm = sites() + roads()
        if option("--save"):
            with open(option("--save"), "w", encoding="utf-8") as f:
                json.dump({"geoboundaries": gb, "osm": osm}, f)
    counts = {}
    for r in gb + osm:
        counts[r["kind"]] = counts.get(r["kind"], 0) + 1
    print("loaded:", ", ".join(f"{counts.get(k, 0)} {k}s" for k in ("sector", "cell", "site", "road")))
    if dry:
        return
    api = os.environ["NOVA_API_URL"].rstrip("/")
    key = os.environ["NOVA_SERVICE_KEY"]
    for source, rows in (("geoboundaries", gb), ("osm", osm)):
        for i in range(0, len(rows), BATCH):
            call(api, key, "import_area_shapes", {"p_rows": rows[i:i + BATCH]})
        gone = call(api, key, "finish_area_import", {"p_source": source, "p_seen": [r["id"] for r in rows]})
        print(f"{source}: {len(rows)} written, {gone} removed")


if __name__ == "__main__":
    main()
