# Zones from real places: design

Date: 2026-10-12. Status: design approved in conversation. This document is waiting for review.

## 1. Intent

**What the owner said:**
- Drawing a zone corner by corner is not an accurate way to mark a real place.
- Staff should be able to pick a place and have the zone be that place: a neighbourhood, a site, or a closed road.
- A zone drawn by hand should name itself after the area it covers.

**Assumptions the owner accepted:**
- The shapes and names come from data loaded into Nova's own database, not from a live service.
- The suggested name is only a suggestion. Staff can type over it, and a name they typed is never replaced.

**Done looks like:**
- On the Zones page, staff can make a zone in three ways: Pick a place, Close a road, or Draw by hand.
- Each way puts an accurate shape on the map and fills in the name.
- Saving the zone works exactly as it does today. Rider alerts and the control room read zones unchanged.

## 2. What staff see

"Draw a zone" becomes **New zone**. The form opens with a three-way switch: **Pick a place · Close a road · Draw by hand**. Below the switch come the name, kind and alert controls, as today. The checks from 2026-10-12 also stay as they are: the corner count, and the "Needs ..." line beside a grey Add zone button.

### Pick a place
- **Search box.** It searches after 2 characters, with a 300 ms pause. It shows up to 12 results, each with what the place is:
  - "Kimironko · sector, Gasabo"
  - "Kabeza · cell in Kanombe" (cell names repeat, so the sector is always shown)
  - "Nyabugogo Bus Station · bus station in Kimisagara"
  - "Simba Kicukiro · place in Kicukiro" (a point with no outline)
- **Picking a result** moves the map to it and draws its shape:
  - **Sector or cell:** its official border.
  - **Site with an outline:** the outline, plus a **Margin** slider from 0 to 300 m in 10 m steps, starting at 0.
  - **Place without an outline** (a landmark or an Overture place): a circle, with a **Size** slider for the radius from 50 m to 2 km, starting at 150 m.
- **Name:** the place's name.
- **No match:** "No place called “…”. Try a sector, a site, or draw it by hand."

### Close a road
- **Hint:** "Click where the closure starts and where it ends. Add a click at each junction."
- **Clicks:** each click snaps onto the nearest road within 40 m. Between two clicks on the same road segment, the strip follows the road's bends. Between clicks on different segments it runs straight.
- **Width** slider: 10 to 100 m in 5 m steps, starting at 30 m.
- **Undo click** removes the last click.
- **Name:** "<road name> closure", using the name most of the clicks landed on, e.g. "KG 11 Ave closure". An unnamed road gives "Road closure, <cell>".
- **A click with no road within 40 m** is not added. The hint shows: "No road within 40 m of that click."

### Draw by hand
- Clicking corners works as today.
- **Every corner can be dragged.** The shape redraws while you drag, with a mouse or a finger.
- **Name:** suggested from where the shape sits (section 5), and updated after each change once there are 3 or more corners.

### Name and editing
- **Name tracking:** the name field remembers whether staff have typed in it. Until they have, each new shape updates it. After they have, it is left alone.
- **Editing an existing zone:** its name counts as typed. "Redraw the shape" opens the same three-way switch.

### Credit
A line under the zone list on the Zones page reads: "Sector and cell borders: geoBoundaries, Open Data Rwanda (CC BY 4.0)." Roads and site outlines are OpenStreetMap data, which the map already credits.

## 3. Data

### Table `area_shapes`

| Column | Type | Notes |
|---|---|---|
| `id` | text pk | `gb:<shapeID>`, `osm:way/<n>`, `osm:relation/<n>` |
| `kind` | `area_kind` enum: sector, cell, site, road | |
| `name` | text | null only for unnamed roads |
| `parent` | text | the district for a sector, the sector for a cell, null otherwise |
| `detail` | text | for a site, a plain type such as "bus station", "market", "hospital", "stadium", "mall" or "airport"; for a road, its OSM `highway` value |
| `shape` | geography(Geometry, 4326) | Polygon for sectors and cells; the largest part only for sites; LineString for roads |
| `source` | text | `geoboundaries` or `osm` |
| `updated_at` | timestamptz | |

- **Indexes:** GiST on `shape`, and a trigram index on `lower(name)`.
- **Access:** RLS is on and nothing is granted to anon or authenticated. Staff reach it only through the functions in section 4, as with `open_places`.

