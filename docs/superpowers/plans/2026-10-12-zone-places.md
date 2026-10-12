# Zones from Real Places Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff make a zone by picking a real place (a sector, a cell, a site, any searchable place), by clicking along a closed road, or by drawing by hand with draggable corners, and the zone names itself.

**Architecture:**
- **Data:** Kigali's sectors and cells (geoBoundaries), plus site outlines and roads (OpenStreetMap), are loaded once into a new `area_shapes` table by a rerunnable script.
- **Server:** four staff-only Postgres functions turn a search, a pick, road clicks or hand-drawn corners into a list of corners and a suggested name.
- **Page:** the Zones page offers three ways to make a shape. Saving still goes through the unchanged `staff_save_zone`, so rider alerts and the control room are untouched.

**Tech Stack:**
- Supabase Postgres with PostGIS and pg_trgm; pgTAP for database tests.
- Python 3 (standard library only) for the import.
- React and Vite for the dashboard, with MapLibre GL 5.24.
- Playwright (`playwright-core` with Chrome) for browser checks.

**Spec:** `docs/superpowers/specs/2026-10-12-zone-places-design.md`.

**One ruling against the spec:** `staff_road_strip` accepts **1** to 20 clicks, not 2 to 20.
- With one click it returns `{"corners": null, "clicks": [snapped], "name": <road name>}`.
- This lets the page snap the first click and refuse a click far from any road straight away, instead of only when the second click comes.
- `strip_needs_clicks` is raised for 0 clicks or more than 20.

**Already proven before this plan was written:**
- The migration and its pgTAP file below were run together locally in a rolled-back transaction: 32/32 pass.
- The import's `--dry-run` against the real downloads gave 35 sectors, 161 cells, 756 sites and 15,357 roads.
- Detailed sector borders of 771 to 2,010 corners trimmed to 155–188 corners. They stayed valid, and their area changed by under 0.1%.

## Global Constraints

- **Commits:** every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Files to leave alone:** never commit `supabase/config.toml`, which holds local demo OTP numbers, or anything under `reports/` or `research_notes/`.
- **Secrets:**
  - Never print or commit service keys.
  - Get the local service key with `npx supabase status -o env` and the live one with `npx supabase projects api-keys --project-ref iwlolxlaxotooqvfvuvy -o json`.
  - Read either one into an environment variable without echoing it.
- **Who may use it:** the zone functions require staff role `operations` or `safety` through `public.require_staff(array['operations','safety']::public.staff_role[])`. `admin` always passes.
- **Corner format:**
  - Server to page: `[[lng, lat], ...]`, with no closing point, 3 to 200 corners.
  - Inside the page: `[lat, lng]`.
  - `staff_save_zone` is not changed.
- **Fixed numbers:**

  | Setting | Values |
  |---|---|
  | Site margin | 0–300 m, steps of 10, start 0 |
  | Point circle radius | 50–2000 m, start 150, 48 corners |
  | Road strip width | 10–100 m, steps of 5, start 30 |
  | Snapping a click to a road | within 40 m |
  | Zone name | at most 60 characters |
  | Naming rule | 60% cover; a site also needs its own area ≥ 25% of the shape |

- **Copy, word for word:**
  - "Pick a place", "Close a road", "Draw by hand", "New zone"
  - "No place called “…”. Try a sector, a site, or draw it by hand."
  - "Search didn't work. Try again."
  - "No road within 40 m of that click."
  - "Click where the closure starts and where it ends."
  - "Add a click at each junction."
  - "Start again with “<way>”?" / "The shape you have will be cleared."
  - "<road> closure", "Road closure, <cell>"
  - "Sector and cell borders: geoBoundaries, Open Data Rwanda (CC BY 4.0)."
- **geoBoundaries:** pinned at commit `9469f09`, gbOpen RWA. ADM3 is sectors and ADM4 is cells; keep only Gasabo, Kicukiro and Nyarugenge.
- **Commands:**
  - Database: `npx supabase migration up`, `npx supabase test db [file]` and `npx supabase db push --linked`, all run from the repo root.
  - Don't run `expo lint`.
- **Local stack:** the dashboard runs at `http://localhost:5173` and signs in as `admin@nova.demo` / `NovaDemo-2026`. The database container is `supabase_db_driver_app`.
- **Browser checks:**
  - `PW=C:/Users/Stephen/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright-core`.
  - Scripts live in the session scratchpad, `$SCRATCH` = `C:/Users/Stephen/AppData/Local/Temp/claude/c--Users-Stephen-driver-app/0646d135-69c4-4f87-85fc-4990f7db99a7/scratchpad`.
  - In Git Bash, set `MSYS_NO_PATHCONV=1` before `docker exec ... /tmp/...` paths.

## Review Focus

These five inputs aren't exercised by the spec's own tests and are the most likely to bite someone using the page. Each has a test in the task that owns the code:

1. **Picking two places quickly while the first shape is still loading:** the zone must end up as the place picked last, with its name and its shape. A slow answer for the first pick must not overwrite it. Pinned in Task 4's browser check by delaying the first `staff_place_shape` response by 3 s.
2. **Redrawing an existing zone's shape:** its saved name must never be replaced by a suggested one. Pinned in Task 4's browser check with a zone inserted directly and removed afterwards.
3. **Saying no when asked "Start again with …?":** this must keep both the shape and the way that was selected. Pinned in Task 4's browser check.
4. **A hand-drawn shape whose corners cross:** saving must say why it was refused and save nothing. Pinned in Task 4's browser check with a bow-tie of four corners.
5. **Running the import a second time:** it must leave the same counts, remove nothing, and add no duplicates. Pinned in Task 2, Step 6.

---

### Task 1: Database: shapes table, import functions, zone functions

**Files:**
- Create: `supabase/migrations/0070_zone_places.sql`
- Test: `supabase/tests/053_zone_places.test.sql`

**Interfaces:**
- Consumes:
  - `public.require_staff(staff_role[])` (0042)
  - `public.landmarks(id uuid, name, sector, position geography)` (0005)
  - `public.open_places(id text, name, category, position geography)` (0062)
  - pg_trgm installed in schema `extensions` (0062)
