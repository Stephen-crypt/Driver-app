begin;
select plan(2);

-- A rider claims 50 km for a ride the server measured at 5 km, and another
-- claims 50 km for a ride with no GPS at all.
insert into auth.users (instance_id, id, aud, role, email)
select '00000000-0000-0000-0000-000000000000', ('e3800000-0000-4000-8000-00000000000' || n)::uuid,
       'authenticated', 'authenticated', 'u' || n || '.e38@test.local' from generate_series(1, 2) n;
insert into public.profiles (id, role, first_name, phone) values
  ('e3800000-0000-4000-8000-000000000001', 'passenger', 'Aline', '+250788994201'),
  ('e3800000-0000-4000-8000-000000000002', 'rider', 'Eric', '+250788994202');
insert into public.riders (id, verification) values ('e3800000-0000-4000-8000-000000000002', 'verified');
insert into public.fare_quotes (id, passenger_id, policy_id, vehicle_class, distance_m, duration_s, amount_rwf, expires_at)
select ('e3820000-0000-4000-8000-00000000000' || n)::uuid, 'e3800000-0000-4000-8000-000000000001',
       (select id from public.fare_policies where vehicle_class = 'moto' and effective_to is null limit 1),
       'moto', 5000, 900, 2000, now() + interval '2 minutes' from generate_series(1, 2) n;
insert into public.trips (id, passenger_id, rider_id, vehicle_class, state, pickup, pickup_label, dropoff, dropoff_label,
                          quoted_distance_m, quoted_duration_s, quote_id, quoted_amount_rwf)
select ('e3810000-0000-4000-8000-00000000000' || n)::uuid, 'e3800000-0000-4000-8000-000000000001', 'e3800000-0000-4000-8000-000000000002',
       'moto', 'in_progress', st_point(30.06, -1.94)::geography, 'A', st_point(30.10, -1.95)::geography, 'B',
       5000, 900, ('e3820000-0000-4000-8000-00000000000' || n)::uuid, 2000
  from generate_series(1, 2) n;
insert into public.trip_progress (trip_id, min_to_dropoff_m, travelled_m, last_position)
values ('e3810000-0000-4000-8000-000000000001', 0, 5000, st_point(30.10, -1.95)::geography);

set local role authenticated;
set local request.jwt.claims to '{"sub":"e3800000-0000-4000-8000-000000000002","role":"authenticated"}';
select public.complete_trip('e3810000-0000-4000-8000-000000000001', 50000, 'c-e38-1');
select public.complete_trip('e3810000-0000-4000-8000-000000000002', 50000, 'c-e38-2');
reset role;

select is((select actual_distance_m from public.trips where id = 'e3810000-0000-4000-8000-000000000001'), 5800,
  'a phone claiming 50 km for a measured 5 km ride is billed for 5.8 km at most');
select is((select (meta ->> 'total_rwf')::int from public.trip_events
            where trip_id = 'e3810000-0000-4000-8000-000000000002' and to_state = 'completed'), 2000,
  'and with no GPS to back the claim, the passenger pays exactly the quote');

select * from finish();
rollback;