### Loading: `scripts/import_area_shapes.py`
The script uses only Python's standard library and runs again safely: rows are upserted by `id`. Each run then removes rows from the same source that were not in the download, so a deleted OSM way goes away. It uses the same environment variables as the Overture importer, `NOVA_API_URL` and `NOVA_SERVICE_KEY`, and `--dry-run` prints the counts without writing.

**Sectors and cells (geoBoundaries)**
- Full-detail GeoJSON from geoBoundaries gbOpen RWA, pinned at commit `9469f09`.
- Sectors are ADM3 and cells are ADM4. Only those inside Gasabo, Kicukiro and Nyarugenge are kept, judged by a point on each shape. That gives 35 sectors and 161 cells.
- Each sector's parent is its district. Each cell's parent is the sector containing its point-on-surface, worked out in SQL after loading.

**Site outlines (OpenStreetMap, Overpass)**
- Named closed ways and multipolygon relations inside lng 29.97–30.25, lat -2.08 to -1.86.
- Included tags: `amenity`, `aeroway=aerodrome`, `shop=mall`, `leisure` (stadium, park, sports_centre), `landuse` (retail, commercial, industrial), `tourism`, `healthcare`, `office`, `public_transport=station`, and named `building`s. About 750 today.

**Roads (OpenStreetMap, Overpass)**
- Ways tagged `highway` as motorway, trunk, primary, secondary, tertiary, unclassified, residential, living_street, service or track, plus the `_link` versions, with or without a name. About 16,700 today.

**Writing the rows**
- Rows go to a service-role-only function, `import_area_shapes(p_rows jsonb)`, in batches of 500. Each row is `{id, kind, name, parent, detail, source, geojson}`.
- The function turns `geojson` into a shape with `st_geomfromgeojson`, keeps the largest part of a multi-part site, and upserts the row.
- `finish_area_import(p_source text, p_seen text[])` then deletes rows from that source whose `id` was not seen, and fills in the cells' parents.

## 4. Server functions

All four are `security definer` with `search_path = public`. Each starts with `require_staff(array['operations','safety'])`, the same check `staff_save_zone` uses.

**Corner lists.** Wherever a function returns corners, they are a jsonb array `[[lng, lat], ...]` with the closing point left off, which is the format `staff_save_zone` takes. Each shape is simplified with `st_simplifypreservetopology`: the tolerance starts at about 2 m and doubles until there are 200 corners or fewer and the shape is valid.

**`staff_find_places(p_query text, p_limit int default 12)`**
- Returns `(ref, kind, name, detail, lng, lat)`.
- `kind` is sector, cell, site, landmark or place. `ref` is the `area_shapes` id, `l:<landmark id>` or `o:<open place id>`. `lng`/`lat` is the centre for flying the map there.
- Matches by trigram similarity on the name (word similarity, as `search_open_places` does), with exact and prefix matches first. Equal scores are ordered sector, cell, site, landmark, place.
- `detail` is built as in section 2. A site's area and a point place's area come from the sector that contains it.
- A query shorter than 2 characters returns nothing.

**`staff_place_shape(p_ref text, p_metres int default null)`** returns corners.
- **Sector or cell:** its border. `p_metres` is ignored.
- **Site:** the outline grown by `p_metres` (0 to 300, default 0) with `st_buffer` on geography.
- **Landmark or open place:** a 48-sided circle of radius `p_metres` (50 to 2000, default 150).
- **Errors:** `place_not_found`, `metres_out_of_range`.

**`staff_road_strip(p_clicks jsonb, p_width int)`** returns `{corners, name}`.
- `p_clicks` is `[[lng, lat], ...]`, 2 to 20 clicks. `p_width` is 10 to 100.
- Each click snaps to the nearest road within 40 m, using `<->` and then `st_dwithin`. If none is in reach, it raises `no_road_near` with the click's position in the list, so the page can name the click.
- For two clicks in a row on the same road row (the same OSM way), the path between them is `st_linesubstring` of that road from one snapped point to the other. Otherwise it is a straight line.
- The joined path is buffered by `p_width / 2` metres on geography.
- The name is the commonest road name among the snapped clicks, plus " closure". With no named road, it is "Road closure, <cell of the path's midpoint>", or just "Road closure" outside Kigali.
- **Errors:** `strip_needs_clicks`, `width_out_of_range`, `no_road_near`.

**`staff_suggest_zone_name(p_points jsonb)`** returns text or null. It takes 3 to 200 corners, like `staff_save_zone`, and applies section 5's rule.

## 5. The naming rule (Draw by hand)

