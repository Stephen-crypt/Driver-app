"""Load Overture Maps places for Kigali into public.open_places.

Kigali businesses are thin on OpenStreetMap; Overture Places (Meta and
Microsoft listings, CDLA-Permissive 2.0) fills much of the gap. Rows with
confidence under 0.5 are left out - below that they are mostly closed or
misplaced. Re-run after each Overture release; rows are upserted by id.

  pip install duckdb
  NOVA_API_URL=https://<ref>.supabase.co NOVA_SERVICE_KEY=<service role key> \
    python scripts/import_overture_places.py [release]

  release defaults to 2026-09-23.1; set OVERTURE_PARQUET to load a file
  already downloaded instead of reading from Overture's bucket.
"""
import json
import os
import sys
import urllib.request

import duckdb

RELEASE = sys.argv[1] if len(sys.argv) > 1 else "2026-09-23.1"
API = os.environ["NOVA_API_URL"].rstrip("/")
KEY = os.environ["NOVA_SERVICE_KEY"]
# The City of Kigali, with a margin.
BOX = dict(min_lng=29.97, max_lng=30.25, min_lat=-2.08, max_lat=-1.86)
MIN_CONFIDENCE = 0.5

con = duckdb.connect()
for stmt in ["INSTALL spatial", "LOAD spatial", "INSTALL httpfs", "LOAD httpfs", "SET s3_region='us-west-2'"]:
    con.execute(stmt)

local = os.environ.get("OVERTURE_PARQUET")
if local:
    rows = con.execute(
        "select id, name, category, street, confidence, lng, lat from read_parquet(?) where confidence >= ? and name is not null",
        [local, MIN_CONFIDENCE],
    ).fetchall()
else:
    src = f"s3://overturemaps-us-west-2/release/{RELEASE}/theme=places/type=place/*"
    rows = con.execute(
        f"""select id, names.primary, basic_category, addresses[1].freeform, confidence, bbox.xmin, bbox.ymin
              from read_parquet('{src}', hive_partitioning=1)
             where bbox.xmin between ? and ? and bbox.ymin between ? and ?
               and confidence >= ? and names.primary is not null""",
        [BOX["min_lng"], BOX["max_lng"], BOX["min_lat"], BOX["max_lat"], MIN_CONFIDENCE],
    ).fetchall()

places = [
    {
        "id": pid,
        "name": name.strip(),
        "category": category,
        "street": (street or "").strip() or None,
        "confidence": round(float(conf), 3),
        "position": f"SRID=4326;POINT({lng} {lat})",
        "source": "overture",
    }
    for pid, name, category, street, conf, lng, lat in rows
    if name and name.strip()
]
print(f"{len(places)} places from Overture {RELEASE or local}")

for i in range(0, len(places), 500):
    batch = places[i : i + 500]
    req = urllib.request.Request(
        f"{API}/rest/v1/open_places?on_conflict=id",
        data=json.dumps(batch).encode(),
        method="POST",
        headers={
            "apikey": KEY,
            "Authorization": f"Bearer {KEY}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        print(f"  rows {i + 1}-{i + len(batch)}: HTTP {r.status}")
print("done")