- Produces (later tasks rely on these exact signatures):
  - `public.import_area_shapes(p_rows jsonb) returns integer`, service_role only. Each row is `{id, kind: 'sector'|'cell'|'site'|'road', name, parent, detail, source, geojson}`, where `geojson` is a GeoJSON geometry as a string.
  - `public.finish_area_import(p_source text, p_seen text[]) returns integer`: rows removed. It also sets each cell's `parent` to its sector.
  - `public.staff_find_places(p_query text, p_limit integer default 12) returns table (ref text, kind text, name text, detail text, lng double precision, lat double precision)`. `kind` is one of `sector|cell|site|landmark|place`. Refs are an `area_shapes.id`, `l:<landmark uuid>` or `o:<open place id>`.
  - `public.staff_place_shape(p_ref text, p_metres integer default null) returns jsonb`: corners `[[lng,lat],...]`.
  - `public.staff_road_strip(p_clicks jsonb, p_width integer) returns jsonb`: `{"corners": [[lng,lat],...] | null, "clicks": [[lng,lat],...], "name": text|null}`.
  - `public.staff_suggest_zone_name(p_points jsonb) returns text`, or null.
  - Error messages, all with errcode 22023: `place_not_found`, `metres_out_of_range`, `strip_needs_clicks`, `width_out_of_range`, `no_road_near` (its detail is the click's position in the list, from 1), plus the existing `zone_needs_points` and `zone_crosses_itself`.

- [ ] **Step 1: Write the failing test.** Create `supabase/tests/053_zone_places.test.sql` with exactly this content:

```sql
begin;
select plan(32);

-- Olive runs operations; Sam is in support.
insert into auth.users (instance_id, id, aud, role, email)
select '00000000-0000-0000-0000-000000000000', ('e5300000-0000-4000-8000-00000000000' || n)::uuid,
       'authenticated', 'authenticated', 'u' || n || '.e53@test.local'
  from generate_series(1, 2) n;
insert into public.staff_members (user_id, role, display_name, active) values
  ('e5300000-0000-4000-8000-000000000001', 'operations', 'Olive', true),
  ('e5300000-0000-4000-8000-000000000002', 'support', 'Sam', true);

-- A small made-up town far from Kigali, so loaded shapes never get in the way:
-- sectors Qwalpha and Qwbravo side by side (about 2.2 km square each), cell
-- Qwcharlie inside Qwalpha, Qwdelta Market inside the cell, a road with a
-- right-angle bend, an unnamed road through the cell, and a landmark.
-- ---- loading ---------------------------------------------------------------
select is(public.import_area_shapes(jsonb_build_array(
  jsonb_build_object('id', 't:A', 'kind', 'sector', 'name', 'Qwalpha', 'parent', 'Qwdistrict', 'source', 'test',
    'geojson', '{"type":"Polygon","coordinates":[[[20.00,-1.95],[20.02,-1.95],[20.02,-1.93],[20.00,-1.93],[20.00,-1.95]]]}'),
  jsonb_build_object('id', 't:B', 'kind', 'sector', 'name', 'Qwbravo', 'parent', 'Qwdistrict', 'source', 'test',
    'geojson', '{"type":"Polygon","coordinates":[[[20.02,-1.95],[20.04,-1.95],[20.04,-1.93],[20.02,-1.93],[20.02,-1.95]]]}'),
  jsonb_build_object('id', 't:C', 'kind', 'cell', 'name', 'Qwcharlie', 'source', 'test',
    'geojson', '{"type":"Polygon","coordinates":[[[20.005,-1.945],[20.015,-1.945],[20.015,-1.935],[20.005,-1.935],[20.005,-1.945]]]}'),
  jsonb_build_object('id', 't:S', 'kind', 'site', 'name', 'Qwdelta Market', 'detail', 'market', 'source', 'test',
    'geojson', '{"type":"MultiPolygon","coordinates":[[[[20.008,-1.941],[20.010,-1.941],[20.010,-1.939],[20.008,-1.939],[20.008,-1.941]]],[[[20.0,-1.9],[20.0001,-1.9],[20.0001,-1.8999],[20.0,-1.9]]]]}'),
  jsonb_build_object('id', 't:G', 'kind', 'site', 'name', 'Qwalpha Gardens', 'detail', 'park', 'source', 'test',
    'geojson', '{"type":"Polygon","coordinates":[[[20.016,-1.932],[20.017,-1.932],[20.017,-1.931],[20.016,-1.931],[20.016,-1.932]]]}'),
  jsonb_build_object('id', 't:R', 'kind', 'road', 'name', 'Qwroad 1 Ave', 'detail', 'primary', 'source', 'test',
    'geojson', '{"type":"LineString","coordinates":[[20.001,-1.949],[20.010,-1.949],[20.010,-1.931]]}'),
  jsonb_build_object('id', 't:U', 'kind', 'road', 'source', 'test',
    'geojson', '{"type":"LineString","coordinates":[[20.006,-1.943],[20.014,-1.943]]}'),
  jsonb_build_object('id', 't:X', 'kind', 'site', 'name', 'Qwgone Hall', 'source', 'test',
    'geojson', '{"type":"Polygon","coordinates":[[[20.03,-1.94],[20.031,-1.94],[20.031,-1.939],[20.03,-1.94]]]}')
)), 8, 'the import writes every row it is given');

select is((select geometrytype(shape::geometry) || ' ' || round(st_area(shape))::text from public.area_shapes where id = 't:S'),
  'POLYGON ' || round(st_area(st_geomfromtext('POLYGON((20.008 -1.941,20.010 -1.941,20.010 -1.939,20.008 -1.939,20.008 -1.941))', 4326)::geography))::text,
  'a site in several pieces keeps its largest piece');

select is(public.finish_area_import('test', array['t:A', 't:B', 't:C', 't:S', 't:G', 't:R', 't:U']), 1,
  'finishing an import removes the row the source no longer has');
select is((select parent from public.area_shapes where id = 't:C'), 'Qwalpha', 'a cell belongs to the sector its middle sits in');

insert into public.landmarks (name, sector, position) values ('Qwecho Plaza', 'Qwalpha', st_point(20.012, -1.937)::geography);

-- ---- who may use it ----------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"e5300000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok($$ select * from public.staff_find_places('qwcharlie') $$, '42501', 'not_permitted', 'support cannot search places for zones');
select throws_ok($$ select public.staff_place_shape('t:A') $$, '42501', 'not_permitted', 'or shape them');
select throws_ok($$ select public.staff_road_strip('[[20.003,-1.9492],[20.0102,-1.935]]', 30) $$, '42501', 'not_permitted', 'or close roads');
select throws_ok($$ select public.staff_suggest_zone_name('[[20.006,-1.944],[20.014,-1.944],[20.014,-1.936]]') $$, '42501', 'not_permitted', 'or name zones');
reset role;
set local role anon;
select throws_ok($$ select count(*) from public.area_shapes $$, '42501', null, 'the shapes are not readable without staff functions');
reset role;

-- Olive, from here on. Shapes are checked as the test's own role, which may
-- use the helpers the page cannot.
set local request.jwt.claims to '{"sub":"e5300000-0000-4000-8000-000000000001","role":"authenticated"}';

-- ---- finding a place ---------------------------------------------------------
select is((select ref || ' / ' || detail from public.staff_find_places('qwcharlie') limit 1), 't:C / cell in Qwalpha',
  'a cell is found, with the sector it is in');
select is((select detail from public.staff_find_places('qwdelta') limit 1), 'market in Qwalpha', 'a site says what it is and where');
select is((select kind from public.staff_find_places('qwecho') limit 1), 'landmark', 'Nova''s landmarks are found too');
select is((select ref from public.staff_find_places('qwalpha') limit 1), 't:A', 'an exact name comes before one that only starts with it');
select is((select count(*)::int from public.staff_find_places('q')), 0, 'one letter finds nothing');
select is((select count(*)::int from public.staff_find_places('qwroad')), 0, 'roads are not places to pick');

-- ---- shapes ------------------------------------------------------------------
select is(jsonb_array_length(public.staff_place_shape('t:A')), 4, 'a sector comes back as its corners, without the closing point');
select ok(st_area(public.zone_polygon(public.staff_place_shape('t:S', 50))::geography)
          > 1.5 * st_area(public.zone_polygon(public.staff_place_shape('t:S'))::geography),
  'a margin grows a site');
select ok(abs(st_area(public.zone_polygon(public.staff_place_shape((select 'l:' || id from public.landmarks where name = 'Qwecho Plaza'), 200))::geography)
              / (pi() * 200 * 200) - 1) < 0.02,
  'a point place becomes a circle of the size asked for');
select throws_ok($$ select public.staff_place_shape('t:S', 400) $$, '22023', 'metres_out_of_range', 'a margin over 300 m is refused');
select throws_ok($$ select public.staff_place_shape('t:nothing') $$, '22023', 'place_not_found', 'an unknown place is refused');

-- ---- closing a road ----------------------------------------------------------
select is(public.staff_road_strip('[[20.003,-1.9492]]', 30),
  '{"name": "Qwroad 1 Ave", "clicks": [[20.003000, -1.949000]], "corners": null}'::jsonb,
  'one click snaps onto the road and makes no shape yet');
select is(public.staff_road_strip('[[20.003,-1.9492],[20.0102,-1.935]]', 30) ->> 'name', 'Qwroad 1 Ave closure', 'the strip is named after its road');
select ok(abs(st_area(public.zone_polygon(public.staff_road_strip('[[20.003,-1.9492],[20.0102,-1.935]]', 30) -> 'corners')::geography)
              / (st_length(st_makeline(array[st_point(20.003, -1.949), st_point(20.010, -1.949), st_point(20.010, -1.935)])::geography) * 30) - 1) < 0.15,
  'the strip is as wide as asked, along the road''s length');
select ok(st_dwithin(public.zone_polygon(public.staff_road_strip('[[20.003,-1.9492],[20.0102,-1.935]]', 30) -> 'corners')::geography,
                     st_point(20.010, -1.949)::geography, 15),
  'between two clicks on the same road the strip follows the bend');
select is(public.staff_road_strip('[[20.007,-1.9431],[20.012,-1.9431]]', 20) ->> 'name', 'Road closure, Qwcharlie',
  'an unnamed road is named after its cell');
select throws_ok($$ select public.staff_road_strip('[[20.03,-1.94],[20.035,-1.94]]', 30) $$, '22023', 'no_road_near',
  'a click with no road within 40 m is refused');
select throws_ok($$ select public.staff_road_strip('[[20.003,-1.9492],[20.0102,-1.935]]', 5) $$, '22023', 'width_out_of_range',
  'a strip narrower than 10 m is refused');

-- ---- naming a shape drawn by hand ----------------------------------------------
select is(public.staff_suggest_zone_name('[[20.006,-1.944],[20.014,-1.944],[20.014,-1.936],[20.006,-1.936]]'), 'Qwcharlie',
  'a shape inside a cell takes the cell''s name');
select is(public.staff_suggest_zone_name('[[20.0078,-1.9412],[20.0102,-1.9412],[20.0102,-1.9388],[20.0078,-1.9388]]'), 'Qwdelta Market',
  'a shape drawn round a site takes the site''s name');
select is(public.staff_suggest_zone_name('[[20.001,-1.949],[20.019,-1.949],[20.019,-1.931],[20.001,-1.931]]'), 'Qwalpha',
  'a big shape is named after its sector, not a building inside it');
select is(public.staff_suggest_zone_name('[[20.012,-1.948],[20.030,-1.948],[20.030,-1.946],[20.012,-1.946]]'), 'Qwbravo and Qwalpha',
  'a shape across two sectors names both, the bigger share first');
select is(public.staff_suggest_zone_name('[[25.0,-1.0],[25.01,-1.0],[25.01,-0.99]]'), null, 'nowhere known suggests nothing');

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx supabase test db supabase/tests/053_zone_places.test.sql`
Expected: FAIL. The first assertion errors with `function public.import_area_shapes(jsonb) does not exist`.

- [ ] **Step 3: Write the migration.** Create `supabase/migrations/0070_zone_places.sql` with exactly this content:

```sql
-- Zones from real places (docs/superpowers/specs/2026-10-12-zone-places-design.md).
--
-- Staff make a zone by picking a place - a sector, a cell, a site with an
-- outline, or any place passenger search knows - by clicking along a closed
-- road, or by drawing it by hand, and the zone names itself. The shapes come
-- from data loaded into Nova once: Kigali's sectors and cells from
-- geoBoundaries (Open Data Rwanda, CC BY 4.0), and site outlines and roads
-- from OpenStreetMap (ODbL). Rows are loaded by scripts/import_area_shapes.py,
-- not by a migration: they are data, refreshed when the sources change.
--
-- Every function here hands the page a list of corners; saving still goes
-- through staff_save_zone, so zones, alerts and the control room are unchanged.

do $$ begin
  create type public.area_kind as enum ('sector', 'cell', 'site', 'road');
exception when duplicate_object then null; end $$;

create table if not exists public.area_shapes (
  id          text primary key,            -- gb:<shapeID>, osm:way/<n>, osm:relation/<n>
  kind        public.area_kind not null,
  name        text,                        -- null only for unnamed roads
  parent      text,                        -- a sector's district, a cell's sector
  detail      text,                        -- a site's type ("bus station"), a road's highway value
  shape       geography(Geometry, 4326) not null,
  source      text not null,               -- geoboundaries | osm
  updated_at  timestamptz not null default now(),
  check (kind = 'road' or name is not null)
);

create index if not exists area_shapes_shape on public.area_shapes using gist (shape);
create index if not exists area_shapes_kind on public.area_shapes (kind);
create index if not exists area_shapes_name_trgm
  on public.area_shapes using gin (lower(name) extensions.gin_trgm_ops) where name is not null;

alter table public.area_shapes enable row level security;
revoke all on public.area_shapes from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Corners for the page: the outer ring of the largest part, as [[lng, lat], ...]
-- without the closing point (the format staff_save_zone takes), simplified
-- until it has at most 200 corners and is still a valid shape.
-- ---------------------------------------------------------------------------
create or replace function public.zone_corners(p_shape geometry)
returns jsonb language plpgsql immutable set search_path = public, extensions as $$
declare
  v_part geometry := p_shape;
  v_poly geometry;
  v_tol  double precision := 0.00002;      -- about 2 m at Kigali's latitude
  v_ring geometry;
begin
  if p_shape is null or st_isempty(p_shape) then
    return null;
  end if;
  if geometrytype(v_part) = 'MULTIPOLYGON' then
    select d.geom into v_part from st_dump(p_shape) d order by st_area(d.geom) desc limit 1;
  end if;
  v_poly := st_makepolygon(st_exteriorring(v_part));
  while st_npoints(v_poly) > 201 or not st_isvalid(v_poly) loop
    v_poly := st_simplifypreservetopology(st_makepolygon(st_exteriorring(v_part)), v_tol);
    v_tol := v_tol * 2;
    exit when v_tol > 0.05;                -- about 5 km: nothing sensible is left to simplify
  end loop;
  v_ring := st_exteriorring(v_poly);
  return (
    select jsonb_agg(jsonb_build_array(round(st_x(p.geom)::numeric, 6), round(st_y(p.geom)::numeric, 6)) order by p.path[1])
      from st_dumppoints(v_ring) p
     where p.path[1] < st_npoints(v_ring)
  );
end;
$$;

-- The polygon a page's corners describe, checked the way staff_save_zone checks them.
create or replace function public.zone_polygon(p_points jsonb)
returns geometry language plpgsql immutable set search_path = public, extensions as $$
declare
  v_geom geometry;
begin
  if p_points is null or jsonb_typeof(p_points) <> 'array'
     or jsonb_array_length(p_points) < 3 or jsonb_array_length(p_points) > 200 then
    raise exception 'zone_needs_points' using errcode = '22023';
  end if;
  select st_makepolygon(st_addpoint(line, st_startpoint(line)))
    into v_geom
    from (select st_makeline(array_agg(st_setsrid(st_point((pt ->> 0)::float8, (pt ->> 1)::float8), 4326) order by ord)) as line
            from jsonb_array_elements(p_points) with ordinality as e(pt, ord)) l;
  if not (st_isvaliddetail(v_geom)).valid then
    raise exception 'zone_crosses_itself' using errcode = '22023';
  end if;
  return v_geom;
end;
$$;

-- The sector a point is in, for "bus station in Kimisagara".
create or replace function public.sector_at(p_point geography)
returns text language sql stable set search_path = public as $$
  select s.name from public.area_shapes s
   where s.kind = 'sector' and st_covers(s.shape, p_point)
   limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Loading (service role only): scripts/import_area_shapes.py sends rows in
-- batches, then names the ids it saw so rows gone from the source go too.
-- ---------------------------------------------------------------------------
create or replace function public.import_area_shapes(p_rows jsonb)
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare
  r      jsonb;
  v_geom geometry;
  v_n    integer := 0;
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    v_geom := st_setsrid(st_geomfromgeojson(r ->> 'geojson'), 4326);
    if r ->> 'kind' <> 'road' then
      -- Some outlines cross themselves: mend them, then keep the largest piece.
      select d.geom into v_geom from st_dump(st_makevalid(v_geom)) d
       where geometrytype(d.geom) = 'POLYGON' order by st_area(d.geom) desc limit 1;
    elsif geometrytype(v_geom) = 'MULTILINESTRING' then
      v_geom := st_linemerge(v_geom);
      if geometrytype(v_geom) = 'MULTILINESTRING' then
        select d.geom into v_geom from st_dump(v_geom) d order by st_length(d.geom) desc limit 1;
      end if;
    end if;
    continue when v_geom is null or st_isempty(v_geom);
    insert into public.area_shapes (id, kind, name, parent, detail, shape, source, updated_at)
    values (r ->> 'id', (r ->> 'kind')::public.area_kind, nullif(btrim(r ->> 'name'), ''), r ->> 'parent',
            r ->> 'detail', v_geom::geography, r ->> 'source', now())
    on conflict (id) do update set
      kind = excluded.kind, name = excluded.name, parent = coalesce(excluded.parent, area_shapes.parent),
      detail = excluded.detail, shape = excluded.shape, source = excluded.source, updated_at = now();
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

create or replace function public.finish_area_import(p_source text, p_seen text[])
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare
  v_gone integer;
begin
  delete from public.area_shapes where source = p_source and not (id = any (p_seen));
  get diagnostics v_gone = row_count;
  -- A cell belongs to the sector its middle sits in.
  update public.area_shapes c
     set parent = public.sector_at(st_pointonsurface(c.shape::geometry)::geography)
   where c.kind = 'cell';
  return v_gone;
end;
$$;

-- ---------------------------------------------------------------------------
-- Finding a place: sectors, cells and sites by name, and every point place
-- passenger search knows (Nova's landmarks, Overture places). Typos forgiven;
-- an exact name, then a name that starts with the words, comes first.
-- ---------------------------------------------------------------------------
create or replace function public.staff_find_places(p_query text, p_limit integer default 12)
returns table (ref text, kind text, name text, detail text, lng double precision, lat double precision)
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  q text := lower(btrim(coalesce(p_query, '')));
begin
  perform public.require_staff(array['operations', 'safety']::public.staff_role[]);
  if length(q) < 2 then
    return;
  end if;
  return query
  with found as (
    select a.id as ref, a.kind::text as kind, a.name, a.parent, a.detail, a.shape,
           st_pointonsurface(a.shape::geometry) as mid,
           case a.kind when 'sector' then 1 when 'cell' then 2 else 3 end as rank
      from public.area_shapes a
     where a.kind <> 'road'
       and (lower(a.name) like '%' || q || '%' or word_similarity(q, lower(a.name)) >= 0.5)
    union all
    select 'l:' || l.id, 'landmark', l.name, l.sector, null, null, l.position::geometry, 4
      from public.landmarks l
     where lower(l.name) like '%' || q || '%' or word_similarity(q, lower(l.name)) >= 0.5
    union all
    select 'o:' || o.id, 'place', o.name, null, o.category, null, o.position::geometry, 5
      from public.open_places o
     where length(q) >= 3
       and (lower(o.name) like '%' || q || '%' or word_similarity(q, lower(o.name)) >= 0.5)
  )
  select f.ref, f.kind, f.name,
         case f.kind
           when 'sector' then 'sector, ' || coalesce(f.parent, 'Kigali')
           when 'cell'   then 'cell in ' || coalesce(f.parent, 'Kigali')
           when 'site'   then coalesce(f.detail, 'site') || coalesce(' in ' || public.sector_at(f.mid::geography), '')
           else 'place' || coalesce(' in ' || coalesce(public.sector_at(f.mid::geography), f.parent), '')
         end,
         st_x(f.mid), st_y(f.mid)
    from found f
   order by (lower(f.name) = q) desc,
            (lower(f.name) like q || '%') desc,
            greatest(similarity(lower(f.name), q), word_similarity(q, lower(f.name))) desc,
            f.rank, f.name
   limit greatest(1, least(coalesce(p_limit, 12), 20));
end;
$$;

-- ---------------------------------------------------------------------------
-- The shape of a picked place: a sector's or cell's border, a site's outline
-- grown by a margin, or a circle around a point place.
-- ---------------------------------------------------------------------------
create or replace function public.staff_place_shape(p_ref text, p_metres integer default null)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_kind  public.area_kind;
  v_shape geography;
  v_point geography;
  v_m     integer;
begin
  perform public.require_staff(array['operations', 'safety']::public.staff_role[]);
  if p_ref like 'l:%' then
    select l.position into v_point from public.landmarks l where l.id::text = substr(p_ref, 3);
  elsif p_ref like 'o:%' then
    select o.position into v_point from public.open_places o where o.id = substr(p_ref, 3);
  else
    select a.kind, a.shape into v_kind, v_shape from public.area_shapes a where a.id = p_ref and a.kind <> 'road';
  end if;

  if v_point is not null then
    v_m := coalesce(p_metres, 150);
    if v_m < 50 or v_m > 2000 then
      raise exception 'metres_out_of_range' using errcode = '22023';
    end if;
    -- 12 segments a quarter: a 48-sided circle.
    return public.zone_corners(st_buffer(v_point, v_m, 'quad_segs=12')::geometry);
  end if;
  if v_shape is null then
    raise exception 'place_not_found' using errcode = '22023';
  end if;
  if v_kind = 'site' then
    v_m := coalesce(p_metres, 0);
    if v_m < 0 or v_m > 300 then
      raise exception 'metres_out_of_range' using errcode = '22023';
    end if;
    if v_m > 0 then
      v_shape := st_buffer(v_shape, v_m, 'quad_segs=4');
    end if;
  end if;
  return public.zone_corners(v_shape::geometry);
end;
$$;

-- ---------------------------------------------------------------------------
-- A closed road: each click snaps onto the nearest road within 40 m; between
-- two clicks on the same road the strip follows it, otherwise it runs straight.
-- One click is allowed so the page can show where it snapped straight away.
-- Returns {corners (null for one click), clicks (snapped), name}.
-- ---------------------------------------------------------------------------
create or replace function public.staff_road_strip(p_clicks jsonb, p_width integer)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare
  c        record;
  v_pt     geometry;
  v_road   record;
  v_prev_id   text;
  v_prev_frac double precision;
  v_pts    geometry[] := '{}';
  v_snaps  jsonb := '[]';
  v_names  text[] := '{}';
  v_seg    geometry;
  v_path   geometry;
  v_name   text;
  v_cell   text;
begin
  perform public.require_staff(array['operations', 'safety']::public.staff_role[]);
  if p_clicks is null or jsonb_typeof(p_clicks) <> 'array'
     or jsonb_array_length(p_clicks) < 1 or jsonb_array_length(p_clicks) > 20 then
    raise exception 'strip_needs_clicks' using errcode = '22023';
  end if;
  if p_width is null or p_width < 10 or p_width > 100 then
    raise exception 'width_out_of_range' using errcode = '22023';
  end if;

  for c in select e.pt, e.ord from jsonb_array_elements(p_clicks) with ordinality as e(pt, ord) loop
    v_pt := st_setsrid(st_point((c.pt ->> 0)::float8, (c.pt ->> 1)::float8), 4326);
    select r.id, r.name, r.shape::geometry as line,
           st_linelocatepoint(r.shape::geometry, v_pt) as frac
      into v_road
      from public.area_shapes r
     where r.kind = 'road' and st_dwithin(r.shape, v_pt::geography, 40)
     order by r.shape <-> v_pt::geography
     limit 1;
    if not found then
      raise exception 'no_road_near' using errcode = '22023', detail = c.ord::text;
    end if;
    v_pt := st_lineinterpolatepoint(v_road.line, v_road.frac);
    v_snaps := v_snaps || jsonb_build_array(jsonb_build_array(round(st_x(v_pt)::numeric, 6), round(st_y(v_pt)::numeric, 6)));
    if v_road.name is not null then
      v_names := v_names || v_road.name;
    end if;

    if v_prev_id is null then
      v_pts := array[v_pt];
    elsif v_prev_id = v_road.id then
      -- Along the road from the last click to this one, bends and all.
      v_seg := st_linesubstring(v_road.line, least(v_prev_frac, v_road.frac), greatest(v_prev_frac, v_road.frac));
      if v_prev_frac > v_road.frac then
        v_seg := st_reverse(v_seg);
      end if;
      v_pts := v_pts || array(select (st_dumppoints(v_seg)).geom offset 1);
    else
      v_pts := v_pts || v_pt;
    end if;
    v_prev_id := v_road.id;
    v_prev_frac := v_road.frac;
  end loop;

  select n into v_name from unnest(v_names) n group by n order by count(*) desc, n limit 1;
  if jsonb_array_length(p_clicks) = 1 then
    return jsonb_build_object('corners', null, 'clicks', v_snaps, 'name', v_name);
  end if;

  v_path := st_makeline(v_pts);
  if v_name is null then
    select s.name into v_cell from public.area_shapes s
     where s.kind = 'cell' and st_covers(s.shape, st_lineinterpolatepoint(v_path, 0.5)::geography) limit 1;
    v_name := 'Road closure' || coalesce(', ' || v_cell, '');
  else
    v_name := left(v_name, 52) || ' closure';
  end if;
  return jsonb_build_object(
    'corners', public.zone_corners(st_buffer(v_path::geography, p_width / 2.0, 'quad_segs=4')::geometry),
    'clicks', v_snaps,
    'name', v_name);
end;
$$;

-- ---------------------------------------------------------------------------
-- A name for a shape drawn by hand: the site, cell or sector holding most of
-- it, else the two sectors it spans most. Null outside Kigali.
-- ---------------------------------------------------------------------------
create or replace function public.staff_suggest_zone_name(p_points jsonb)
returns text language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_geom geometry;
  v_area double precision;
  v_name text;
begin
  perform public.require_staff(array['operations', 'safety']::public.staff_role[]);
  v_geom := public.zone_polygon(p_points);
  v_area := st_area(v_geom::geography);
  if v_area <= 0 then
    return null;
  end if;
  -- cover: the share of the drawn shape inside the place; own: the place's
  -- size against the shape's, so a big shape is not named after one building.
  with cov as (
    select a.kind, a.name,
           st_area(st_intersection(a.shape::geometry, v_geom)::geography) / v_area as cover,
           st_area(a.shape) / v_area as own
      from public.area_shapes a
     where a.kind in ('site', 'cell', 'sector') and st_intersects(a.shape, v_geom::geography)
  ),
  top_sectors as (
    select c.name, c.cover from cov c where c.kind = 'sector' and c.cover > 0 order by c.cover desc limit 2
  ),
  pick as (
    select 1 as step, c.name, c.cover from cov c where c.kind = 'site' and c.cover >= 0.6 and c.own >= 0.25
    union all
    select 2, c.name, c.cover from cov c where c.kind = 'cell' and c.cover >= 0.6
    union all
    select 3, c.name, c.cover from cov c where c.kind = 'sector' and c.cover >= 0.6
    union all
    select 4, string_agg(t.name, ' and ' order by t.cover desc), max(t.cover) from top_sectors t having count(*) > 0
  )
  select left(p.name, 60) into v_name from pick p order by p.step, p.cover desc limit 1;
  return v_name;
end;
$$;

revoke all on function public.zone_corners(geometry) from public, anon, authenticated;
revoke all on function public.zone_polygon(jsonb) from public, anon, authenticated;
revoke all on function public.sector_at(geography) from public, anon, authenticated;
revoke all on function public.import_area_shapes(jsonb) from public, anon, authenticated;
revoke all on function public.finish_area_import(text, text[]) from public, anon, authenticated;
grant execute on function public.import_area_shapes(jsonb) to service_role;
grant execute on function public.finish_area_import(text, text[]) to service_role;

revoke all on function public.staff_find_places(text, integer) from public, anon;
revoke all on function public.staff_place_shape(text, integer) from public, anon;
revoke all on function public.staff_road_strip(jsonb, integer) from public, anon;
revoke all on function public.staff_suggest_zone_name(jsonb) from public, anon;
grant execute on function public.staff_find_places(text, integer) to authenticated;
grant execute on function public.staff_place_shape(text, integer) to authenticated;
grant execute on function public.staff_road_strip(jsonb, integer) to authenticated;
grant execute on function public.staff_suggest_zone_name(jsonb) to authenticated;
```

- [ ] **Step 4: Apply it and run the new test**

Run: `npx supabase migration up` and then `npx supabase test db supabase/tests/053_zone_places.test.sql`
Expected: `1..32` and all 32 `ok`.

- [ ] **Step 5: Run the whole database suite**

Run: `npx supabase test db 2>&1 | tail -5`
Expected: `Result: PASS` and no failed files. The total grows by 32 over the previous run's 613.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0070_zone_places.sql supabase/tests/053_zone_places.test.sql
git commit -m "feat(db): zones from real places - area shapes, place search, road strips, names

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Import script, and loading Kigali locally

**Files:**
- Create: `scripts/import_area_shapes.py`

**Interfaces:**
- Consumes: `import_area_shapes(p_rows jsonb)` and `finish_area_import(p_source, p_seen)` from Task 1, called through PostgREST at `/rest/v1/rpc/<fn>` with the service key.
- Produces:
  - Local `public.area_shapes` filled with 35 sectors, 161 cells, about 750 sites and about 15,000–17,000 roads.
  - CLI: `python -I scripts/import_area_shapes.py [--dry-run]`, using the environment variables `NOVA_API_URL` and `NOVA_SERVICE_KEY`.
  - Output lines: `loaded: <n> sectors, <n> cells, <n> sites, <n> roads`, then for each source `<source>: <n> written, <n> removed`.

- [ ] **Step 1: Write the script.** Create `scripts/import_area_shapes.py` with exactly this content:

```python
"""Load the shapes zones are made from into public.area_shapes.

Kigali's sectors and cells come from geoBoundaries (Open Data Rwanda,
CC BY 4.0) - OpenStreetMap has only a third of the sectors. Site outlines
(the airport, markets, bus parks, malls) and roads come from OpenStreetMap
through Overpass (ODbL). Staff pick these on the Zones page; rider alerts
still run on the zones they save, never on these rows directly.

Re-run whenever the sources change: rows are upserted by id, and rows a
source no longer has are removed.

  NOVA_API_URL=https://<ref>.supabase.co NOVA_SERVICE_KEY=<service role key> \\
    python scripts/import_area_shapes.py [--dry-run]

Standard library only.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

GB = "https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/RWA"
# Public Overpass servers are often busy: try each in turn, a few times.
OVERPASS = ("https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter")
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

ROADS = f"""[out:json][timeout:180];
way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|track)(_link)?$"]({BOX});
out geom;"""

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
    for attempt in range(3):
        for server in OVERPASS:
            try:
                return fetch(server, body)["elements"]
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
                last = e
                print(f"  {server} did not answer ({e}); trying again", file=sys.stderr)
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
    rows = []
    for e in overpass(ROADS):
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


def main():
    dry = "--dry-run" in sys.argv
    gb = boundaries()
    osm = sites() + roads()
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
```

- [ ] **Step 2: Dry run against the real sources**

Run: `python -I scripts/import_area_shapes.py --dry-run`
Expected: `loaded: 35 sectors, 161 cells, <600-900> sites, <13000-18000> roads`.
- This takes 1 to 10 minutes. It downloads about 75 MB of geoBoundaries data and makes two Overpass queries.
- Lines such as `... did not answer (HTTP Error 504 ...); trying again` are normal.
- Any count outside those ranges means a broken source or filter. Stop and look before going on.

- [ ] **Step 3: Load it into the local database**

Run, in Git Bash, from the repo root:

```bash
eval "$(npx supabase status -o env | grep -E '^(API_URL|SERVICE_ROLE_KEY)=')"
NOVA_API_URL="$API_URL" NOVA_SERVICE_KEY="$SERVICE_ROLE_KEY" python -I scripts/import_area_shapes.py
```

Expected: the `loaded:` line, then `geoboundaries: 196 written, 0 removed` and `osm: <sites+roads> written, 0 removed`.

- [ ] **Step 4: Check every place gives a zone that can be saved**

Run:

```bash
MSYS_NO_PATHCONV=1 docker exec supabase_db_driver_app psql -U postgres -c "
do \$\$
declare r record; bad int := 0; n int := 0;
begin
  for r in select id, shape from public.area_shapes where kind in ('sector','cell','site') loop
    n := n + 1;
    begin
      if st_area(public.zone_polygon(public.zone_corners(r.shape::geometry))::geography) > 1000e6 then bad := bad + 1; end if;
    exception when others then
      bad := bad + 1;
      raise notice 'unusable shape: % (%)', r.id, sqlerrm;
    end;
  end loop;
  raise notice '% shapes checked, % unusable', n, bad;
end \$\$;"
```

Expected: `NOTICE:  <n> shapes checked, 0 unusable`. If any are unusable, the notice names them. Fix `zone_corners` or the import in Task 1's migration with a new pgTAP case, rather than skipping rows.

- [ ] **Step 5: Check search and parents on real data**

Run:

```bash
MSYS_NO_PATHCONV=1 docker exec supabase_db_driver_app psql -U postgres -tAc "
select parent, count(*) from public.area_shapes where kind = 'sector' group by parent order by parent;
select count(*) from public.area_shapes where kind = 'cell' and parent is null;"
```

Expected: `Gasabo|15`, `Kicukiro|10`, `Nyarugenge|10`, then `0` (every cell has its sector).

Then run (the admin's claims are needed for the staff function):

```bash
ADMIN=$(MSYS_NO_PATHCONV=1 docker exec supabase_db_driver_app psql -U postgres -tAc "select s.user_id from public.staff_members s join auth.users u on u.id = s.user_id where u.email = 'admin@nova.demo'")
MSYS_NO_PATHCONV=1 docker exec supabase_db_driver_app psql -U postgres -tAc "set request.jwt.claims to '{\"sub\":\"$ADMIN\",\"role\":\"authenticated\"}'; select ref, kind, name, detail from public.staff_find_places('kimironko') limit 4;"
```

Expected: the first row is `gb:...|sector|Kimironko|sector, Gasabo`. Kimironko Market (a site) or the Kimironko cell appear among the next rows.

- [ ] **Step 6: Run the import a second time (Review Focus 5)**

Run the two commands from Step 3 again, then:

```bash
MSYS_NO_PATHCONV=1 docker exec supabase_db_driver_app psql -U postgres -tAc "select kind, count(*), count(distinct id) from public.area_shapes group by kind order by kind"
```

Expected:
- The script prints `geoboundaries: 196 written, 0 removed` and `osm: <same number> written, 0 removed`.
- The query shows `count = count(distinct id)` for every kind, with the same counts as after Step 3.
- Small changes in the OSM counts are possible only if OpenStreetMap was edited between the two runs.

- [ ] **Step 7: Commit**

```bash
git add scripts/import_area_shapes.py
git commit -m "feat: import Kigali's sectors, cells, site outlines and roads for zones

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Dashboard groundwork: data helpers, error wording, map dots that drag, framing

**Files:**
- Create: `apps/dashboard/src/lib/zonePlaces.ts`
- Modify: `apps/dashboard/src/lib/supabase.ts` (the `WORDS` table, after the `zone_too_large` line)
- Modify: `apps/dashboard/src/components/LiveMap.tsx`
- Modify: `apps/dashboard/src/styles.css` (after the `.draw-hint strong` rule)

**Interfaces:**
- Consumes: the Task 1 functions, through `rpc<T>(fn, args)` from `lib/supabase.ts`. `rpc` throws `Error(explain(message))`.
- Produces:
  - `lib/zonePlaces.ts` exports:
    - `type LatLng = [number, number]` (lat, lng)
    - `type PlaceKind`, `interface FoundPlace {ref, kind, name, detail, lng, lat}`
    - `findPlaces(query): Promise<FoundPlace[]>`
    - `placeShape(ref, metres|null): Promise<LatLng[]>`
    - `interface RoadStrip {corners: LatLng[]; clicks: LatLng[]; name: string|null}`
    - `roadStrip(clicks, width): Promise<RoadStrip>`
    - `suggestName(corners): Promise<string|null>`
    - `interface SizeRange {label, min, max, step, start}`
    - `SIZE: Record<PlaceKind, SizeRange|null>`
    - `ROAD_WIDTH = {min: 10, max: 100, step: 5, start: 30}`
    - `metres(m): string`
  - New `LiveMap` props:
    - `draftDots?: readonly [number, number][]`: the dots to show. The default is `draft`'s corners.
    - `onCornerMove?: (index, lat, lng) => void`: while set, the dots can be dragged.
    - `frame?: {key, ring} | null`: fits the map to the ring once per key.
  - In dev builds only, `window.__novaMap` is set to the MapLibre map, for browser checks.
  - The CSS class `.draft-dot` (and `.draft-dot.movable`).

- [ ] **Step 1: Create `apps/dashboard/src/lib/zonePlaces.ts`** with exactly this content:

```ts
import { rpc } from "./supabase";

/** [lat, lng]: how the Zones page and LiveMap hold corners. The server speaks [lng, lat]. */
export type LatLng = [number, number];
type LngLat = [number, number];

const toPage = (pts: readonly LngLat[] | null): LatLng[] => (pts ?? []).map(([lng, lat]) => [lat, lng]);
const toServer = (pts: readonly LatLng[]): LngLat[] => pts.map(([lat, lng]) => [lng, lat]);

export type PlaceKind = "sector" | "cell" | "site" | "landmark" | "place";

export interface FoundPlace {
  readonly ref: string;
  readonly kind: PlaceKind;
  readonly name: string;
  readonly detail: string;
  readonly lng: number;
  readonly lat: number;
}

/** Sectors, cells, sites and point places whose names match, best first. */
export const findPlaces = (query: string) => rpc<FoundPlace[]>("staff_find_places", { p_query: query });

/** A picked place's shape: a border, a site grown by a margin, or a circle. */
export const placeShape = async (ref: string, size: number | null): Promise<LatLng[]> =>
  toPage(await rpc<LngLat[] | null>("staff_place_shape", { p_ref: ref, p_metres: size }));

export interface RoadStrip {
  /** Empty until there are two clicks. */
  readonly corners: LatLng[];
  /** The clicks, snapped onto their roads. */
  readonly clicks: LatLng[];
  readonly name: string | null;
}

export const roadStrip = async (clicks: readonly LatLng[], width: number): Promise<RoadStrip> => {
  const r = await rpc<{ corners: LngLat[] | null; clicks: LngLat[]; name: string | null }>("staff_road_strip", {
    p_clicks: toServer(clicks),
    p_width: width,
  });
  return { corners: toPage(r.corners), clicks: toPage(r.clicks), name: r.name };
};

/** A name for a shape drawn by hand, from the site, cell or sector it sits in. */
export const suggestName = (corners: readonly LatLng[]) => rpc<string | null>("staff_suggest_zone_name", { p_points: toServer(corners) });

export interface SizeRange {
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly start: number;
}

/** The slider each kind of place gets: a site's margin, a point's circle; borders are fixed. */
export const SIZE: Record<PlaceKind, SizeRange | null> = {
  sector: null,
  cell: null,
  site: { label: "Margin", min: 0, max: 300, step: 10, start: 0 },
  landmark: { label: "Size", min: 50, max: 2000, step: 50, start: 150 },
  place: { label: "Size", min: 50, max: 2000, step: 50, start: 150 },
};

export const ROAD_WIDTH = { min: 10, max: 100, step: 5, start: 30 } as const;

/** 150 -> "150 m", 1200 -> "1.2 km". */
export const metres = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(m % 1000 === 0 ? 0 : 1)} km` : `${m} m`);
```

- [ ] **Step 2: Add the error wording.** In `apps/dashboard/src/lib/supabase.ts`, replace

```ts
  zone_too_large: "That zone is bigger than Kigali - check the corners.",
```

with

```ts
  zone_too_large: "That zone is bigger than Kigali - check the corners.",
  place_not_found: "That place is no longer in the list. Search for it again.",
  metres_out_of_range: "That size is out of range.",
  strip_needs_clicks: "Click where the closure starts and where it ends.",
  width_out_of_range: "The strip must be 10 to 100 m wide.",
  no_road_near: "No road within 40 m of that click.",
```

- [ ] **Step 3: LiveMap props.** In `apps/dashboard/src/components/LiveMap.tsx`, replace

```tsx
  draft = null,
  onMapClick,
}: {
  readonly points: readonly MapPoint[];
  readonly lines?: readonly MapLine[];
  readonly focus?: { lat: number; lng: number; key: string } | null;
  readonly zones?: readonly MapZone[];
  /** A shape being drawn, corner by corner. */
  readonly draft?: readonly [number, number][] | null;
  readonly onMapClick?: (lat: number, lng: number) => void;
}) {
```

with

```tsx
  draft = null,
  draftDots,
  onCornerMove,
  frame = null,
  onMapClick,
}: {
  readonly points: readonly MapPoint[];
  readonly lines?: readonly MapLine[];
  readonly focus?: { lat: number; lng: number; key: string } | null;
  readonly zones?: readonly MapZone[];
  /** A shape being drawn, as [lat, lng] corners. */
  readonly draft?: readonly [number, number][] | null;
  /** The dots shown on it: its corners (the default), a road's clicks, or none. */
  readonly draftDots?: readonly [number, number][];
  /** While set, the dots can be dragged; called as one moves. */
  readonly onCornerMove?: (index: number, lat: number, lng: number) => void;
  /** Fit the map to this ring, once per key. */
  readonly frame?: { readonly key: string; readonly ring: readonly [number, number][] } | null;
  readonly onMapClick?: (lat: number, lng: number) => void;
}) {
```

- [ ] **Step 4: LiveMap refs.** Replace

```tsx
  const zonesRef = useRef(zones);
  zonesRef.current = zones;
```

with

```tsx
  const zonesRef = useRef(zones);
  zonesRef.current = zones;
  const moveRef = useRef(onCornerMove);
  moveRef.current = onCornerMove;
  const dots = useRef<maplibregl.Marker[]>([]);
```

- [ ] **Step 5: Corners become markers, not a circle layer.** Delete this block from the `load` handler:

```tsx
        m.addLayer({
          id: "draft-corners",
          type: "circle",
          source: "draft",
          filter: ["==", ["geometry-type"], "Point"],
          paint: { "circle-radius": 5, "circle-color": "#fff", "circle-stroke-color": accent, "circle-stroke-width": 2 },
        });
```

- [ ] **Step 6: A click on a dot is not a map click.** Replace

```tsx
      m.on("click", (e) => {
        // A zone under the click takes it; drawing a new zone only gets clicks
        // that land outside the existing ones.
```

with

```tsx
      m.on("click", (e) => {
        // A tap on a corner dot, or the end of dragging one, is not a new corner.
        if ((e.originalEvent.target as HTMLElement | null)?.closest?.(".draft-dot")) return;
        // A zone under the click takes it; drawing a new zone only gets clicks
        // that land outside the existing ones.
```

- [ ] **Step 7: The dev-only hook, and resetting dots with the map.** Replace

```tsx
      map.current = m;
    });
    return () => {
      gone = true;
      map.current?.remove();
      map.current = null;
      markers.current.clear();
      setLoaded(false);
    };
```

with

```tsx
      map.current = m;
      // Browser checks drive the map directly; never in a production build.
      if (import.meta.env.DEV) (window as unknown as { __novaMap?: maplibregl.Map }).__novaMap = m;
    });
    return () => {
      gone = true;
      map.current?.remove();
      map.current = null;
      markers.current.clear();
      dots.current = [];
      setLoaded(false);
    };
```

- [ ] **Step 8: The draft layer draws only the shape, and the dots and framing get their own effects.** Replace

```tsx
    const pts = draft ?? [];
    const corners: Feature[] = pts.map(([lat, lng]) => ({
      type: "Feature",
      properties: {},
      geometry: { type: "Point", coordinates: [lng, lat] },
    }));
    const shape: Feature[] =
```

with

```tsx
    const pts = draft ?? [];
    const shape: Feature[] =
```

and replace

```tsx
    (m.getSource("draft") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: [...shape, ...corners] });
  }, [draft, loaded]);
```

with

```tsx
    (m.getSource("draft") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: shape });
  }, [draft, loaded]);

  // The dots on the shape, as markers so they can be dragged. Reconciled by
  // place in the list, so the dot under the pointer survives every update.
  const movable = onCornerMove !== undefined;
  useEffect(() => {
    const m = map.current;
    if (!m || !loaded) return;
    const pts = draftDots ?? draft ?? [];
    pts.forEach(([lat, lng], i) => {
      let dot = dots.current[i];
      if (!dot) {
        const el = document.createElement("div");
        el.className = "draft-dot";
        const made = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(m);
        made.on("drag", () => {
          const at = made.getLngLat();
          moveRef.current?.(i, at.lat, at.lng);
        });
        dots.current[i] = dot = made;
      } else {
        dot.setLngLat([lng, lat]);
      }
      dot.setDraggable(movable);
      dot.getElement().classList.toggle("movable", movable);
    });
    for (const gone of dots.current.splice(pts.length)) gone.remove();
  }, [draft, draftDots, movable, loaded]);

  // Frame a picked place once; after that the operator owns the camera.
  useEffect(() => {
    const m = map.current;
    if (!m || !loaded || !frame || frame.ring.length === 0) return;
    const b = new maplibregl.LngLatBounds();
    for (const [lat, lng] of frame.ring) b.extend([lng, lat]);
    m.fitBounds(b, { padding: 60, maxZoom: 16, duration: 600 });
  }, [frame?.key, loaded]); // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 9: Dot styles.** In `apps/dashboard/src/styles.css`, after the line `.draw-hint strong { color: var(--ink); }`, add:

```css
/* A zone's corners (or a closed road's clicks) on the map; draggable ones are bigger. */
.draft-dot { width: 12px; height: 12px; border-radius: 50%; background: #fff; border: 2px solid var(--accent); box-shadow: 0 1px 3px rgba(11, 13, 18, 0.3); }
.draft-dot.movable { width: 16px; height: 16px; cursor: grab; }
.draft-dot.movable:active { cursor: grabbing; }
```

- [ ] **Step 10: Typecheck and build**

Run: `pnpm --filter dashboard exec tsc --noEmit && pnpm --filter dashboard exec vite build 2>&1 | tail -2`
Expected: no type errors, then `✓ built in ...`.

- [ ] **Step 11: The current zone drawing still works with dots as markers**

The page is still the pre-Task-4 one, with "Draw a zone" and corners only. Run:
`cd "$SCRATCH" && PW=$PW OUT=phone node zonehint.mjs dark 1440 && PW=$PW OUT=phone node zonehint.mjs light 390`
Expected: every line `PASS`, 9 per run. The corners appear as `.draft-dot` markers.

- [ ] **Step 12: Commit**

```bash
git add apps/dashboard/src/lib/zonePlaces.ts apps/dashboard/src/lib/supabase.ts apps/dashboard/src/components/LiveMap.tsx apps/dashboard/src/styles.css
git commit -m "feat(dashboard): zone place helpers; map corners drag and frame a place

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The Zones page: Pick a place, Close a road, Draw by hand

**Files:**
- Create: `apps/dashboard/src/components/ZonePlacePicker.tsx`
- Modify (full replacement): `apps/dashboard/src/pages/Zones.tsx`
- Modify: `apps/dashboard/src/styles.css` (after the `.draft-dot.movable:active` rule from Task 3)
- Test: `$SCRATCH/zoneplaces.mjs` (browser check against the local stack and the shapes loaded in Task 2)

**Interfaces:**
- Consumes:
  - From Task 3:
    - everything `lib/zonePlaces.ts` exports;
    - the `LiveMap` props `draftDots`, `onCornerMove`, `frame`;
    - `window.__novaMap` (dev only);
    - `.draft-dot`.
  - `useUi().confirm({title, body, confirmLabel})` from `components/ui.tsx`, which resolves `true` for "Start again" and `false` for "Cancel".
- Produces: the finished page.
  - Button "New zone".
  - Tabs "Pick a place", "Close a road", "Draw by hand" (`role="tab"`).
  - Search box `aria-label="Find a place"`, with results as `role="option"`.
  - Sliders `#size-margin`, `#size-size`, `#size-width`.
  - The credit line.

- [ ] **Step 1: Write the failing browser check.** Create `$SCRATCH/zoneplaces.mjs` with exactly this content:

```js
// Zones from real places, in a browser against the local stack: the three ways
// to make a shape, the names they fill in, and the guards around them.
// Saves nothing (no audit rows); the one zone it needs is inserted and removed here.
//   PW=<playwright-core> OUT=<dir> node zoneplaces.mjs [light|dark] [width]
import { createRequire } from "module";
import { execFileSync } from "node:child_process";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW);
const out = process.env.OUT ?? ".";
const look = process.argv[2] ?? "light";
const width = Number(process.argv[3] ?? 1440);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = (q) => execFileSync("docker", ["exec", "supabase_db_driver_app", "psql", "-U", "postgres", "-tAc", q], { encoding: "utf8" }).trim();

const results = [];
const check = (name, ok, got) => results.push(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `  (got: ${JSON.stringify(got)})`}`);

// ---- real places to work with, from the loaded shapes -------------------------------
const admin = sql(`select s.user_id from public.staff_members s join auth.users u on u.id = s.user_id where u.email = 'admin@nova.demo'`);
const asAdmin = (q) => sql(`set request.jwt.claims to '{"sub":"${admin}","role":"authenticated"}'; ${q}`).split("\n").pop();
// A named road with a real bend between its 20% and 80% points.
const road = JSON.parse(sql(`
  with r as (
    select name, shape::geometry g,
           st_lineinterpolatepoint(shape::geometry, 0.2) a, st_lineinterpolatepoint(shape::geometry, 0.8) b,
           st_lineinterpolatepoint(shape::geometry, 0.5) m
      from public.area_shapes where kind = 'road' and name is not null and st_length(shape) between 500 and 1200)
  select json_build_object('name', name, 'a', json_build_array(st_x(a), st_y(a)), 'b', json_build_array(st_x(b), st_y(b)),
                           'mid', json_build_array(st_x(m), st_y(m)))
    from r where st_distance(m::geography, st_makeline(a, b)::geography) > 60 order by name limit 1`));
// Somewhere in Kigali at least 80 m from any road.
const field = JSON.parse(sql(`
  select json_build_array(st_x(p), st_y(p)) from (
    select st_setsrid(st_point(30.02 + (i % 40) * 0.004, -2.02 + (i / 40) * 0.004), 4326) p from generate_series(0, 1599) i) s
   where not exists (select 1 from public.area_shapes r where r.kind = 'road' and st_dwithin(r.shape, s.p::geography, 80))
     and exists (select 1 from public.area_shapes c where c.kind = 'sector' and st_covers(c.shape, s.p::geography))
   limit 1`));
// A big cell, and a small triangle in its middle.
const cell = JSON.parse(sql(`
  select json_build_array(st_x(p), st_y(p)) from (
    select st_pointonsurface(shape::geometry) p from public.area_shapes where kind = 'cell' and st_area(shape) > 2e6 order by name limit 1) c`));
const tri = [[cell[0] - 0.0012, cell[1] - 0.0008], [cell[0] + 0.0012, cell[1] - 0.0008], [cell[0], cell[1] + 0.0012]];
const triName = asAdmin(`select public.staff_suggest_zone_name('${JSON.stringify(tri)}')`);
const landmark = sql(`select l.name from public.landmarks l
  where not exists (select 1 from public.area_shapes a where lower(a.name) = lower(l.name)) order by l.name limit 1`);

const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width, height: 900 }, ...(width < 900 ? { isMobile: true, hasTouch: true } : {}) });
await ctx.addInitScript((l) => localStorage.setItem("nova.appearance", l), look);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message.slice(0, 160)));
const strips = [];
page.on("response", async (r) => {
  if (r.url().includes("/rpc/staff_road_strip") && r.ok()) strips.push(await r.json());
});

