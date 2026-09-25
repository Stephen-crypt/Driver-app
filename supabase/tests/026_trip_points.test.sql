begin;
select plan(7);

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000','f6000000-0000-4000-8000-000000000001','authenticated','authenticated','p.f6@test.local'),
  ('00000000-0000-0000-0000-000000000000','f6000000-0000-4000-8000-000000000002','authenticated','authenticated','r.f6@test.local'),
  ('00000000-0000-0000-0000-000000000000','f6000000-0000-4000-8000-000000000003','authenticated','authenticated','o.f6@test.local'),
  ('00000000-0000-0000-0000-000000000000','f6000000-0000-4000-8000-000000000004','authenticated','authenticated','x.f6@test.local');

insert into public.profiles (id, role, first_name, phone) values
  ('f6000000-0000-4000-8000-000000000001','passenger','Aline','+250788960001'),
  ('f6000000-0000-4000-8000-000000000002','rider','Eric','+250788960002'),
  ('f6000000-0000-4000-8000-000000000003','rider','Jean','+250788960003'),
  ('f6000000-0000-4000-8000-000000000004','rider','Mallory','+250788960004');

insert into public.riders (id, verification) values
  ('f6000000-0000-4000-8000-000000000002','verified'),
  ('f6000000-0000-4000-8000-000000000003','verified'),
  ('f6000000-0000-4000-8000-000000000004','verified');

insert into public.trips (id, passenger_id, rider_id, vehicle_class, state,
                          pickup, pickup_label, dropoff, dropoff_label)
values ('f6100000-0000-4000-8000-000000000001',
        'f6000000-0000-4000-8000-000000000001', null, 'moto', 'offered',
        st_point(30.0619, -1.9441)::geography, 'Kimironko',
        st_point(30.0588, -1.9536)::geography, 'Kigali Heights');

-- Jean holds a live offer for it; Mallory has nothing to do with it.
insert into public.trip_offers (trip_id, rider_id, rank, eta_seconds, expires_at)
values ('f6100000-0000-4000-8000-000000000001', 'f6000000-0000-4000-8000-000000000003',
        1, 240, now() + interval '15 seconds');

set local role authenticated;

set local request.jwt.claims to '{"sub":"f6000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select row(round(pickup_lng::numeric, 4), round(dropoff_lat::numeric, 4))::text
     from public.trip_points('f6100000-0000-4000-8000-000000000001')),
  '(30.0619,-1.9536)',
  'the passenger reads both ends as plain coordinates');

set local request.jwt.claims to '{"sub":"f6000000-0000-4000-8000-000000000003","role":"authenticated"}';
select is(
  (select count(*)::int from public.trip_points('f6100000-0000-4000-8000-000000000001')),
  1,
  'a rider with a live offer can see where the trip goes before accepting');

set local request.jwt.claims to '{"sub":"f6000000-0000-4000-8000-000000000004","role":"authenticated"}';
select throws_ok(
  $$ select * from public.trip_points('f6100000-0000-4000-8000-000000000001') $$,
  '42501', 'not_a_participant',
  'an unrelated rider cannot map someone else''s trip');

set local role postgres;
update public.trip_offers set expires_at = now() - interval '1 second'
 where trip_id = 'f6100000-0000-4000-8000-000000000001';

set local role authenticated;
set local request.jwt.claims to '{"sub":"f6000000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok(
  $$ select * from public.trip_points('f6100000-0000-4000-8000-000000000001') $$,
  '42501', 'not_a_participant',
  'and an expired offer stops granting the view');

set local request.jwt.claims to '{"sub":"f6000000-0000-4000-8000-000000000001","role":"authenticated"}';
-- Fifty metres east of a real landmark: it is the one named.
select is(
  (select n.name
     from (select name, st_x(position::geometry) as x, st_y(position::geometry) as y
             from public.landmarks order by name limit 1) l,
          public.nearest_landmark(l.x + 0.00045, l.y) n),
  (select name from public.landmarks order by name limit 1),
  'a GPS fix is named by the landmark nearest to it');

select is(
  (select count(*)::int from public.nearest_landmark(29.20, -1.60)),
  0,
  'and nothing is named when no landmark is within a kilometre');

select ok(
  not has_function_privilege('anon', 'public.trip_points(uuid)', 'EXECUTE'),
  'trip coordinates are never anonymous');

select * from finish();
rollback;
