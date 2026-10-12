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
