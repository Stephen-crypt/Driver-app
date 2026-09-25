begin;
select plan(12);

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000','b1111111-0000-4000-8000-000000000001',
   'authenticated','authenticated','passenger.j@test.local'),
  ('00000000-0000-0000-0000-000000000000','b1111111-0000-4000-8000-000000000002',
   'authenticated','authenticated','rider.j@test.local');

insert into public.profiles (id, role, first_name, phone) values
  ('b1111111-0000-4000-8000-000000000001','passenger','Aline','+250788000501'),
  ('b1111111-0000-4000-8000-000000000002','rider','Eric','+250788000502');

insert into public.riders (id, verification)
values ('b1111111-0000-4000-8000-000000000002','verified');

insert into public.fare_quotes
  (id, passenger_id, policy_id, vehicle_class, distance_m, duration_s, amount_rwf, expires_at)
values
  ('b2222222-0000-4000-8000-000000000001','b1111111-0000-4000-8000-000000000001',
   (select id from public.fare_policies where vehicle_class='moto' limit 1),
   'moto', 4000, 720, 1700, now() + interval '2 minutes');

-- ---------------------------------------------------------------------------
-- The write verbs are gone, not merely unreachable.
-- ---------------------------------------------------------------------------
-- 0014 revoked INSERT once a passenger had authored their own fare through it.
-- UPDATE, DELETE and TRUNCATE were left behind, blocked only by the ABSENCE of
-- a policy - the same configuration C1 had before it bit us.
select ok(
  not has_table_privilege('authenticated', 'public.trips', 'UPDATE'),
  'authenticated holds no UPDATE on trips'
);

select ok(
  not has_table_privilege('authenticated', 'public.trips', 'DELETE'),
  'nor DELETE'
);

select ok(
  not has_table_privilege('authenticated', 'public.trips', 'TRUNCATE'),
  'nor TRUNCATE'
);

select ok(
  not has_table_privilege('anon', 'public.trips', 'UPDATE'),
  'and anon holds none of them either'
);

-- The event log is the source of truth the projection is derived from.
select ok(
  not has_table_privilege('authenticated', 'public.trip_events', 'INSERT'),
  'authenticated cannot forge a trip event'
);

select ok(
  not has_table_privilege('authenticated', 'public.trip_events', 'DELETE'),
  'nor erase one'
);

set local role authenticated;
set local request.jwt.claims to
  '{"sub":"b1111111-0000-4000-8000-000000000001","role":"authenticated"}';

select lives_ok(
  $$ select public.create_trip_from_quote(
       'b2222222-0000-4000-8000-000000000001',
       st_point(30.0619,-1.9441)::geography, 'Kimironko Market', null,
       st_point(30.0588,-1.9536)::geography, 'Kigali Heights') $$,
  'the passenger books a trip at the quoted price'
);

-- The price columns are what completion prices against, and trips_guard_state_trg
-- gates only `state`. Before this migration only the absence of an UPDATE policy
-- stopped this write.
select throws_ok(
  $$ update public.trips set quoted_amount_rwf = 100
      where passenger_id = 'b1111111-0000-4000-8000-000000000001' $$,
  '42501', null,
  'a passenger cannot rewrite the locked price on their own trip'
);

select is(
  (select quoted_amount_rwf from public.trips
    where passenger_id='b1111111-0000-4000-8000-000000000001'),
  1700,
  'and the locked price is untouched'
);

-- ---------------------------------------------------------------------------
-- And the sanctioned path still runs end to end.
-- ---------------------------------------------------------------------------
set local role postgres;
select lives_ok(
  $$ select public.assign_rider_to_trip(
       (select id from public.trips where passenger_id='b1111111-0000-4000-8000-000000000001'),
       'b1111111-0000-4000-8000-000000000002', 'offer-j1') $$,
  'dispatch still assigns a rider'
);

set local role authenticated;
set local request.jwt.claims to
  '{"sub":"b1111111-0000-4000-8000-000000000002","role":"authenticated"}';

select lives_ok(
  $$ select public.trip_transition(
       (select id from public.trips where passenger_id='b1111111-0000-4000-8000-000000000001'),
       'accepted','j-a1');
     select public.trip_transition(
       (select id from public.trips where passenger_id='b1111111-0000-4000-8000-000000000001'),
       'arrived','j-a2');
     select public.trip_transition(
       (select id from public.trips where passenger_id='b1111111-0000-4000-8000-000000000001'),
       'in_progress','j-a3');
     select public.complete_trip(
       (select id from public.trips where passenger_id='b1111111-0000-4000-8000-000000000001'),
       4100,'j-done') $$,
  'the rider still drives the trip all the way to completed'
);

select is(
  (select amount_rwf from public.ledger_entries
    where rider_id='b1111111-0000-4000-8000-000000000002' and kind='trip_earning'),
  1445,
  'and the earning is still derived by the database, not by the caller'
);

select * from finish();
rollback;
