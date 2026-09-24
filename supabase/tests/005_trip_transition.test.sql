begin;
select plan(20);

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

-- A second trip, still unassigned, for the system edges. requested -> offered
-- is dispatch's first move and has no human actor at all.
insert into public.trips
  (id, rider_id, vehicle_class, state,
   pickup, pickup_label, dropoff, dropoff_label)
values (
  'aaaaaaaa-0000-0000-0000-000000000002',
  '11111111-1111-1111-1111-111111111111',
  'moto',
  'requested',
  st_point(30.0619, -1.9441)::geography, 'Kimironko Market',
  st_point(30.0588, -1.9536)::geography, 'Kigali Heights'
);

-- A third trip, never transitioned, reserved for the projection guard. Its
-- timestamps are seeded stale on purpose: now() is frozen for the whole
-- transaction, so a freshly inserted row could not show updated_at advancing.
insert into public.trips
  (id, rider_id, vehicle_class, state,
   pickup, pickup_label, dropoff, dropoff_label, created_at, updated_at)
values (
  'aaaaaaaa-0000-0000-0000-000000000003',
  '11111111-1111-1111-1111-111111111111',
  'moto',
  'requested',
  st_point(30.0619, -1.9441)::geography, 'Kimironko Market',
  st_point(30.0588, -1.9536)::geography, 'Kigali Heights',
  timestamptz '2000-01-01 00:00:00+00',
  timestamptz '2000-01-01 00:00:00+00'
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

-- Back to the superuser session the test harness starts in. Everything below
-- runs at service-role-equivalent privilege on purpose: RLS is not the boundary
-- under test here, and RLS would hide the failures rather than show them - a
-- denied UPDATE matches zero rows and raises nothing, so a guard that never
-- fired would look identical to a guard that worked.
reset role;

-- 9. A system edge is reachable at all. Before trip_transition_system() the
--    four dispatch edges had no sanctioned caller, because trip_transition()
--    derives its actor from auth.uid() and can only ever produce rider/driver.
select is(
  (select state::text from public.trip_transition_system(
     'aaaaaaaa-0000-0000-0000-000000000002', 'offered', 'key-dispatch-1')),
  'offered',
  'dispatch can move requested -> offered as the system actor'
);

select is(
  (select state::text from public.trips
    where id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  'offered',
  'and the projection on trips moved with it'
);

-- 10. The journal records a non-person. actor_id stays null because
--     trip_events.actor_id references profiles and dispatch has no row there;
--     a dispatcher run id belongs in meta. Aggregating rather than counting
--     asserts BOTH that there is exactly one row and what is in it.
select is(
  (select array_agg(actor::text || ':' || coalesce(actor_id::text, 'null'))
     from public.trip_events
    where trip_id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  array['system:null'],
  'exactly one event, journalled as system with no actor_id'
);

-- 11. Idempotency has to hold here at least as strongly as on the human path:
--     a dispatcher retrying after a dropped response is the common case, not
--     the exceptional one.
select lives_ok(
  $$ select public.trip_transition_system(
       'aaaaaaaa-0000-0000-0000-000000000002', 'offered', 'key-dispatch-1') $$,
  'replaying a system idempotency key does not raise'
);

select is(
  (select count(*)::int from public.trip_events
    where trip_id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  1,
  'and the replay writes no second trip_events row'
);

-- 12. The rule table binds the system actor exactly as it binds the others.
--     requested -> completed is nobody's edge, service_role included.
select throws_ok(
  $$ select public.trip_transition_system(
       'aaaaaaaa-0000-0000-0000-000000000003', 'completed', 'key-dispatch-2') $$,
  '23514', null,
  'the system actor is bound by the rule table like any other'
);

-- 13. Who may drive a system edge. This is the whole reason the system actor is
--     a separate function rather than a parameter on trip_transition(): with no
--     actor argument there is no branch for a caller to steer, so the only
--     remaining lever is EXECUTE, and EXECUTE is what these three assert.
select ok(
  not has_function_privilege(
    'authenticated',
    'public.trip_transition_system(uuid,trip_state,text,jsonb)', 'EXECUTE'),
  'no signed-in user may drive a system edge'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.trip_transition_system(uuid,trip_state,text,jsonb)', 'EXECUTE'),
  'and certainly no unauthenticated caller'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.trip_transition_system(uuid,trip_state,text,jsonb)', 'EXECUTE'),
  'service_role, which dispatch runs as, can'
);

-- 14. The projection guard. trips.state is documented as derivable from the
--     event log, but RLS alone never enforced that: service_role bypasses RLS,
--     and dispatch and the ops console both run as service_role. This is the
--     assertion that makes the invariant structural rather than customary.
--
--     It doubles as proof that both transition functions put the in_transition
--     flag back after their update: set_config's transaction scope means a flag
--     left raised by assertion 9 above would still be raised here, and this
--     would not throw.
select throws_ok(
  $$ update public.trips set state = 'completed'
      where id = 'aaaaaaaa-0000-0000-0000-000000000003' $$,
  '42501', null,
  'a direct state write is refused even at service-role privilege'
);

-- 15. And it must not over-fire. Completion writes actual_distance_m through an
--     ordinary update; a guard that blocked every write to trips would just
--     move the problem.
select lives_ok(
  $$ update public.trips set actual_distance_m = 4200
      where id = 'aaaaaaaa-0000-0000-0000-000000000003' $$,
  'an update that leaves state alone is untouched by the guard'
);

-- 16. The same trigger maintains updated_at, which nothing had been doing.
--     The row was seeded with a stale timestamp because now() is frozen for the
--     transaction: comparing against a fresh insert would compare now() to now().
select cmp_ok(
  (select updated_at from public.trips
    where id = 'aaaaaaaa-0000-0000-0000-000000000003'),
  '>',
  timestamptz '2000-01-02 00:00:00+00',
  'and it refreshes updated_at, which previously went stale'
);

select * from finish();
rollback;
