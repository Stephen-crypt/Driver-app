begin;
select plan(13);

-- Operations (OP), control room (CR), a rider (R), a passenger (P).
insert into auth.users (instance_id, id, aud, role, email)
select '00000000-0000-0000-0000-000000000000', ('e3300000-0000-4000-8000-00000000000' || n)::uuid,
       'authenticated', 'authenticated', 'u' || n || '.e33@test.local'
  from generate_series(1, 4) n;

insert into public.staff_members (user_id, role, display_name, active) values
  ('e3300000-0000-4000-8000-000000000001', 'operations', 'Olive', true),
  ('e3300000-0000-4000-8000-000000000002', 'control_room', 'Claudine', true);
insert into public.profiles (id, role, first_name, phone) values
  ('e3300000-0000-4000-8000-000000000003', 'rider', 'Eric', '+250788993701'),
  ('e3300000-0000-4000-8000-000000000004', 'passenger', 'Aline', '+250788993702');
insert into public.riders (id, verification) values ('e3300000-0000-4000-8000-000000000003', 'verified');

create temp table ids (name text primary key, id uuid);
grant all on ids to authenticated;

set local role authenticated;

-- ---- drawing zones ---------------------------------------------------------
set local request.jwt.claims to '{"sub":"e3300000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok($$ select public.staff_save_zone(null, 'Airport apron', 'restricted',
    '[[30.13,-1.97],[30.14,-1.97],[30.14,-1.96]]', true, false) $$,
  '42501', 'not_permitted', 'the control room watches zones but does not draw them');

set local request.jwt.claims to '{"sub":"e3300000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$ select public.staff_save_zone(null, 'Bowtie', 'restricted',
    '[[30.0,-1.9],[30.1,-2.0],[30.1,-1.9],[30.0,-2.0]]', true, false) $$,
  '22023', 'zone_crosses_itself', 'a shape that crosses itself is refused');
select throws_ok($$ select public.staff_save_zone(null, 'Two points', 'restricted', '[[30.0,-1.9],[30.1,-2.0]]', true, false) $$,
  '22023', 'zone_needs_points', 'a zone needs at least three corners');

select lives_ok($$ insert into ids values ('closed', public.staff_save_zone(null, 'Closed road works', 'restricted',
    '[[30.095,-1.955],[30.105,-1.955],[30.105,-1.945],[30.095,-1.945]]', true, false)) $$,
  'operations draws a restricted zone');
select lives_ok($$ insert into ids values ('kigali', public.staff_save_zone(null, 'Kigali service area', 'service',
    '[[29.95,-2.05],[30.25,-2.05],[30.25,-1.85],[29.95,-1.85]]', false, true)) $$,
  'and the service area');

set local request.jwt.claims to '{"sub":"e3300000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select area ->> 'type' from public.staff_zones() where id = (select id from ids where name = 'closed')), 'Polygon',
  'the control room reads zones back as shapes for the map');

-- ---- crossings -------------------------------------------------------------
reset role;
insert into public.rider_presence (rider_id, status, vehicle_class, position, accuracy_m)
values ('e3300000-0000-4000-8000-000000000003', 'online', 'moto', st_point(30.090, -1.950)::geography, 8);

update public.rider_presence set position = st_point(30.100, -1.950)::geography
 where rider_id = 'e3300000-0000-4000-8000-000000000003';
select is((select detail from public.geo_alerts where rider_id = 'e3300000-0000-4000-8000-000000000003' and kind = 'zone_enter'),
  'Entered Closed road works (restricted zone)', 'riding into a restricted zone raises an alert');

update public.rider_presence set position = st_point(30.090, -1.950)::geography
 where rider_id = 'e3300000-0000-4000-8000-000000000003';
update public.rider_presence set position = st_point(30.100, -1.951)::geography
 where rider_id = 'e3300000-0000-4000-8000-000000000003';
select is((select count(*)::int from public.geo_alerts where rider_id = 'e3300000-0000-4000-8000-000000000003'), 1,
  'leaving a restricted zone is not news, and going back in within ten minutes is not a second alert');

update public.rider_presence set position = st_point(30.40, -1.95)::geography, accuracy_m = 400
 where rider_id = 'e3300000-0000-4000-8000-000000000003';
select is((select count(*)::int from public.geo_alerts where kind = 'zone_exit' and rider_id = 'e3300000-0000-4000-8000-000000000003'), 0,
  'a rough GPS fix is not trusted to say someone left the area');
update public.rider_presence set position = st_point(30.41, -1.95)::geography, accuracy_m = 10
 where rider_id = 'e3300000-0000-4000-8000-000000000003';
update public.rider_presence set position = st_point(30.20, -1.95)::geography, accuracy_m = 10
 where rider_id = 'e3300000-0000-4000-8000-000000000003';
update public.rider_presence set position = st_point(30.42, -1.95)::geography, accuracy_m = 10
 where rider_id = 'e3300000-0000-4000-8000-000000000003';
select is((select count(*)::int from public.geo_alerts where kind = 'zone_exit' and rider_id = 'e3300000-0000-4000-8000-000000000003'), 1,
  'leaving the service area raises an alert once an accurate fix shows it');

-- ---- route deviation -------------------------------------------------------
insert into public.trips (id, passenger_id, rider_id, vehicle_class, state, quoted_distance_m,
                          pickup, pickup_label, dropoff, dropoff_label)
values ('e3310000-0000-4000-8000-000000000001',
        'e3300000-0000-4000-8000-000000000004', 'e3300000-0000-4000-8000-000000000003', 'moto', 'in_progress', 1500,
        st_point(30.0619, -1.9441)::geography, 'Kimironko',
        st_point(30.0588, -1.9536)::geography, 'Kigali Heights');

set local role authenticated;
set local request.jwt.claims to '{"sub":"e3300000-0000-4000-8000-000000000003","role":"authenticated"}';
select public.publish_track_point('e3310000-0000-4000-8000-000000000001', 30.0619, -1.9441, 5);
select public.publish_track_point('e3310000-0000-4000-8000-000000000001', 30.0600, -1.9500, 5);
-- A block the wrong way round a one-way system is normal driving.
select public.publish_track_point('e3310000-0000-4000-8000-000000000001', 30.0610, -1.9470, 5);
reset role;
select is((select count(*)::int from public.geo_alerts where trip_id = 'e3310000-0000-4000-8000-000000000001'), 0,
  'a small detour raises nothing');

set local role authenticated;
select public.publish_track_point('e3310000-0000-4000-8000-000000000001', 30.0650, -1.9300, 5);
reset role;
select is((select kind from public.geo_alerts where trip_id = 'e3310000-0000-4000-8000-000000000001'), 'moving_away',
  'heading kilometres away from the drop-off does');

set local role authenticated;
set local request.jwt.claims to '{"sub":"e3300000-0000-4000-8000-000000000002","role":"authenticated"}';
select lives_ok($$ select public.staff_review_geo_alert(
    (select id from public.geo_alerts where trip_id = 'e3310000-0000-4000-8000-000000000001'),
    'Called Eric: passenger asked to collect a parcel first') $$,
  'the control room reviews it with what they found');

select * from finish();
rollback;
