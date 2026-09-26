begin;
select plan(3);

insert into auth.users (instance_id, id, aud, role, email)
values ('00000000-0000-0000-0000-000000000000', 'e3700000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'p.e37@test.local');
insert into public.profiles (id, role, first_name, phone) values ('e3700000-0000-4000-8000-000000000001', 'passenger', 'Aline', '+250788994101');

-- A quote as the quote function makes it: priced for Kimironko to Kigali Heights.
insert into public.fare_quotes (id, passenger_id, policy_id, vehicle_class, distance_m, duration_s, amount_rwf, expires_at, pickup, dropoff)
select ('e3720000-0000-4000-8000-00000000000' || n)::uuid, 'e3700000-0000-4000-8000-000000000001',
       (select id from public.fare_policies where vehicle_class = 'moto' limit 1), 'moto', 7000, 1200, 2400, now() + interval '2 minutes',
       st_point(30.1127, -1.9441)::geography, st_point(30.0588, -1.9536)::geography
  from generate_series(1, 3) n;

set local role authenticated;
set local request.jwt.claims to '{"sub":"e3700000-0000-4000-8000-000000000001","role":"authenticated"}';

select throws_ok($$ select public.create_trip_from_quote('e3720000-0000-4000-8000-000000000001',
    st_point(30.1127, -1.9441)::geography, 'Kimironko', null, st_point(29.74, -2.60)::geography, 'Huye') $$,
  '22023', 'route_does_not_match_quote', 'a quote for a town ride cannot book a ride to Huye');
select lives_ok($$ select public.create_trip_from_quote('e3720000-0000-4000-8000-000000000002',
    st_point(30.1129, -1.9442)::geography, 'Kimironko', null, st_point(30.0588, -1.9536)::geography, 'Kigali Heights') $$,
  'the route it was quoted for books, a few metres of GPS drift allowed');
select throws_ok($$ select public.create_recurring_schedule('e3720000-0000-4000-8000-000000000003',
    st_point(30.1127, -1.9441)::geography, 'Kimironko', null, st_point(29.74, -2.60)::geography, 'Huye',
    '{1,2,3,4,5}', '07:30', public.kigali_today() + 1, public.kigali_today() + 10) $$,
  '22023', 'route_does_not_match_quote', 'nor a month of regular rides somewhere else');

select * from finish();
rollback;