`cover(x)` is the share of the drawn shape's area that lies inside `x`. The first match wins:

1. A site with `cover` of at least 0.6, and whose own area is at least 25% of the shape's, gives the site's name. The size condition stops a big shape being named after one building inside it.
2. Otherwise, a cell with `cover` of at least 0.6 gives the cell's name.
3. Otherwise, a sector with `cover` of at least 0.6 gives the sector's name.
4. Otherwise, if two or more sectors overlap the shape, the two with the most overlap give "<A> and <B>", larger share first.
5. Otherwise, with one sector at less than 0.6, that sector's name.
6. Otherwise null: the shape is outside Kigali, and staff type a name.

The result is cut to 60 characters, the zone name limit.

## 6. Dashboard changes

- **`pages/Zones.tsx`:**
  - The three-way switch, the search box and its result list, and the Margin, Size and Width sliders.
  - A `nameTouched` flag on the draft.
  - Calls to the four functions:
    - search, debounced 300 ms;
    - shape and road strip, debounced 250 ms while a slider moves;
    - the name suggestion, debounced 400 ms after the corners change.
- **`components/LiveMap.tsx`:** draggable draft corners through a new `onCornerMove(index, lat, lng)` prop. Corners become `maplibregl.Marker` elements with `draggable: true` while the prop is set, and the draft source updates on `drag`. Road mode shows its clicks as corners too.
- The credit line, styled to match the page, in light and dark.
- **Phone layout:** the search results and sliders sit in the form card under the map, which needs nothing new.

## 7. Edge cases

- **Search fails because of the network or a server error:** the result list shows "Search didn't work. Try again.", and Draw by hand still works.
- **Switching ways:** a shape already made is cleared after a confirm: "Start again with <way>? The shape you have will be cleared."
- **A shape that can't be saved:** `staff_save_zone` still checks every zone, whether it is a valid shape, has at most 200 corners and is no bigger than 1,000 km². The functions above only produce shapes that pass, and the page still shows the save error if one comes back.
- **Running the import while staff are using the page:** each batch is upserted, so searches during the run see either the old row or the new one.

## 8. Testing

**pgTAP: `supabase/tests/053_zone_places.test.sql`**
- **Fixtures**, made inside the test without the import:
  - two side-by-side square sectors, A and B;
  - a cell inside A, and a site inside that cell;
  - a road with a bend;
  - a landmark.
- **Search:** finds the sector, the cell (with A as its detail), the site and the landmark; exact matches rank first; a query under 2 characters returns nothing.
- **Shapes:**
  - Every returned shape is valid and has 3 to 200 corners.
  - A site's area grows when the margin grows.
  - A circle's area is within 2% of πr².
  - A strip's area is within 15% of length × width.
  - A strip between two clicks on the bent road follows the bend: the bend's corner point is within width/2 of the strip.
- **Strip errors:** a click 100 m from any road raises `no_road_near`.
- **Naming:**
  - inside the cell gives the cell's name;
  - covering the site gives the site's name;
  - a large shape containing the site gives the sector's name, not the site's;
  - split between A and B gives "A and B";
  - outside everything gives null.
- **Access:** a `support` staff member is refused by all four functions, and anon can't read `area_shapes`.

**Browser checks** (Playwright probes, in light and dark, desktop and phone):
- Pick a place → sector: the shape appears, the name fills in, and the saved zone's area is close to the sector's.
- Pick a place → site: dragging the margin grows the shape.
- Pick a place → point place: the size slider changes the circle.
- Close a road: two clicks on a bent road follow it; the name is "<road> closure"; a click in a field shows the "No road within 40 m" message.
- Draw by hand: dragging a corner moves it; the name suggestion appears; a typed name survives later changes.

**Import:** `--dry-run` against the real downloads reports 35 sectors and 161 cells, and site and road counts within 20% of 750 and 16,700.

## 9. Rollout

1. Migration `0070_zone_places.sql`: the enum, the table, the six functions and the grants. Apply it locally, run the tests, then apply it on live.
2. Run the import locally, then on live, with the live service key in the environment only.
3. Redeploy the dashboard with `pnpm deploy:dashboard`.

The phone apps are unchanged, so no new APK is needed.

## 10. Not in this version

- Villages (imidugudu). They are too fine for zones, and few staff use their names.
- Editing an imported border corner by corner. To change one, redraw it by hand.
- Following a road across junctions without a click at each junction.
- Live shape or name lookups from Geoapify.
