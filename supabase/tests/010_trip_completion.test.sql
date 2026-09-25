begin;
select plan(15);

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000','ffffffff-0000-0000-0000-000000000001',
   'authenticated','authenticated','passenger.f@test.local'),
  ('00000000-0000-0000-0000-000000000000','ffffffff-0000-0000-0000-000000000002',
   'authenticated','authenticated','rider.f@test.local'),
  ('00000000-0000-0000-0000-000000000000','ffffffff-0000-0000-0000-000000000003',
   'authenticated','authenticated','mallory.f@test.local');

insert into public.profiles (id, role, first_name, phone) values
  ('ffffffff-0000-0000-0000-000000000001','passenger','Aline','+250788000301'),
  ('ffffffff-0000-0000-0000-000000000002','rider','Eric','+250788000302'),
  ('ffffffff-0000-0000-0000-000000000003','passenger','Mallory','+250788000303');

insert into public.riders (id, verification)
values ('ffffffff-0000-0000-0000-000000000002','verified');

-- Completion prices the trip from its own quote, so the quote - and the policy
-- that priced it - are now part of the fixture rather than incidental.
insert into public.fare_quotes
  (id, passenger_id, policy_id, vehicle_class, distance_m, duration_s, amount_rwf, expires_at)
values
  ('dddddddd-0000-0000-0000-000000000001','ffffffff-0000-0000-0000-000000000001',
   (select id from public.fare_policies where vehicle_class='moto' limit 1),
   'moto', 4000, 720, 1700, now() + interval '2 minutes'),
  ('dddddddd-0000-0000-0000-000000000002','ffffffff-0000-0000-0000-000000000001',
   (select id from public.fare_policies where vehicle_class='moto' limit 1),
   'moto', 4000, 720, 1700, now() + interval '2 minutes');

insert into public.trips
  (id, passenger_id, rider_id, vehicle_class, state, pickup, pickup_label,
   dropoff, dropoff_label, quoted_distance_m, quoted_duration_s,
   quote_id, quoted_amount_rwf)
values
  ('bbbbbbbb-0000-0000-0000-000000000001',
   'ffffffff-0000-0000-0000-000000000001','ffffffff-0000-0000-0000-000000000002',
   'moto','in_progress',
   st_point(30.0619,-1.9441)::geography,'Kimironko',
   st_point(30.0588,-1.9536)::geography,'Kigali Heights', 4000, 720,
   'dddddddd-0000-0000-0000-000000000001', 1700),
  -- Same shape, used below to prove an ops rate change cannot reprice a trip
  -- that was already quoted.
  ('bbbbbbbb-0000-0000-0000-000000000002',
   'ffffffff-0000-0000-0000-000000000001','ffffffff-0000-0000-0000-000000000002',
   'moto','in_progress',
   st_point(30.0619,-1.9441)::geography,'Kimironko',
   st_point(30.0588,-1.9536)::geography,'Kigali Heights', 4000, 720,
   'dddddddd-0000-0000-0000-000000000002', 1700),
  -- A trip with no quote at all: there is no price to honour, and completion
  -- must refuse rather than invent one.
  ('bbbbbbbb-0000-0000-0000-000000000003',
   'ffffffff-0000-0000-0000-000000000001','ffffffff-0000-0000-0000-000000000002',
   'moto','in_progress',
   st_point(30.0619,-1.9441)::geography,'Kimironko',
   st_point(30.0588,-1.9536)::geography,'Kigali Heights', 4000, 720,
   null, null);

set local role authenticated;
set local request.jwt.claims to
  '{"sub":"ffffffff-0000-0000-0000-000000000002","role":"authenticated"}';

-- Three arguments, not five. The caller supplies what happened (the distance),
-- never what it costs.
select lives_ok(
  $$ select public.complete_trip('bbbbbbbb-0000-0000-0000-000000000001',
                                 4100, 'complete-1') $$,
  'the rider completes the trip'
);

select is(
  (select state::text from public.trips where id='bbbbbbbb-0000-0000-0000-000000000001'),
  'completed',
  'the trip reaches completed'
);

select is(
  (select actual_distance_m from public.trips where id='bbbbbbbb-0000-0000-0000-000000000001'),
  4100,
  'the actual distance is recorded'
);

