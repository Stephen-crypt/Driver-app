-- Zones from real places: fixes from the whole-change review.
--
-- * A site whose outline OpenStreetMap splits across open ways (Kigali
--   International Airport is three) was dropped by the import; the ways are
--   now joined into one shape.
-- * Finishing an import removed every row a download left out, so a short
--   download would empty what staff pick from. It now refuses to remove more
--   than a fifth of a source at once unless told to (p_allow_shrink).
-- * A closed-road strip ran straight between clicks on different OSM ways,
--   leaving the road wherever OpenStreetMap splits a street (KN 5 Road is 43
--   ways) and at the junction clicks the page asks for. Between different
--   ways it now follows the street's joined ways, or goes through the point
--   where the two ways meet; straight only when neither applies.

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
      -- An outline split across open ways (the airport's is three) closes once
      -- they are joined end to end.
      if geometrytype(v_geom) in ('LINESTRING', 'MULTILINESTRING') then
        v_geom := st_buildarea(st_linemerge(v_geom));
      end if;
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

drop function if exists public.finish_area_import(text, text[]);
create or replace function public.finish_area_import(p_source text, p_seen text[], p_allow_shrink boolean default false)
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare
  v_have integer;
  v_seen integer := coalesce(cardinality(p_seen), 0);
  v_gone integer;
begin
  -- A download that came back short would wipe what staff pick from.
  select count(*) into v_have from public.area_shapes where source = p_source;
  if not coalesce(p_allow_shrink, false) and v_seen < 0.8 * v_have then
    raise exception 'import_shrinks' using errcode = '22023',
      detail = format('%s rows stored for %s, %s in this download', v_have, p_source, v_seen);
  end if;
  delete from public.area_shapes where source = p_source and not (id = any (p_seen));
  get diagnostics v_gone = row_count;
  -- A cell belongs to the sector its middle sits in.
  update public.area_shapes c
     set parent = public.sector_at(st_pointonsurface(c.shape::geometry)::geography)
   where c.kind = 'cell';
  return v_gone;
end;
$$;

-- The way along the roads between two snapped clicks on different ways, or
-- null: along one street's ways (OpenStreetMap splits a street into many), or
-- along the first way to where it meets the second, then along that.
create or replace function public.road_path(p_a text, p_pa geometry, p_b text, p_pb geometry)
returns geometry language plpgsql stable set search_path = public, extensions as $$
declare
  v_na   text;
  v_nb   text;
  v_la   geometry;
  v_lb   geometry;
  v_line geometry;
  v_x    geometry;
  f1     double precision;
  f2     double precision;
  v_one  geometry;
  v_two  geometry;
begin
  select name, shape::geometry into v_na, v_la from public.area_shapes where id = p_a;
  select name, shape::geometry into v_nb, v_lb from public.area_shapes where id = p_b;

  -- One street: join its ways near the two clicks, and follow the piece holding both.
  if v_na is not null and v_na = v_nb then
    select d.geom into v_line
      from st_dump(st_linemerge((
             select st_collect(r.shape::geometry) from public.area_shapes r
              where r.kind = 'road' and r.name = v_na
                and st_dwithin(r.shape, st_makeline(p_pa, p_pb)::geography, 2000)))) d
     where st_dwithin(d.geom::geography, p_pa::geography, 1) and st_dwithin(d.geom::geography, p_pb::geography, 1)
     limit 1;
    if v_line is not null then
      f1 := st_linelocatepoint(v_line, p_pa);
      f2 := st_linelocatepoint(v_line, p_pb);
      v_line := st_linesubstring(v_line, least(f1, f2), greatest(f1, f2));
      return case when f1 > f2 then st_reverse(v_line) else v_line end;
    end if;
  end if;

  -- Two ways that meet: through the meeting point nearest the clicks.
  select d.geom into v_x
    from st_dump(st_intersection(v_la, v_lb)) d
   where geometrytype(d.geom) = 'POINT'
   order by st_distance(d.geom, p_pa) + st_distance(d.geom, p_pb)
   limit 1;
  if v_x is null then
    return null;
  end if;
  f1 := st_linelocatepoint(v_la, p_pa);
  f2 := st_linelocatepoint(v_la, v_x);
  v_one := st_linesubstring(v_la, least(f1, f2), greatest(f1, f2));
  if f1 > f2 then v_one := st_reverse(v_one); end if;
  f1 := st_linelocatepoint(v_lb, v_x);
  f2 := st_linelocatepoint(v_lb, p_pb);
  v_two := st_linesubstring(v_lb, least(f1, f2), greatest(f1, f2));
  if f1 > f2 then v_two := st_reverse(v_two); end if;
  return st_makeline(v_one, v_two);
end;
$$;

create or replace function public.staff_road_strip(p_clicks jsonb, p_width integer)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare
  c        record;
  v_pt     geometry;
  v_road   record;
  v_prev_id   text;
  v_prev_frac double precision;
  v_prev_pt   geometry;
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
      -- Different ways: along the street or through the junction when the
      -- roads allow it, straight across only when they do not.
      v_seg := public.road_path(v_prev_id, v_prev_pt, v_road.id, v_pt);
      if v_seg is null then
        v_pts := v_pts || v_pt;
      else
        v_pts := v_pts || array(select (st_dumppoints(v_seg)).geom offset 1);
      end if;
    end if;
    v_prev_id := v_road.id;
    v_prev_frac := v_road.frac;
    v_prev_pt := v_pt;
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

revoke all on function public.import_area_shapes(jsonb) from public, anon, authenticated;
revoke all on function public.finish_area_import(text, text[], boolean) from public, anon, authenticated;
revoke all on function public.road_path(text, geometry, text, geometry) from public, anon, authenticated;
grant execute on function public.import_area_shapes(jsonb) to service_role;
grant execute on function public.finish_area_import(text, text[], boolean) to service_role;
revoke all on function public.staff_road_strip(jsonb, integer) from public, anon;
grant execute on function public.staff_road_strip(jsonb, integer) to authenticated;
