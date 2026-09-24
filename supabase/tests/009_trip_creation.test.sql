begin;
select plan(8);

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000','cccccccc-0000-0000-0000-000000000001',
   'authenticated','authenticated','rider.c@test.local'),
  ('00000000-0000-0000-0000-000000000000','cccccccc-0000-0000-0000-000000000002',
   'authenticated','authenticated','rider.d@test.local'),
  ('00000000-0000-0000-0000-000000000000','cccccccc-0000-0000-0000-000000000003',
   'authenticated','authenticated','driver.e@test.local');

insert into public.profiles (id, role, first_name, phone) values
  ('cccccccc-0000-0000-0000-000000000001','rider','Aline','+250788000201'),
  ('cccccccc-0000-0000-0000-000000000002','rider','Bosco','+250788000202'),
  ('cccccccc-0000-0000-0000-000000000003','driver','Eric','+250788000203');

insert into public.drivers (id, verification)
values ('cccccccc-0000-0000-0000-000000000003','verified');

insert into public.fare_quotes
  (id, rider_id, policy_id, vehicle_class, distance_m, duration_s, amount_rwf, expires_at)
values
  ('eeeeeeee-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001',
   (select id from public.fare_policies where vehicle_class='moto' limit 1),
   'moto', 4000, 720, 1700, now() + interval '2 minutes'),
  ('eeeeeeee-0000-0000-0000-000000000002','cccccccc-0000-0000-0000-000000000001',
   (select id from public.fare_policies where vehicle_class='moto' limit 1),
   'moto', 4000, 720, 1700, now() - interval '1 second');

set local role authenticated;
set local request.jwt.claims to
  '{"sub":"cccccccc-0000-0000-0000-000000000001","role":"authenticated"}';

select lives_ok(
  $$ select public.create_trip_from_quote(
       'eeeeeeee-0000-0000-0000-000000000001',
       st_point(30.0619,-1.9441)::geography, 'Kimironko Market', 'blue gate',
       st_point(30.0588,-1.9536)::geography, 'Kigali Heights') $$,
  'a rider creates a trip from their own live quote'
);

select is(
  (select state::text from public.trips
    where rider_id = 'cccccccc-0000-0000-0000-000000000001' limit 1),
  'requested',
  'a new trip starts in requested'
);

select is(
  (select quoted_distance_m from public.trips
    where rider_id = 'cccccccc-0000-0000-0000-000000000001' limit 1),
  4000,
  'the quoted distance is carried onto the trip'
);

-- Without this the trip cannot recover its own locked price at completion.
select is(
  (select quoted_amount_rwf from public.trips
    where rider_id = 'cccccccc-0000-0000-0000-000000000001' limit 1),
  1700,
  'the locked fare is carried onto the trip, not re-derived later'
);

select throws_ok(
  $$ select public.create_trip_from_quote(
       'eeeeeeee-0000-0000-0000-000000000002',
       st_point(30.0619,-1.9441)::geography, 'A', null,
       st_point(30.0588,-1.9536)::geography, 'B') $$,
  '22023', null,
  'an expired quote is refused rather than honoured'
);

set local request.jwt.claims to
  '{"sub":"cccccccc-0000-0000-0000-000000000002","role":"authenticated"}';

select throws_ok(
  $$ select public.create_trip_from_quote(
       'eeeeeeee-0000-0000-0000-000000000001',
       st_point(30.0619,-1.9441)::geography, 'A', null,
       st_point(30.0588,-1.9536)::geography, 'B') $$,
  '42501', null,
  'a rider cannot create a trip from someone else quote'
);

select ok(
  not has_function_privilege('authenticated',
    'public.assign_driver_to_trip(uuid,uuid,text)', 'EXECUTE'),
  'a rider cannot assign themselves a driver'
);

select ok(
  has_function_privilege('service_role',
    'public.assign_driver_to_trip(uuid,uuid,text)', 'EXECUTE'),
  'the dispatcher can assign a driver'
);

select * from finish();
rollback;