select is(
  (select count(*)::int from public.ledger_entries
    where trip_id='bbbbbbbb-0000-0000-0000-000000000001' and kind='commission_debit'),
  1,
  'exactly one commission debit is written'
);

-- 4100m is inside the 15% band on a 4000m quote, so the total is the quoted
-- 1700 and the commission is 15% of it. Derived in SQL from the trip's own
-- locked quote - the caller had no way to say otherwise.
select is(
  (select amount_rwf from public.ledger_entries
    where trip_id='bbbbbbbb-0000-0000-0000-000000000001'),
  255,
  'the commission is derived in SQL from the locked quote, not chosen by the caller'
);

select is(
  (select (meta->>'total_rwf')::int from public.trip_events
    where trip_id='bbbbbbbb-0000-0000-0000-000000000001' and to_state='completed'),
  1700,
  'the event log records the total the database derived'
);

select is(
  (select (meta->>'commission_rwf')::int from public.trip_events
    where trip_id='bbbbbbbb-0000-0000-0000-000000000001' and to_state='completed'),
  255,
  'and the commission alongside it'
);

select lives_ok(
  $$ select public.complete_trip('bbbbbbbb-0000-0000-0000-000000000001',
                                 4100, 'complete-1') $$,
  'replaying the completion is a no-op, not an error'
);

select is(
  (select count(*)::int from public.ledger_entries
    where trip_id='bbbbbbbb-0000-0000-0000-000000000001'),
  1,
  'a replayed completion does NOT debit commission twice'
);

-- Neither the passenger nor the rider: a non-participant replaying an already-used
-- idempotency key must be refused before the idempotent early return can hand
-- back the trip row.
set local request.jwt.claims to
  '{"sub":"ffffffff-0000-0000-0000-000000000003","role":"authenticated"}';

select throws_ok(
  $$ select public.complete_trip('bbbbbbbb-0000-0000-0000-000000000001',
                                 0, 'complete-1') $$,
  '42501', null,
  'a non-participant replaying a used key is refused, not handed the trip row'
);

set local request.jwt.claims to
  '{"sub":"ffffffff-0000-0000-0000-000000000002","role":"authenticated"}';

-- The signature that let the rider author their own commission is GONE, not
-- merely discouraged: a rider completed a 1,700 RWF trip with a commission of 0
-- by calling it straight through PostgREST.
select throws_ok(
  $$ select public.complete_trip('bbbbbbbb-0000-0000-0000-000000000002',
                                 4100, 4100, 0, 'evade-1') $$,
  '42883', null,
  'the amount-taking signature no longer exists to call'
);

-- Spec 3.4: a price change never retroactively alters historical trips. Ops
-- raises the rate; the already-quoted trip must still settle at the old one.
set local role postgres;
insert into public.fare_policies
  (vehicle_class, base_rwf, per_km_rwf, per_minute_rwf, minimum_rwf,
   commission_pct, effective_from)
values ('moto', 500, 900, 22, 800, 40.00, now());

set local role authenticated;
set local request.jwt.claims to
  '{"sub":"ffffffff-0000-0000-0000-000000000002","role":"authenticated"}';

select lives_ok(
  $$ select public.complete_trip('bbbbbbbb-0000-0000-0000-000000000002',
                                 4100, 'complete-2') $$,
  'a trip quoted before a rate change still completes'
);

select is(
  (select amount_rwf from public.ledger_entries
    where trip_id='bbbbbbbb-0000-0000-0000-000000000002'),
  255,
  'it is priced under the policy it was QUOTED under (255), not today rate (680)'
);

select throws_ok(
  $$ select public.complete_trip('bbbbbbbb-0000-0000-0000-000000000003',
                                 4100, 'complete-3') $$,
  '22023', null,
  'a trip with no quote is refused rather than priced from thin air'
);

-- A participant, but the wrong one: the passenger is on this trip, but only the
-- rider may complete it.
set local request.jwt.claims to
  '{"sub":"ffffffff-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$ select public.complete_trip('bbbbbbbb-0000-0000-0000-000000000003',
                                 4100, 'complete-4') $$,
  '42501', null,
  'the passenger cannot complete their own trip - only the rider can'
);

select * from finish();
rollback;