const go = async (path) => {
  await page.evaluate((to) => { history.pushState({}, "", to); dispatchEvent(new PopStateEvent("popstate")); }, path);
  await sleep(2500);
};
const screen = (lnglat) =>
  page.evaluate((p) => {
    const m = window.__novaMap;
    const at = m.project(p);
    const box = m.getCanvas().getBoundingClientRect();
    return [box.left + at.x, box.top + at.y];
  }, lnglat);
const clickAt = async (lnglat, dx = 0) => {
  const [x, y] = await screen(lnglat);
  await page.mouse.click(x + dx, y);
};
const fit = (pts) =>
  page.evaluate((ps) => {
    const xs = ps.map((p) => p[0]);
    const ys = ps.map((p) => p[1]);
    window.__novaMap.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 60, duration: 0, maxZoom: 16 });
  }, pts);
const draftRing = () =>
  page.evaluate(async () => {
    const d = await window.__novaMap.getSource("draft").getData();
    const poly = d.features.find((f) => f.geometry.type === "Polygon");
    return poly ? poly.geometry.coordinates[0].slice(0, -1) : [];
  });
// Shoelace in degrees: enough to compare one shape with another.
const area = (ring) => Math.abs(ring.reduce((s, [x1, y1], i) => { const [x2, y2] = ring[(i + 1) % ring.length]; return s + x1 * y2 - x2 * y1; }, 0)) / 2;
const nameValue = () => page.locator("#zname").inputValue();
const tabOn = (label) => page.getByRole("tab", { name: label }).getAttribute("aria-selected");
const search = async (text) => {
  await page.getByLabel("Find a place").fill(text);
  await sleep(1500);
};
const pickOption = async (startsWith) => {
  const opts = page.getByRole("option");
  for (let i = 0; i < (await opts.count()); i++) {
    if ((await opts.nth(i).locator(".small").innerText()).startsWith(startsWith)) {
      await opts.nth(i).click();
      return true;
    }
  }
  return false;
};

