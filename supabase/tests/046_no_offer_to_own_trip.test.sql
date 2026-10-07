begin;
select plan(4);

-- Olivier rides for Nova and books from the passenger app with the same
-- number - one account. Grace is another rider, a little further away.
insert into auth.users (instance_id, id, aud, role, email)
select '00000000-0000-0000-0000-000000000000', ('e4600000-0000-4000-8000-00000000000' || n)::uuid,
       'authenticated', 'authenticated', 'u' || n || '.e46@test.local' from generate_series(1, 2) n;
insert into public.profiles (id, role, first_name, phone) values
  ('e4600000-0000-4000-8000-000000000001', 'rider', 'Olivier', '+250788994601'),
  ('e4600000-0000-4000-8000-000000000002', 'rider', 'Grace', '+250788994602');
insert into public.riders (id, verification)
select ('e4600000-0000-4000-8000-00000000000' || n)::uuid, 'verified' from generate_series(1, 2) n;
insert into public.vehicles (rider_id, class, plate, is_active)
select ('e4600000-0000-4000-8000-00000000000' || n)::uuid, 'moto', 'RAT 46' || n, true from generate_series(1, 2) n;
insert into public.shifts (rider_id, vehicle_id, safety_checks)
select v.rider_id, v.id, '{}'::jsonb from public.vehicles v
 where v.rider_id in ('e4600000-0000-4000-8000-000000000001', 'e4600000-0000-4000-8000-000000000002');

delete from public.rider_presence;
insert into public.rider_presence (rider_id, status, vehicle_class, position, heartbeat_at) values
  ('e4600000-0000-4000-8000-000000000001', 'online', 'moto', st_point(30.0620, -1.9441)::geography, now()),
  ('e4600000-0000-4000-8000-000000000002', 'online', 'moto', st_point(30.0650, -1.9441)::geography, now());

insert into public.trips (id, passenger_id, vehicle_class, state, pickup, pickup_label, dropoff, dropoff_label)
values ('e4610000-0000-4000-8000-000000000001', 'e4600000-0000-4000-8000-000000000001', 'moto', 'requested',
        st_point(30.0619, -1.9441)::geography, 'Nyarugenge', st_point(30.0925, -1.9536)::geography, 'Kigali Heights');

select is(
  (select array_agg(rider_id) from public.find_candidates_for_trip('e4610000-0000-4000-8000-000000000001', 4000, 10)),
  array['e4600000-0000-4000-8000-000000000002'::uuid],
  'the passenger is not a candidate for their own trip, though they are the nearest rider');

select is(
  (select rider_id from public.offer_next_candidate('e4610000-0000-4000-8000-000000000001')),
  'e4600000-0000-4000-8000-000000000002'::uuid,
  'so the offer goes to the next rider');

select throws_ok(
  $$ select public.create_trip_offer('e4610000-0000-4000-8000-000000000001', 'e4600000-0000-4000-8000-000000000001', 1, null, 15, 't46-own') $$,
  '22023', 'own_trip',
  'and nothing can offer a passenger their own ride');

-- With only the passenger online, the trip ends as no riders instead of
-- hanging on an offer that can never be accepted.
update public.rider_presence set status = 'offline' where rider_id = 'e4600000-0000-4000-8000-000000000002';
insert into public.trips (id, passenger_id, vehicle_class, state, pickup, pickup_label, dropoff, dropoff_label)
values ('e4610000-0000-4000-8000-000000000002', 'e4600000-0000-4000-8000-000000000001', 'moto', 'requested',
        st_point(30.0619, -1.9441)::geography, 'Nyarugenge', st_point(30.0925, -1.9536)::geography, 'Kigali Heights');
select public.offer_next_candidate('e4610000-0000-4000-8000-000000000002');
select is((select state::text from public.trips where id = 'e4610000-0000-4000-8000-000000000002'), 'no_riders',
  'alone, the passenger''s own trip finds no riders rather than offering itself');

select * from finish();
rollback;
