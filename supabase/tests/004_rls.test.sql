begin;
select plan(17);

-- Two passengers and one rider, created directly so we control the ids.
-- instance_id/aud/role are supplied explicitly: auth.users has no defaults for
-- them, and omitting them fails with a confusing not-null error.
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000',
   '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'passenger.a@test.local'),
  ('00000000-0000-0000-0000-000000000000',
   '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'passenger.b@test.local'),
  ('00000000-0000-0000-0000-000000000000',
   '33333333-3333-3333-3333-333333333333',
   'authenticated', 'authenticated', 'rider.c@test.local'),
  ('00000000-0000-0000-0000-000000000000',
   '44444444-4444-4444-4444-444444444444',
   'authenticated', 'authenticated', 'newcomer.d@test.local'),
  ('00000000-0000-0000-0000-000000000000',
   '55555555-5555-5555-5555-555555555555',
   'authenticated', 'authenticated', 'rider.e@test.local');

insert into public.profiles (id, role, first_name, phone) values
  ('11111111-1111-1111-1111-111111111111', 'passenger',  'Aline', '+250700000001'),
  ('22222222-2222-2222-2222-222222222222', 'passenger',  'Bosco', '+250700000002'),
  ('33333333-3333-3333-3333-333333333333', 'rider', 'Eric',  '+250700000003'),
  ('55555555-5555-5555-5555-555555555555', 'rider', 'Fidele','+250700000005');

insert into public.riders (id, verification) values
  ('33333333-3333-3333-3333-333333333333', 'verified'),
  ('55555555-5555-5555-5555-555555555555', 'submitted');

insert into public.trips
  (id, passenger_id, vehicle_class, state, pickup, pickup_label, dropoff, dropoff_label)
values (
  'aaaaaaaa-0000-0000-0000-000000000001',
  '11111111-1111-1111-1111-111111111111',
  'moto',
  'requested',
  st_point(30.0619, -1.9441)::geography, 'Kimironko Market',
  st_point(30.0588, -1.9536)::geography, 'Kigali Heights'
);

-- A fleet rider is dispatchable with a vehicle, not a float.
insert into public.vehicles (rider_id, class, plate, is_active)
values ('33333333-3333-3333-3333-333333333333', 'moto', 'RAR 331A', true);

-- One ledger row each for two different riders. Asserting "the rider sees one
-- row" only means something when there is a second row they must NOT see;
-- against a single-row table the same assertion passes with no RLS at all.
insert into public.ledger_entries (rider_id, kind, amount_rwf) values
  ('33333333-3333-3333-3333-333333333333', 'fare_collected', 1700),
  ('55555555-5555-5555-5555-555555555555', 'fare_collected', 2100);

-- Act as passenger A.
set local role authenticated;
set local request.jwt.claims to
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is(
  (select count(*)::int from public.trips),
  1,
  'passenger A sees their own trip'
);

select is(
  (select count(*)::int from public.profiles
    where id = '22222222-2222-2222-2222-222222222222'),
  0,
  'passenger A cannot read passenger B profile'
);

select is(
  (select count(*)::int from public.profiles
    where id = '33333333-3333-3333-3333-333333333333'),
  0,
  'passenger A cannot read the rider profile before a trip is accepted'
);

-- This asserted a lives_ok until 0015: RLS denies an UPDATE by making the row
-- invisible rather than by raising, so the statement used to succeed and touch
-- nothing. That was a true description of the system until the UPDATE privilege
-- itself was revoked, and the privilege check runs BEFORE RLS is consulted - so
-- the denial now happens a layer earlier and loudly. A test asserting an
-- obsolete truth is worse than no test. The partner assertion below is the one
-- that always mattered, and it is unchanged.
select throws_ok(
  $$ update public.trips set state = 'completed'
      where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  '42501', null,
  'a direct state update is refused at the privilege layer'
);

select is(
  (select state::text from public.trips
    where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'requested',
  'but trips.state is unchanged - only trip_transition() can move it'
);

select throws_ok(
  $$ insert into public.ledger_entries (rider_id, kind, amount_rwf)
     values ('33333333-3333-3333-3333-333333333333', 'topup_credit', 999999) $$,
  '42501',
  null,
  'no client can mint ledger entries'
);

-- Both inserts below are now refused at the GRANT layer rather than by a policy:
-- 0014 revoked INSERT on trips from anon and authenticated outright, because the
-- policy could only ever constrain the columns someone remembered to name, and
-- the price columns added in Task 7 were never added to it. 011 covers that
-- directly; these two stay because the properties they assert must hold however
-- the table is protected.
select throws_ok(
  $$ insert into public.trips
       (passenger_id, vehicle_class, state, pickup, pickup_label, dropoff, dropoff_label)
     values ('11111111-1111-1111-1111-111111111111', 'moto', 'completed',
             st_point(30.0619, -1.9441)::geography, 'A',
             st_point(30.0588, -1.9536)::geography, 'B') $$,
  '42501', null,
  'a passenger cannot insert a trip that is already completed'
);

select throws_ok(
  $$ insert into public.trips
       (passenger_id, rider_id, vehicle_class, state, pickup, pickup_label, dropoff, dropoff_label)
     values ('11111111-1111-1111-1111-111111111111',
             '33333333-3333-3333-3333-333333333333', 'moto', 'requested',
             st_point(30.0619, -1.9441)::geography, 'A',
             st_point(30.0588, -1.9536)::geography, 'B') $$,
  '42501', null,
  'a passenger cannot self-assign a rider, bypassing dispatch'
);

select throws_ok(
  $$ insert into public.trip_transition_rules (from_state, to_state, actor)
     values ('requested', 'completed', 'passenger') $$,
  '42501', null,
  'a client cannot rewrite the trip state machine rules'
);

-- Act as passenger B.
set local request.jwt.claims to
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select is(
  (select count(*)::int from public.trips),
  0,
  'passenger B cannot see passenger A trips'
);

-- Privilege escalation: ownership alone is not enough on the riders table.
select throws_ok(
  $$ insert into public.riders (id, verification)
     values ('22222222-2222-2222-2222-222222222222', 'verified') $$,
  '42501',
  null,
  'a user cannot register themselves as an already-verified rider'
);

-- Act as the rider, who has not been offered this trip.
set local request.jwt.claims to
  '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

select is(
  (select count(*)::int from public.trips),
  0,
  'a rider cannot see a trip they were never offered'
);

select is(
  (select count(*)::int from public.ledger_entries),
  1,
  'a rider reads their own ledger row and not the other rider''s'
);

select is(
  (select count(*)::int from public.profiles
    where id = '11111111-1111-1111-1111-111111111111'),
  0,
  'a rider cannot read passenger contact details before accepting'
);

-- A verified rider may go online: this is the control for the denial below.
select lives_ok(
  $$ insert into public.rider_presence (rider_id, status, vehicle_class, position)
     values ('33333333-3333-3333-3333-333333333333', 'online', 'moto',
             st_point(30.0619, -1.9441)::geography) $$,
  'a verified rider may enter the dispatch index'
);

-- Act as a rider whose paperwork is only submitted.
set local request.jwt.claims to
  '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}';

-- Ownership alone would let an unvetted rider into
-- rider_presence_dispatchable_idx, which is exactly what dispatch matches on.
select throws_ok(
  $$ insert into public.rider_presence (rider_id, status, vehicle_class, position)
     values ('55555555-5555-5555-5555-555555555555', 'online', 'moto',
             st_point(30.0619, -1.9441)::geography) $$,
  '42501', null,
  'an unverified rider cannot enter the dispatch index'
);

-- Act as a brand-new user with no profile row yet.
set local request.jwt.claims to
  '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';

select throws_ok(
  $$ insert into public.profiles (id, role, first_name, phone)
     values ('44444444-4444-4444-4444-444444444444', 'ops', 'Mallory', '+250700000004') $$,
  '42501', null,
  'a new user cannot register themselves as ops'
);

select * from finish();
rollback;
