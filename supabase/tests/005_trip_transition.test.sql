begin;
select plan(8);

-- trip_transition() is the branch's headline invariant: the only sanctioned way
-- a trip's state may move. It is security definer and owned by a role that
-- bypasses RLS, so both its idempotency behaviour and its actor guard are
-- security properties, not conveniences.
--
-- instance_id/aud/role are supplied explicitly: auth.users has no defaults for
-- them, and omitting them fails with a confusing not-null error.
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000',
   '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'rider.a@test.local'),
  ('00000000-0000-0000-0000-000000000000',
   '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'stranger.b@test.local'),
  ('00000000-0000-0000-0000-000000000000',
   '33333333-3333-3333-3333-333333333333',
   'authenticated', 'authenticated', 'driver.c@test.local');

insert into public.profiles (id, role, first_name, phone) values
  ('11111111-1111-1111-1111-111111111111', 'rider',  'Aline', '+250700000001'),
  ('22222222-2222-2222-2222-222222222222', 'rider',  'Bosco', '+250700000002'),
  ('33333333-3333-3333-3333-333333333333', 'driver', 'Eric',  '+250700000003');

insert into public.drivers (id, verification) values
  ('33333333-3333-3333-3333-333333333333', 'verified');

-- An offered trip with the driver already attached: the edge under test is
-- offered -> accepted by the driver.
insert into public.trips
  (id, rider_id, driver_id, vehicle_class, state,
   pickup, pickup_label, pickup_note, dropoff, dropoff_label)
values (
  'aaaaaaaa-0000-0000-0000-000000000001',
  '11111111-1111-1111-1111-111111111111',
  '33333333-3333-3333-3333-333333333333',
  'moto',
  'offered',
  st_point(30.0619, -1.9441)::geography, 'Kimironko Market',
  'blue gate opposite the pharmacy',
  st_point(30.0588, -1.9536)::geography, 'Kigali Heights'
);

-- Act as the driver who was offered the trip.
set local role authenticated;
set local request.jwt.claims to
  '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

-- 1. A legal transition succeeds and reports the new state.
select is(
  (select state::text from public.trip_transition(
     'aaaaaaaa-0000-0000-0000-000000000001', 'accepted', 'key-accept-1')),
  'accepted',
  'the driver accepts the offered trip'
);

-- 2. The projection on trips actually moved.
select is(
  (select state::text from public.trips
    where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'accepted',
  'trips.state moved to accepted'
);

-- 3. Exactly one event was journalled for that accepted transition.
select is(
  (select count(*)::int from public.trip_events
    where trip_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  1,
  'exactly one trip_events row per accepted transition'
);

-- 4. Replaying the same key is a no-op, not an error. A retry after a dropped
--    response must not double-journal.
select lives_ok(
  $$ select public.trip_transition(
       'aaaaaaaa-0000-0000-0000-000000000001', 'accepted', 'key-accept-1') $$,
  'replaying the same idempotency key does not raise'
);

select is(
  (select count(*)::int from public.trip_events
    where trip_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  1,
  'and the replay writes no second trip_events row'
);

-- 5. A fresh key on an illegal edge is still refused: accepted -> completed
--    skips arrived and in_progress.
select throws_ok(
  $$ select public.trip_transition(
       'aaaaaaaa-0000-0000-0000-000000000001', 'completed', 'key-skip-2') $$,
  '23514', null,
  'a fresh key cannot buy an illegal edge'
);

-- Act as a user who is neither the rider nor the driver on this trip.
set local request.jwt.claims to
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

-- 6. The actor guard must run BEFORE the idempotent early return. Using a key
--    that already exists on the trip is the regression guard: if the replay
--    check came first, this would RETURN the whole trips row - rider_id,
--    driver_id, pickup/dropoff geography and the pickup_note - to a stranger.
select throws_ok(
  $$ select public.trip_transition(
       'aaaaaaaa-0000-0000-0000-000000000001', 'arrived', 'key-accept-1') $$,
  '42501', null,
  'a non-participant is refused even on a replayed key, and gets no trip data'
);

-- Back to the driver to read the journal under a policy that permits it.
set local request.jwt.claims to
  '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

select is(
  (select count(*)::int from public.trip_events
    where trip_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  1,
  'the refused calls journalled nothing'
);

select * from finish();
rollback;
