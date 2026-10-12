begin;
select plan(6);

-- Olive runs operations.
insert into auth.users (instance_id, id, aud, role, email)
values ('00000000-0000-0000-0000-000000000000', 'e5400000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'o.e54@test.local');
insert into public.staff_members (user_id, role, display_name, active)
values ('e5400000-0000-4000-8000-000000000001', 'operations', 'Olive', true);

-- Far from Kigali, so loaded shapes never get in the way:
--  * a site outlined by three open ways that only close when joined (as the airport is);
--  * Qwsplit St, one street split into two ways with a right-angle bend where they join;
--  * Qwalong Rd meeting Qwbranch Ave at a junction, Qwbranch Ave bending after it.
select is(public.import_area_shapes(jsonb_build_array(
  jsonb_build_object('id', 't54:site', 'kind', 'site', 'name', 'Qwfield Airport', 'detail', 'airport', 'source', 'test54',
    'geojson', '{"type":"MultiLineString","coordinates":[[[21.03,-1.95],[21.04,-1.95]],[[21.04,-1.95],[21.04,-1.94],[21.03,-1.94]],[[21.03,-1.94],[21.03,-1.95]]]}'),
  jsonb_build_object('id', 't54:s1', 'kind', 'road', 'name', 'Qwsplit St', 'source', 'test54',
    'geojson', '{"type":"LineString","coordinates":[[21.000,-1.95],[21.005,-1.95]]}'),
  jsonb_build_object('id', 't54:s2', 'kind', 'road', 'name', 'Qwsplit St', 'source', 'test54',
    'geojson', '{"type":"LineString","coordinates":[[21.005,-1.95],[21.005,-1.945]]}'),
  jsonb_build_object('id', 't54:a', 'kind', 'road', 'name', 'Qwalong Rd', 'source', 'test54',
    'geojson', '{"type":"LineString","coordinates":[[21.010,-1.95],[21.015,-1.95]]}'),
  jsonb_build_object('id', 't54:b', 'kind', 'road', 'name', 'Qwbranch Ave', 'source', 'test54',
    'geojson', '{"type":"LineString","coordinates":[[21.015,-1.95],[21.015,-1.946],[21.019,-1.946]]}')
)), 5, 'every row is written');

-- ---- a site outlined by several open ways ----------------------------------------------
select is((select geometrytype(shape::geometry) from public.area_shapes where id = 't54:site'), 'POLYGON',
  'a site whose outline is split across open ways becomes one shape');

-- ---- an import that would empty a source -----------------------------------------------
select throws_ok($$ select public.finish_area_import('test54', array['t54:site']) $$, '22023', 'import_shrinks',
  'finishing an import that would remove most of a source is refused');
select is(public.finish_area_import('test54', array['t54:site', 't54:s1', 't54:s2', 't54:a', 't54:b'], true), 0,
  'a full import finishes as before');

-- ---- road strips stay on the road ----------------------------------------------------------
set local request.jwt.claims to '{"sub":"e5400000-0000-4000-8000-000000000001","role":"authenticated"}';
select ok(st_dwithin(public.zone_polygon(public.staff_road_strip('[[21.002,-1.9502],[21.0052,-1.947]]', 30) -> 'corners')::geography,
                     st_point(21.005, -1.95)::geography, 15),
  'a strip across two ways of one street follows the street round its bend');
select ok(st_dwithin(public.zone_polygon(public.staff_road_strip('[[21.0149,-1.9501],[21.017,-1.9462]]', 30) -> 'corners')::geography,
                     st_point(21.015, -1.946)::geography, 15),
  'a strip from a junction follows the second road round its bend');

select * from finish();
rollback;