try {
  await page.goto("http://localhost:5173/zones", { waitUntil: "domcontentloaded" });
  await sleep(2500);
  if (await page.locator('input[type="email"]').count()) {
    await page.locator('input[type="email"]').first().fill("admin@nova.demo");
    await page.locator('input[type="password"]').first().fill("NovaDemo-2026");
    await page.keyboard.press("Enter");
    await sleep(4500);
  }
  await go("/zones");
  check("the map is reachable for this check", await page.evaluate(() => !!window.__novaMap), "no window.__novaMap");
  check("the credit line is shown", await page.getByText("Sector and cell borders: geoBoundaries, Open Data Rwanda (CC BY 4.0).").isVisible(), "missing");

  // ---- Pick a place ----------------------------------------------------------------
  await page.getByRole("button", { name: "New zone" }).click();
  await sleep(500);
  check("New zone opens on Pick a place", (await tabOn("Pick a place")) === "true", await tabOn("Pick a place"));
  const box = await page.locator(".control-map").boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await sleep(500);
  check("a map click while picking a place adds nothing", (await page.locator(".draft-dot").count()) === 0, await page.locator(".draft-dot").count());

  await search("kimiro");
  const first = (await page.getByRole("option").first().innerText()).replace(/\s+/g, " ");
  check("a sector is found, saying what it is", first.includes("Kimironko") && first.includes("sector, Gasabo"), first);
  await pickOption("sector");
  await sleep(1500);
  check("picking a sector names the zone", (await nameValue()) === "Kimironko", await nameValue());
  check("and draws its border", (await draftRing()).length > 20, (await draftRing()).length);
  check("Add zone is ready", await page.getByRole("button", { name: "Add zone" }).isEnabled(), "disabled");

  // A slow answer for an earlier pick must not replace a later one.
  let slowed = false;
  await page.route("**/rpc/staff_place_shape", async (route) => {
    if (!slowed) {
      slowed = true;
      await sleep(3000);
    }
    await route.continue();
  });
  await search("nyabugogo bus");
  await pickOption("bus station");
  await sleep(400);
  await search("kimihurura");
  await pickOption("sector");
  await sleep(4500);
  await page.unroute("**/rpc/staff_place_shape");
  check("a slow earlier answer does not replace the place picked last", (await nameValue()) === "Kimihurura", await nameValue());
  const kimihurura = await draftRing();
  check("the shape shown is the last place's", kimihurura.length > 20 && area(kimihurura) > 0.0002, [kimihurura.length, area(kimihurura)]);

  await search("nyabugogo bus");
  await pickOption("bus station");
  await sleep(1500);
  check("a site gets a margin slider at 0 m", await page.getByText("Margin: 0 m").isVisible(), "no margin label");
  const site0 = area(await draftRing());
  await page.locator("#size-margin").fill("100");
  await sleep(1800);
  const site100 = area(await draftRing());
  check("a 100 m margin grows the site", site100 > 1.5 * site0, [site0, site100]);

  await search(landmark);
  await pickOption("place");
  await sleep(1500);
  check("a point place gets a size slider at 150 m", await page.getByText("Size: 150 m").isVisible(), "no size label");
  check("and becomes a 48-sided circle", (await draftRing()).length === 48, (await draftRing()).length);

  // ---- switching ways asks first ------------------------------------------------------
  const before = (await draftRing()).length;
  await page.getByRole("tab", { name: "Close a road" }).click();
  await sleep(400);
  check("switching with a shape made asks first", await page.getByText("Start again with “Close a road”?").isVisible(), "no question");
  await page.getByRole("button", { name: "Cancel" }).last().click();
  await sleep(400);
  check("saying no keeps the shape and the way", (await tabOn("Pick a place")) === "true" && (await draftRing()).length === before, [await tabOn("Pick a place"), (await draftRing()).length]);
  await page.getByRole("tab", { name: "Close a road" }).click();
  await sleep(300);
  await page.getByRole("button", { name: "Start again" }).click();
  await sleep(600);
  check("saying yes starts the road with nothing drawn", (await tabOn("Close a road")) === "true" && (await draftRing()).length === 0, await tabOn("Close a road"));

  // ---- Close a road ----------------------------------------------------------------------
  await fit([road.a, road.b]);
  await sleep(800);
  await clickAt(road.a, 6);
  await sleep(1500);
  await clickAt(road.b, -6);
  await sleep(2000);
  check("two clicks show two dots on the road", (await page.locator(".draft-dot").count()) === 2, await page.locator(".draft-dot").count());
  check("the closure is named after the road", (await nameValue()) === `${road.name} closure`, [await nameValue(), road.name]);
  const last = strips.at(-1);
  const follows = last?.corners
    ? sql(`select st_dwithin(public.zone_polygon('${JSON.stringify(last.corners)}'::jsonb)::geography, st_setsrid(st_point(${road.mid[0]}, ${road.mid[1]}), 4326)::geography, 15)`)
    : "no strip";
  check("the strip follows the road's bend", follows === "t", follows);
  const narrow = area(await draftRing());
  await page.locator("#size-width").fill("60");
  await sleep(1800);
  const wide = area(await draftRing());
  check("a wider strip covers more ground", wide > 1.6 * narrow, [narrow, wide]);

  await page.evaluate((p) => window.__novaMap.jumpTo({ center: p, zoom: 16 }), field);
  await sleep(800);
  await clickAt(field);
  await sleep(1800);
  check("a click far from any road says so", await page.locator(".map-hint").getByText("No road within 40 m of that click.").isVisible(), await page.locator(".map-hint").innerText());
  check("and is not added", (await page.locator(".draft-dot").count()) === 2, await page.locator(".draft-dot").count());
  await page.getByRole("button", { name: "Undo click" }).click();
  await sleep(1500);
  check("Undo click takes the last click away", (await page.locator(".draft-dot").count()) === 1, await page.locator(".draft-dot").count());
  check("and the zone needs another click", await page.getByText("Needs 1 more click on the road.").isVisible(), "no needs line");

  // ---- Draw by hand ---------------------------------------------------------------------
  await page.getByRole("tab", { name: "Draw by hand" }).click();
  await sleep(300);
  await page.getByRole("button", { name: "Start again" }).click();
  await sleep(500);
  await fit(tri);
  await sleep(800);
  for (const c of tri) {
    await clickAt(c);
    await sleep(400);
  }
  await sleep(1800);
  check("a hand-drawn shape is named after where it is", (await nameValue()) === triName, [await nameValue(), triName]);
  const dot = page.locator(".draft-dot").first();
  const at0 = await dot.boundingBox();
  await page.mouse.move(at0.x + at0.width / 2, at0.y + at0.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(at0.x + at0.width / 2 + i * 6, at0.y + at0.height / 2 + i * 4);
  await page.mouse.up();
  await sleep(600);
  const at1 = await dot.boundingBox();
  check("a corner can be dragged", Math.abs(at1.x - at0.x) > 20, [at0.x, at1.x]);
  check("dragging a corner adds no corner", (await page.locator(".draft-dot").count()) === 3, await page.locator(".draft-dot").count());

  await page.locator("#zname").fill("Probe typed name");
  const at2 = await dot.boundingBox();
  await page.mouse.move(at2.x + at2.width / 2, at2.y + at2.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) await page.mouse.move(at2.x + at2.width / 2 - i * 6, at2.y + at2.height / 2);
  await page.mouse.up();
  await sleep(1500);
  check("a typed name is kept when the shape changes", (await nameValue()) === "Probe typed name", await nameValue());

  // A shape that crosses itself is refused with the reason, and nothing is saved.
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Undo corner" }).click();
  const bow = [[cell[0] - 0.001, cell[1] + 0.001], [cell[0] + 0.001, cell[1] - 0.001], [cell[0] + 0.001, cell[1] + 0.001], [cell[0] - 0.001, cell[1] - 0.001]];
  for (const c of bow) {
    await clickAt(c);
    await sleep(300);
  }
  await page.getByRole("button", { name: "Add zone" }).click();
  await sleep(1200);
  check("a shape that crosses itself says so", await page.getByText("The shape crosses itself. Place the corners in order around the edge.").isVisible(), "no message");
  await page.getByRole("button", { name: "Cancel" }).click();

  // ---- an existing zone keeps its name when its shape is redrawn ---------------------------
  sql(`insert into public.zones (name, kind, area) values ('Probe existing zone', 'parking',
       st_geogfromtext('POLYGON((${cell[0]} ${cell[1]}, ${cell[0] + 0.001} ${cell[1]}, ${cell[0] + 0.001} ${cell[1] + 0.001}, ${cell[0]} ${cell[1]}))'))`);
  await go("/");
  await go("/zones");
  await page.getByText("Probe existing zone").click();
  await sleep(400);
  await page.getByRole("button", { name: "Redraw the shape" }).click();
  await search("kimiro");
  await pickOption("sector");
  await sleep(1500);
  check("redrawing an existing zone keeps its name", (await nameValue()) === "Probe existing zone", await nameValue());
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.screenshot({ path: `${out}/zoneplaces-${look}-${width}.png` });
} finally {
  sql(`delete from public.zones where name = 'Probe existing zone'`);
  console.log(results.join("\n"));
  console.log(`${results.filter((r) => r.startsWith("PASS")).length}/${results.length} passed; script errors: ${errors.length ? errors.join(" | ") : "none"}`);
  await browser.close();
}
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd "$SCRATCH" && PW=$PW OUT=phone node zoneplaces.mjs light 1440`
Expected: FAIL. `FAIL the credit line is shown`, then the run stops at `New zone` (no such button) with a Playwright timeout. `window.__novaMap` is already there from Task 3.

- [ ] **Step 3: Create `apps/dashboard/src/components/ZonePlacePicker.tsx`** with exactly this content:

```tsx
import { useEffect, useState } from "react";
import { Icon } from "./kit";
import { findPlaces, type FoundPlace } from "../lib/zonePlaces";

/**
 * Pick a place for a zone: one box for sectors, cells, sites and every place
 * passenger search knows. Each result says what it is, because cell names
 * repeat across sectors.
 */
export function ZonePlacePicker({ picked, onPick }: { readonly picked: FoundPlace | null; readonly onPick: (p: FoundPlace) => void }) {
  const [query, setQuery] = useState(picked?.name ?? "");
  const [results, setResults] = useState<FoundPlace[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(!picked);

  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 2) {
      setResults(null);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      findPlaces(q)
        .then((r) => {
          if (!live) return;
          setResults(r);
          setFailed(false);
        })
        .catch(() => {
          if (!live) return;
          setResults(null);
          setFailed(true);
        });
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query, open]);

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="input-icon">
        <Icon name="search" size={16} />
        <input
          className="input"
          aria-label="Find a place"
          placeholder="A sector, a cell, a site or a place"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
        />
      </div>
      {open && failed ? <p className="small muted" style={{ margin: 0 }}>Search didn't work. Try again.</p> : null}
      {open && results && results.length === 0 ? (
        <p className="small muted" style={{ margin: 0 }}>
          No place called “{query.trim()}”. Try a sector, a site, or draw it by hand.
        </p>
      ) : null}
      {open && results && results.length > 0 ? (
        <div className="place-results" role="listbox" aria-label="Places">
          {results.map((p) => (
            <button
              key={p.ref}
              role="option"
              aria-selected={picked?.ref === p.ref}
              className={`place-result${picked?.ref === p.ref ? " on" : ""}`}
              onClick={() => {
                setQuery(p.name);
                setOpen(false);
                onPick(p);
              }}
            >
              <strong>{p.name}</strong>
              <span className="small muted">{p.detail}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Replace `apps/dashboard/src/pages/Zones.tsx`** with exactly this content:

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { LiveMap, type MapZone } from "../components/LiveMap";
import { ZonePlacePicker } from "../components/ZonePlacePicker";
import { Flash, useUi } from "../components/ui";
import { can, kigaliDateTime, rpc, type Staff } from "../lib/supabase";
import { metres, placeShape, roadStrip, ROAD_WIDTH, SIZE, suggestName, type FoundPlace, type LatLng, type SizeRange } from "../lib/zonePlaces";

type Kind = "service" | "operating" | "restricted" | "parking" | "pickup";

interface Zone {
  id: string;
  name: string;
  kind: Kind;
  area: { type: "Polygon"; coordinates: [number, number][][] };
  alert_on_enter: boolean;
  alert_on_exit: boolean;
  active: boolean;
  area_km2: number;
  updated_at: string;
}

// What each kind is for, and which crossing is worth an alert by default.
const KINDS: Record<Kind, { label: string; help: string; color: string; enter: boolean; exit: boolean }> = {
  restricted: { label: "Restricted", help: "Riders should not go in: road works, closed roads, secure sites.", color: "#c42419", enter: true, exit: false },
  service: { label: "Service area", help: "Where Nova operates. Leaving it is worth knowing about.", color: "#0a2342", enter: false, exit: true },
  operating: { label: "Operating", help: "A smaller area a team or shift works in.", color: "#1d4ed8", enter: false, exit: true },
  parking: { label: "Parking", help: "Where riders wait between trips.", color: "#5e6676", enter: false, exit: false },
  pickup: { label: "Pickup", help: "A marked pickup point: a mall, the airport, a bus park.", color: "#0e7c4a", enter: false, exit: false },
};

/** The three ways to make a zone's shape. */
type Way = "place" | "road" | "hand";
const WAYS: readonly { way: Way; label: string }[] = [
  { way: "place", label: "Pick a place" },
  { way: "road", label: "Close a road" },
  { way: "hand", label: "Draw by hand" },
];

interface Draft {
  readonly id: string | null;
  readonly name: string;
  /** Staff typed the name, so a new shape no longer renames the zone. */
  readonly nameTouched: boolean;
  readonly kind: Kind;
  readonly enter: boolean;
  readonly exit: boolean;
  readonly active: boolean;
  /** The shape to save, as [lat, lng] corners; null keeps an existing zone's shape. */
  readonly corners: LatLng[] | null;
  readonly way: Way;
  /** Pick a place: the place, and its margin or circle size in metres (null for a border). */
  readonly place: FoundPlace | null;
  readonly size: number | null;
  /** Close a road: the clicks, snapped onto their roads, and the strip's width in metres. */
  readonly clicks: LatLng[];
  readonly width: number;
}

const ringOf = (z: Zone): [number, number][] => z.area.coordinates[0]!.slice(0, -1).map(([lng, lat]) => [lat, lng]);

/** A shape not started yet, whichever way. */
const BLANK = { corners: [] as LatLng[], place: null, size: null, clicks: [] as LatLng[] };

/** Fill in the name from the shape, unless staff have typed their own. */
const named = (d: Draft, name: string | null): Draft => (d.nameTouched || !name ? d : { ...d, name: name.slice(0, 60) });

export function Zones({ staff }: { staff: Staff }) {
  const { confirm } = useUi();
  const [zones, setZones] = useState<Zone[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // Why the last road click was not added, said on the map and in the form.
  const [roadNote, setRoadNote] = useState<string | null>(null);
  // A road strip is being worked out; clicks wait for it.
  const [busy, setBusy] = useState(false);
  // Where the map looks: set once per picked place, so moving a slider keeps the view.
  const [frame, setFrame] = useState<{ key: string; ring: LatLng[] } | null>(null);
  const editor = can(staff.role, "operations", "safety");

  const load = useCallback(() => {
    rpc<Zone[]>("staff_zones").then(setZones).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const startNew = () => {
    setDone(null);
    setError(null);
    setRoadNote(null);
    setDraft({ id: null, name: "", nameTouched: false, kind: "restricted", enter: true, exit: false, active: true, way: "place", width: ROAD_WIDTH.start, ...BLANK });
    setDrawing(true);
  };

  const edit = (z: Zone) => {
    setDone(null);
    setError(null);
    setRoadNote(null);
    setDrawing(false);
    setDraft({
      id: z.id, name: z.name, nameTouched: true, kind: z.kind, enter: z.alert_on_enter, exit: z.alert_on_exit, active: z.active,
      way: "place", width: ROAD_WIDTH.start, ...BLANK, corners: null,
    });
  };

  const redraw = () => {
    setRoadNote(null);
    setDraft((d) => (d ? { ...d, way: "place", ...BLANK } : d));
    setDrawing(true);
  };

  const cancel = () => {
    setDraft(null);
    setDrawing(false);
    setRoadNote(null);
  };

  const switchWay = async (way: Way) => {
    if (!draft || way === draft.way) return;
    const made = (draft.corners?.length ?? 0) > 0 || draft.clicks.length > 0;
    const label = WAYS.find((w) => w.way === way)!.label;
    if (made && !(await confirm({ title: `Start again with “${label}”?`, body: "The shape you have will be cleared.", confirmLabel: "Start again" }))) return;
    setRoadNote(null);
    setDraft((d) => (d ? { ...d, way, ...BLANK } : d));
  };

  const save = async () => {
    if (!draft) return;
    setError(null);
    try {
      await rpc("staff_save_zone", {
        p_id: draft.id,
        p_name: draft.name,
        p_kind: draft.kind,
        p_points: draft.corners ? draft.corners.map(([lat, lng]) => [lng, lat]) : null,
        p_alert_on_enter: draft.enter,
        p_alert_on_exit: draft.exit,
        p_active: draft.active,
      });
      setDone(`${draft.name} ${draft.id ? "saved" : "added"}.`);
      cancel();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work.");
    }
  };

  // ---- Pick a place ----------------------------------------------------------
  const pick = (p: FoundPlace) => setDraft((d) => (d ? named({ ...d, place: p, size: SIZE[p.kind]?.start ?? null, corners: [] }, p.name) : d));

  const placeRef = draft?.way === "place" ? (draft.place?.ref ?? null) : null;
  const placeSize = draft?.size ?? null;
  useEffect(() => {
    if (!placeRef) return;
    let live = true;
    const t = setTimeout(() => {
      placeShape(placeRef, placeSize)
        .then((corners) => {
          if (!live) return;
          // Only if this is still the place picked: a slow answer for the last one is dropped.
          setDraft((d) => (d && d.place?.ref === placeRef && d.size === placeSize ? { ...d, corners } : d));
          setFrame((f) => (f?.key === placeRef ? f : { key: placeRef, ring: corners }));
        })
        .catch((e: Error) => {
          if (live) setError(e.message);
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [placeRef, placeSize]);

  // ---- Close a road -------------------------------------------------------------
  const strip = async (clicks: LatLng[], width: number) => {
    setRoadNote(null);
    if (clicks.length === 0) {
      setDraft((d) => (d ? { ...d, clicks: [], corners: [] } : d));
      return;
    }
    setBusy(true);
    try {
      const r = await roadStrip(clicks, width);
      setDraft((d) => (d ? named({ ...d, clicks: r.clicks, corners: r.corners }, r.corners.length > 0 ? r.name : null) : d));
    } catch (e) {
      setRoadNote(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  };

  const roadWidth = draft?.way === "road" ? draft.width : null;
  useEffect(() => {
    if (roadWidth === null || !draft || draft.clicks.length < 2) return;
    const t = setTimeout(() => void strip(draft.clicks, roadWidth), 250);
    return () => clearTimeout(t);
  }, [roadWidth]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Draw by hand ---------------------------------------------------------------
  const addCorner = (lat: number, lng: number) => setDraft((d) => (d ? { ...d, corners: [...(d.corners ?? []), [lat, lng]] } : d));
  const moveCorner = (i: number, lat: number, lng: number) =>
    setDraft((d) => (d?.corners ? { ...d, corners: d.corners.map((c, j): LatLng => (j === i ? [lat, lng] : c)) } : d));

  // Each settled shape asks for a name, until staff type one.
  const handKey = draft?.way === "hand" && !draft.nameTouched && (draft.corners?.length ?? 0) >= 3 ? JSON.stringify(draft.corners) : null;
  useEffect(() => {
    if (!handKey) return;
    let live = true;
    const corners = JSON.parse(handKey) as LatLng[];
    const t = setTimeout(() => {
      suggestName(corners)
        .then((name) => {
          if (live) setDraft((d) => (d ? named(d, name) : d));
        })
        // A shape that crosses itself mid-drag has no name; saving says why.
        .catch(() => undefined);
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [handKey]);

  const mapZones: MapZone[] = useMemo(
    () =>
      (zones ?? [])
        // The zone being reshaped is drawn by the draft layer instead.
        .filter((z) => !(draft?.id === z.id && draft.corners))
        .map((z) => ({
          id: z.id,
          ring: ringOf(z),
          color: KINDS[z.kind].color,
          label: `${z.name}, ${KINDS[z.kind].label.toLowerCase()}${z.active ? "" : " (off)"}`,
          muted: !z.active || (draft !== null && draft.id !== z.id),
          onClick: drawing ? undefined : () => edit(z),
        })),
    [zones, draft, drawing],
  );

  const way = draft?.way ?? "place";
  const placed = draft?.corners?.length ?? 0;
  const clicks = draft?.clicks.length ?? 0;
  // What the zone still lacks, said next to the button so a grey button explains itself.
  const short = way === "hand" ? Math.max(0, 3 - placed) : way === "road" ? Math.max(0, 2 - clicks) : 0;
  const shapeMissing =
    !draft || draft.corners === null
      ? null
      : way === "place"
        ? placed === 0
          ? "a place"
          : null
        : short === 0
          ? null
          : way === "road"
            ? `${short} more ${short === 1 ? "click" : "clicks"} on the road`
            : `${short} more ${short === 1 ? "corner" : "corners"}`;
  const missing = draft ? [draft.name.trim().length < 2 ? "a name" : null, shapeMissing].filter((m): m is string => m !== null) : [];

  const onMapClick =
    !drawing || !draft
      ? undefined
      : draft.way === "hand"
        ? addCorner
        : draft.way === "road" && !busy
          ? (lat: number, lng: number) => void strip([...draft.clicks, [lat, lng]], draft.width)
          : undefined;
  const dots = !drawing || !draft ? [] : draft.way === "hand" ? (draft.corners ?? []) : draft.way === "road" ? draft.clicks : [];

  const active = (zones ?? []).filter((z) => z.active);
  const off = (zones ?? []).filter((z) => !z.active);

  return (
    <div className="control">
      <div className={`control-map${onMapClick ? " drawing" : ""}`}>
        <LiveMap
          points={[]}
          zones={mapZones}
          draft={draft?.corners ?? null}
          draftDots={dots}
          onCornerMove={drawing && draft?.way === "hand" ? moveCorner : undefined}
          onMapClick={onMapClick}
          frame={frame}
        />
        {drawing && way === "hand" ? (
          <div className="map-hint">
            <strong>Click the map to place each corner</strong>
            <span className="small muted">{placed} placed, at least 3 needed. Drag a corner to move it.</span>
          </div>
        ) : null}
        {drawing && way === "road" ? (
          <div className="map-hint">
            <strong>Click where the closure starts and where it ends</strong>
            {roadNote ? <span className="small hint-bad">{roadNote}</span> : <span className="small muted">Add a click at each junction.</span>}
          </div>
        ) : null}
      </div>

      <aside className="control-rail">
        <div className="row rail-head" style={{ justifyContent: "space-between" }}>
          <div>
            <h1 style={{ margin: 0, fontFamily: "var(--num)", fontSize: 30 }}>Zones</h1>
            <p className="sub">Alerts when a rider on shift crosses an edge.</p>
          </div>
          {editor && !draft ? (
            <button className="btn" onClick={startNew}>
              New zone
            </button>
          ) : null}
        </div>

        {error ? <div className="notice bad">{error}</div> : null}
        <Flash message={done} onShown={() => setDone(null)} />

        {draft ? (
          <section className="card stack">
            <h2 style={{ margin: 0 }}>{draft.id ? "Edit zone" : "New zone"}</h2>

            {editor && drawing ? (
              <div className="tabs ways" role="tablist" aria-label="How to make the shape">
                {WAYS.map((w) => (
                  <button key={w.way} role="tab" aria-selected={draft.way === w.way} className={draft.way === w.way ? "on" : ""} onClick={() => void switchWay(w.way)}>
                    {w.label}
                  </button>
                ))}
              </div>
            ) : null}

            {editor && drawing && draft.way === "place" ? (
              <>
                <ZonePlacePicker picked={draft.place} onPick={pick} />
                {draft.place && SIZE[draft.place.kind] ? (
                  <SizeSlider range={SIZE[draft.place.kind]!} value={draft.size ?? SIZE[draft.place.kind]!.start} onChange={(v) => setDraft({ ...draft, size: v })} />
                ) : null}
              </>
            ) : null}

            {editor && drawing && draft.way === "road" ? (
              <>
                <div className="draw-hint" role="status">
                  <strong>{clicks === 0 ? "Click where the closure starts and where it ends." : `${clicks} ${clicks === 1 ? "click" : "clicks"} on the road.`}</strong>
                  <span>{roadNote ?? (clicks < 2 ? "Each click snaps onto the nearest road." : "Add a click at each junction, or add the zone.")}</span>
                </div>
                <SizeSlider range={{ label: "Width", ...ROAD_WIDTH }} value={draft.width} onChange={(v) => setDraft({ ...draft, width: v })} />
                <div className="row">
                  <button className="btn secondary small" disabled={clicks === 0 || busy} onClick={() => void strip(draft.clicks.slice(0, -1), draft.width)}>
                    Undo click
                  </button>
                </div>
              </>
            ) : null}

            {editor && drawing && draft.way === "hand" ? (
              <>
                <div className="draw-hint" role="status">
                  <strong>{placed === 0 ? "Click the map to place each corner." : `${placed} ${placed === 1 ? "corner" : "corners"} placed.`}</strong>
                  <span>{placed === 0 ? "At least 3 corners make a zone." : short > 0 ? `Click the map for ${short} more.` : "Click the map to add more, or add the zone."}</span>
                </div>
                <div className="row">
                  <button className="btn secondary small" disabled={placed === 0} onClick={() => setDraft({ ...draft, corners: draft.corners!.slice(0, -1) })}>
                    Undo corner
                  </button>
                </div>
              </>
            ) : null}

            <div className="field">
              <label htmlFor="zname">Name</label>
              <input
                id="zname"
                className="input"
                value={draft.name}
                disabled={!editor}
                placeholder="e.g. Nyabugogo road works"
                onChange={(e) => setDraft({ ...draft, name: e.target.value, nameTouched: true })}
              />
            </div>
            <div className="field">
              <label htmlFor="zkind">Kind</label>
              <select
                id="zkind"
                className="select"
                value={draft.kind}
                disabled={!editor}
                onChange={(e) => {
                  const k = e.target.value as Kind;
                  setDraft({ ...draft, kind: k, enter: KINDS[k].enter, exit: KINDS[k].exit });
                }}
              >
                {Object.entries(KINDS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </select>
              <span className="small muted">{KINDS[draft.kind].help}</span>
            </div>
            <div className="stack" style={{ gap: 6 }}>
              <label className="switch">
                <input type="checkbox" checked={draft.enter} disabled={!editor} onChange={(e) => setDraft({ ...draft, enter: e.target.checked })} />
                <span>Alert when a rider goes in</span>
              </label>
              <label className="switch">
                <input type="checkbox" checked={draft.exit} disabled={!editor} onChange={(e) => setDraft({ ...draft, exit: e.target.checked })} />
                <span>Alert when a rider leaves</span>
              </label>
              {draft.id ? (
                <label className="switch">
                  <input type="checkbox" checked={draft.active} disabled={!editor} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
                  <span>Zone is on</span>
                </label>
              ) : null}
            </div>

            {editor && !drawing && draft.id ? (
              <div className="row">
                <button className="btn secondary small" onClick={redraw}>
                  Redraw the shape
                </button>
              </div>
            ) : null}

            <div className="row">
              {editor ? (
                <button className="btn" disabled={missing.length > 0} onClick={() => void save()}>
                  {draft.id ? "Save" : "Add zone"}
                </button>
              ) : null}
              <button className="link-button" onClick={cancel}>
                {editor ? "Cancel" : "Close"}
              </button>
            </div>
            {editor && missing.length > 0 ? <span className="small muted">Needs {missing.join(" and ")}.</span> : null}
          </section>
        ) : null}

        <section className="card">
          <h2>On</h2>
          <ZoneList zones={active} onPick={edit} empty="No zones yet. Start with the service area, then add closed roads as they happen." />
        </section>
        {off.length > 0 ? (
          <section className="card">
            <h2>Off</h2>
            <ZoneList zones={off} onPick={edit} empty="" />
          </section>
        ) : null}
        <p className="small muted" style={{ margin: 0 }}>
          Sector and cell borders: geoBoundaries, Open Data Rwanda (CC BY 4.0).
        </p>
      </aside>
    </div>
  );
}

/** A margin, a circle's size or a strip's width, in metres. */
function SizeSlider({ range, value, onChange }: { range: SizeRange; value: number; onChange: (v: number) => void }) {
  const id = `size-${range.label.toLowerCase()}`;
  return (
    <div className="field">
      <label htmlFor={id}>
        {range.label}: {metres(value)}
      </label>
      <input id={id} className="range" type="range" min={range.min} max={range.max} step={range.step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

function ZoneList({ zones, onPick, empty }: { zones: Zone[]; onPick: (z: Zone) => void; empty: string }) {
  if (zones.length === 0) return <p className="muted small" style={{ margin: 0 }}>{empty}</p>;
  return (
    <div className="list">
      {zones.map((z) => (
        <div key={z.id} className="list-item" onClick={() => onPick(z)}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="row" style={{ gap: 8 }}>
              <span className="swatch" style={{ background: KINDS[z.kind].color }} />
              <strong>{z.name}</strong>
            </span>
            <span className="small muted">{z.area_km2} km²</span>
          </div>
          <div className="small muted">
            {KINDS[z.kind].label}
            {", "}
            {z.alert_on_enter && z.alert_on_exit ? "alerts both ways" : z.alert_on_enter ? "alerts on entry" : z.alert_on_exit ? "alerts on leaving" : "no alerts"}
            {", "}
            {kigaliDateTime(z.updated_at)}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Styles for the switch, the results and the sliders.** In `apps/dashboard/src/styles.css`, after the line `.draft-dot.movable:active { cursor: grabbing; }`, add:

```css
/* Zones: the three ways to make a shape, the place search, the sliders. */
.ways { width: 100%; }
.ways button { flex: 1; white-space: nowrap; }
.place-results { display: flex; flex-direction: column; gap: 4px; max-height: 280px; overflow: auto; }
.place-result { display: flex; flex-direction: column; gap: 2px; text-align: left; padding: 8px 12px; border: 1px solid transparent; border-radius: 10px; background: var(--sunken); color: var(--ink); cursor: pointer; }
.place-result:hover { border-color: var(--hairline); }
.place-result.on { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.range { width: 100%; accent-color: var(--accent); }
.hint-bad { color: var(--bad); font-weight: 600; }
```

- [ ] **Step 6: Typecheck and build**

Run: `pnpm --filter dashboard exec tsc --noEmit && pnpm --filter dashboard exec vite build 2>&1 | tail -2`
Expected: no type errors, then `✓ built in ...`.

- [ ] **Step 7: Run the browser check: light, dark and phone**

Run: `cd "$SCRATCH" && for a in "light 1440" "dark 1440" "light 390"; do PW=$PW OUT=phone node zoneplaces.mjs $a | tail -3; done`
Expected: each run ends `31/31 passed; script errors: none`.
- Look at `phone/zoneplaces-*.png` and check the form, map hints and credit line in both looks.
- If a check fails, fix the page, not the check. Change a check only when it is plainly wrong about the spec, and say so in the commit.

- [ ] **Step 8: No regressions on the phone layout**

Run: `cd "$SCRATCH" && PW=$PW OUT=phone node phonemenu.mjs light | tail -3 && PAGES=/zones PW=$PW OUT=phone node dashphone.mjs zones light | tail -2`
Expected:
- `phonemenu.mjs`: all `PASS`.
- `dashphone.mjs`: `/zones page 390px on a 390px screen`, with nothing listed as wider than the screen.

- [ ] **Step 9: Commit**

```bash
git add apps/dashboard/src/components/ZonePlacePicker.tsx apps/dashboard/src/pages/Zones.tsx apps/dashboard/src/styles.css
git commit -m "feat(dashboard): make a zone from a place, a closed road or by hand, and it names itself

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Live rollout

**Files:** none changed. This task applies Task 1 on live, loads the data, deploys the dashboard and pushes.

**Interfaces:**
- Consumes: migration 0070 (Task 1), `scripts/import_area_shapes.py` (Task 2), the dashboard (Tasks 3–4), and `pnpm deploy:dashboard` (`scripts/deploy-dashboard.mjs`, which needs `vercel login`).
- Produces: live project `iwlolxlaxotooqvfvuvy` with 0070 applied and `area_shapes` loaded, and https://nova-control-five.vercel.app serving the new Zones page.

- [ ] **Step 1: Check what will be pushed to live**

Run: `npx supabase db push --linked --dry-run 2>&1 < /dev/null | tail -5`
Expected: exactly one migration, `0070_zone_places.sql`. If more are listed, stop and ask.

- [ ] **Step 2: Apply it**

Run: `npx supabase db push --linked --yes 2>&1 < /dev/null | tail -3`
Expected: `Applying migration 0070_zone_places.sql...` and `Finished supabase db push.`

- [ ] **Step 3: Load the shapes on live, without printing the key**

```bash
KEYS=$(npx supabase projects api-keys --project-ref iwlolxlaxotooqvfvuvy -o json 2>/dev/null | tail -1)
export NOVA_SERVICE_KEY=$(node -e 'const k=JSON.parse(process.argv[1]).find(x=>x.name==="service_role"); process.stdout.write(k.api_key)' "$KEYS")
NOVA_API_URL=https://iwlolxlaxotooqvfvuvy.supabase.co python -I scripts/import_area_shapes.py
```

Expected: the `loaded:` line, then `geoboundaries: 196 written, 0 removed` and `osm: <n> written, 0 removed`.

- [ ] **Step 4: Confirm the live counts**

```bash
for k in sector cell site road; do
  curl -s -o /dev/null -D - "https://iwlolxlaxotooqvfvuvy.supabase.co/rest/v1/area_shapes?select=id&kind=eq.$k" \
    -H "apikey: $NOVA_SERVICE_KEY" -H "Authorization: Bearer $NOVA_SERVICE_KEY" -H "Prefer: count=exact" -H "Range: 0-0" \
    | grep -i content-range | sed "s/^/$k /"
done
unset NOVA_SERVICE_KEY KEYS
```

Expected: `sector content-range: 0-0/35`, `cell .../161`, and site and road totals equal to the local ones from Task 2.

- [ ] **Step 5: Deploy the dashboard and confirm it is live**

Run: `pnpm deploy:dashboard 2>&1 | grep -o '"message": "[^"]*"' | tail -1`
Expected: `"message": "Deployment ... ready."`.

Then run:

```bash
js=$(curl -s https://nova-control-five.vercel.app/ | grep -o '/assets/index-[^"]*\.js' | head -1)
curl -s "https://nova-control-five.vercel.app$js" | grep -o 'Pick a place' | head -1
curl -s "https://nova-control-five.vercel.app$js" | grep -c '__novaMap'
```

Expected: `Pick a place`, then `0` (the dev-only hook is not in the production build).

- [ ] **Step 6: Push the branch**

Run: `git push -q && git status --short`
Expected: only the untouched `supabase/config.toml`, `reports/` and `research_notes/` remain.

