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
