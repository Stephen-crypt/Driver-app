begin;
select plan(13);

-- Two passengers, three riders: two verified (so an offer can be replayed with a
-- DIFFERENT rider) and one only submitted.
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000','a1111111-0000-4000-8000-000000000001',
   'authenticated','authenticated','passenger.g@test.local'),
  ('00000000-0000-0000-0000-000000000000','a1111111-0000-4000-8000-000000000002',
   'authenticated','authenticated','rider.g@test.local'),
  ('00000000-0000-0000-0000-000000000000','a1111111-0000-4000-8000-000000000003',
   'authenticated','authenticated','rider.h@test.local'),
  ('00000000-0000-0000-0000-000000000000','a1111111-0000-4000-8000-000000000004',
   'authenticated','authenticated','rider.i@test.local');

insert into public.profiles (id, role, first_name, phone) values
  ('a1111111-0000-4000-8000-000000000001','passenger','Aline','+250788000401'),
  ('a1111111-0000-4000-8000-000000000002','rider','Eric','+250788000402'),
  ('a1111111-0000-4000-8000-000000000003','rider','Fidele','+250788000403'),
  ('a1111111-0000-4000-8000-000000000004','rider','Gilbert','+250788000404');

insert into public.riders (id, verification) values
  ('a1111111-0000-4000-8000-000000000002','verified'),
  ('a1111111-0000-4000-8000-000000000003','verified'),
  ('a1111111-0000-4000-8000-000000000004','submitted');

insert into public.fare_quotes
  (id, passenger_id, policy_id, vehicle_class, distance_m, duration_s, amount_rwf, expires_at)
values
  ('a2222222-0000-4000-8000-000000000001','a1111111-0000-4000-8000-000000000001',
   (select id from public.fare_policies where vehicle_class='moto' limit 1),
   'moto', 4000, 720, 1700, now() + interval '2 minutes');

-- ---------------------------------------------------------------------------
-- C1: a passenger cannot author their own fare.
-- ---------------------------------------------------------------------------
-- The privilege is gone, so this is checked at the grant layer rather than by
-- enumerating which columns a policy would have had to constrain.
select ok(
  not has_table_privilege('authenticated', 'public.trips', 'INSERT'),
  'authenticated holds no INSERT on trips - create_trip_from_quote is the only door'
);

select ok(
  not has_table_privilege('anon', 'public.trips', 'INSERT'),
  'and neither does anon'
);

-- A policy nothing can reach is a lie about how the table is protected.
select is(
  (select count(*)::int from pg_policies
    where schemaname='public' and tablename='trips' and policyname='trips_insert_passenger'),
  0,
  'the unreachable trips_insert_passenger policy is dropped, not left as decoration'
);

set local role authenticated;
set local request.jwt.claims to
  '{"sub":"a1111111-0000-4000-8000-000000000001","role":"authenticated"}';

-- The live exploit, verbatim: a passenger JWT writing its own price, with no quote.
select throws_ok(
  $$ insert into public.trips
       (passenger_id, vehicle_class, state, pickup, pickup_label, dropoff,
        dropoff_label, quoted_distance_m, quoted_amount_rwf)
     values ('a1111111-0000-4000-8000-000000000001','moto','requested',
             st_point(30.06,-1.94)::geography,'A',
             st_point(30.05,-1.95)::geography,'B', 4000, 100) $$,
  '42501', null,
  'a passenger cannot insert a trip priced at a number they chose'
);

-- The sanctioned door still opens for that same passenger.
select lives_ok(
  $$ select public.create_trip_from_quote(
       'a2222222-0000-4000-8000-000000000001',
       st_point(30.0619,-1.9441)::geography, 'Kimironko Market', 'blue gate',
       st_point(30.0588,-1.9536)::geography, 'Kigali Heights') $$,
  'create_trip_from_quote still works for that same passenger'
);

select is(
  (select quoted_amount_rwf from public.trips
    where passenger_id='a1111111-0000-4000-8000-000000000001'),
  1700,
  'and the price on the trip is the quoted one'
);

-- ---------------------------------------------------------------------------
-- I3: one quote prices exactly one trip.
-- ---------------------------------------------------------------------------
-- Without the unique index a passenger spends the same quote N times inside its
-- 120s TTL, and the price lock stops being a lock.
select throws_ok(
  $$ select public.create_trip_from_quote(
       'a2222222-0000-4000-8000-000000000001',
       st_point(30.0619,-1.9441)::geography, 'Kimironko Market', null,
       st_point(30.0588,-1.9536)::geography, 'Kigali Heights') $$,
  '23505', null,
  'the same quote cannot be spent on a second trip'
);

-- ---------------------------------------------------------------------------
-- I4: assigning a rider is idempotent, and says who was assigned.
-- ---------------------------------------------------------------------------
set local role postgres;

select lives_ok(
  $$ select public.assign_rider_to_trip(
       (select id from public.trips where passenger_id='a1111111-0000-4000-8000-000000000001'),
       'a1111111-0000-4000-8000-000000000002', 'offer-1') $$,
  'dispatch assigns a verified rider'
);

select is(
  (select state::text from public.trips
    where passenger_id='a1111111-0000-4000-8000-000000000001'),
  'offered',
  'the trip moves to offered'
);

-- The offer log has to answer "who was offered this trip"; before this fix the
-- meta was {} and the event named nobody.
-- Scoped to THIS trip: idempotency keys are unique per trip, not globally, and
-- `pnpm e2e` leaves its own 'offer-1' rows behind in the same local database.
select is(
  (select meta->>'rider_id' from public.trip_events
    where trip_id = (select id from public.trips
                      where passenger_id='a1111111-0000-4000-8000-000000000001')
      and idempotency_key='offer-1' and to_state='offered'),
  'a1111111-0000-4000-8000-000000000002',
  'the event records which rider was offered the trip'
);

-- The dispatcher retries. A retry must be a no-op, not a silent reassignment:
-- 0012 wrote rider_id before delegating to trip_transition_system(), whose own
-- replay check then returned early, so the second call handed the trip to a
-- different rider and logged nothing.
select lives_ok(
  $$ select public.assign_rider_to_trip(
       (select id from public.trips where passenger_id='a1111111-0000-4000-8000-000000000001'),
       'a1111111-0000-4000-8000-000000000003', 'offer-1') $$,
  'a replayed offer key is accepted as a no-op'
);

select is(
  (select rider_id::text from public.trips
    where passenger_id='a1111111-0000-4000-8000-000000000001'),
  'a1111111-0000-4000-8000-000000000002',
  'a replayed key does NOT hand the trip to the second rider'
);

select throws_ok(
  $$ select public.assign_rider_to_trip(
       (select id from public.trips where passenger_id='a1111111-0000-4000-8000-000000000001'),
       'a1111111-0000-4000-8000-000000000004', 'offer-2') $$,
  '42501', null,
  'an unverified rider is refused an offer'
);

select * from finish();
rollback;
