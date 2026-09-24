begin;
select plan(10);

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000','ffffffff-0000-0000-0000-000000000001',
   'authenticated','authenticated','rider.f@test.local'),
  ('00000000-0000-0000-0000-000000000000','ffffffff-0000-0000-0000-000000000002',
   'authenticated','authenticated','driver.f@test.local'),
  ('00000000-0000-0000-0000-000000000000','ffffffff-0000-0000-0000-000000000003',
   'authenticated','authenticated','mallory.f@test.local');

insert into public.profiles (id, role, first_name, phone) values
  ('ffffffff-0000-0000-0000-000000000001','rider','Aline','+250788000301'),
  ('ffffffff-0000-0000-0000-000000000002','driver','Eric','+250788000302'),
  ('ffffffff-0000-0000-0000-000000000003','rider','Mallory','+250788000303');

insert into public.drivers (id, verification)
values ('ffffffff-0000-0000-0000-000000000002','verified');

insert into public.trips
  (id, rider_id, driver_id, vehicle_class, state, pickup, pickup_label,
   dropoff, dropoff_label, quoted_distance_m, quoted_duration_s)
values
  ('bbbbbbbb-0000-0000-0000-000000000001',
   'ffffffff-0000-0000-0000-000000000001','ffffffff-0000-0000-0000-000000000002',
   'moto','in_progress',
   st_point(30.0619,-1.9441)::geography,'Kimironko',
   st_point(30.0588,-1.9536)::geography,'Kigali Heights', 4000, 720);

set local role authenticated;
set local request.jwt.claims to
  '{"sub":"ffffffff-0000-0000-0000-000000000002","role":"authenticated"}';

select lives_ok(
  $$ select public.complete_trip('bbbbbbbb-0000-0000-0000-000000000001',
                                 4100, 1700, 255, 'complete-1') $$,
  'the driver completes the trip'
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

select is(
  (select amount_rwf from public.ledger_entries
    where trip_id='bbbbbbbb-0000-0000-0000-000000000001'),
  255,
  'the commission amount is the one the caller computed'
);

select lives_ok(
  $$ select public.complete_trip('bbbbbbbb-0000-0000-0000-000000000001',
                                 4100, 1700, 255, 'complete-1') $$,
  'replaying the completion is a no-op, not an error'
);

select is(
  (select count(*)::int from public.ledger_entries
    where trip_id='bbbbbbbb-0000-0000-0000-000000000001'),
  1,
  'a replayed completion does NOT debit commission twice'
);

-- Neither the rider nor the driver: a non-participant replaying an already-used
-- idempotency key must be refused before the idempotent early return can hand
-- back the trip row.
set local request.jwt.claims to
  '{"sub":"ffffffff-0000-0000-0000-000000000003","role":"authenticated"}';

select throws_ok(
  $$ select public.complete_trip('bbbbbbbb-0000-0000-0000-000000000001',
                                 0, 0, 0, 'complete-1') $$,
  '42501', null,
  'a non-participant replaying a used key is refused, not handed the trip row'
);

-- A participant, but the wrong one: the rider is on this trip, but only the
-- driver may complete it.
set local request.jwt.claims to
  '{"sub":"ffffffff-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$ select public.complete_trip('bbbbbbbb-0000-0000-0000-000000000001',
                                 4100, 1700, 255, 'complete-3') $$,
  '42501', null,
  'the rider cannot complete their own trip - only the driver can'
);

select throws_ok(
  $$ select public.complete_trip('bbbbbbbb-0000-0000-0000-000000000001',
                                 4100, 1000, 2000, 'complete-2') $$,
  '22023', null,
  'commission larger than the fare is refused'
);

select * from finish();
rollback;
