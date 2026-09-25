-- The offer CHAIN: what happens after an offer lapses. 0019 only proved the
-- sweeper marks an offer timed_out; nothing proved the trip it belonged to ever
-- moved again, and it did not - the trip sat in `offered` with no live offer and
-- its driver, still attached, was excluded from every future match.
begin;
select plan(26);

-- Three verified, funded, online motos at 100m, 200m and 300m from one pickup,
-- so "the next candidate" has an unambiguous answer. D4 is a cab 5km away: far
-- enough and wrong enough in class never to enter moto matching, which leaves it
-- free to carry the presence-policy case at the bottom.
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000','a0000000-0000-4000-8000-000000000001',
   'authenticated','authenticated','c.rider@test.local'),
  ('00000000-0000-0000-0000-000000000000','a0000000-0000-4000-8000-000000000002',
   'authenticated','authenticated','c.driver1@test.local'),
  ('00000000-0000-0000-0000-000000000000','a0000000-0000-4000-8000-000000000003',
   'authenticated','authenticated','c.driver2@test.local'),
  ('00000000-0000-0000-0000-000000000000','a0000000-0000-4000-8000-000000000004',
   'authenticated','authenticated','c.driver3@test.local'),
  ('00000000-0000-0000-0000-000000000000','a0000000-0000-4000-8000-000000000005',
   'authenticated','authenticated','c.driver4@test.local');

insert into public.profiles (id, role, first_name, phone) values
  ('a0000000-0000-4000-8000-000000000001','rider','Aline','+250788970001'),
  ('a0000000-0000-4000-8000-000000000002','driver','Eric','+250788970002'),
  ('a0000000-0000-4000-8000-000000000003','driver','Jean','+250788970003'),
  ('a0000000-0000-4000-8000-000000000004','driver','Paul','+250788970004'),
  ('a0000000-0000-4000-8000-000000000005','driver','Mid','+250788970005');

insert into public.drivers (id, verification) values
  ('a0000000-0000-4000-8000-000000000002','verified'),
  ('a0000000-0000-4000-8000-000000000003','verified'),
  ('a0000000-0000-4000-8000-000000000004','verified'),
  ('a0000000-0000-4000-8000-000000000005','verified');

insert into public.ledger_entries (driver_id, kind, amount_rwf) values
  ('a0000000-0000-4000-8000-000000000002','topup_credit',5000),
  ('a0000000-0000-4000-8000-000000000003','topup_credit',5000),
  ('a0000000-0000-4000-8000-000000000004','topup_credit',5000),
  -- Above the 500 minimum now; a commission debit takes it under, mid-shift.
  ('a0000000-0000-4000-8000-000000000005','topup_credit',600);

insert into public.driver_presence (driver_id, status, vehicle_class, position, heartbeat_at) values
  ('a0000000-0000-4000-8000-000000000002','online','moto',st_point(30.0628,-1.9441)::geography, now()),
  ('a0000000-0000-4000-8000-000000000003','online','moto',st_point(30.0637,-1.9441)::geography, now()),
  ('a0000000-0000-4000-8000-000000000004','online','moto',st_point(30.0646,-1.9441)::geography, now());

insert into public.trips (id, rider_id, vehicle_class, state,
                          pickup, pickup_label, dropoff, dropoff_label) values
  -- T1: the chain.
  ('a1000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001',
   'moto','requested', st_point(30.0619,-1.9441)::geography,'Kimironko',
   st_point(30.0588,-1.9536)::geography,'Heights'),
  -- T2: a class nobody drives, so the candidate set is genuinely empty.
  ('a1000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000001',
   'cab_xl','requested', st_point(30.0619,-1.9441)::geography,'Kimironko',
   st_point(30.0588,-1.9536)::geography,'Heights'),
  -- T3: candidates exist; the attempt bound is what must stop it.
  ('a1000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000001',
   'moto','requested', st_point(30.0619,-1.9441)::geography,'Kimironko',
   st_point(30.0588,-1.9536)::geography,'Heights'),
  -- T4: the second trip in the double-booking race.
  ('a1000000-0000-4000-8000-000000000004','a0000000-0000-4000-8000-000000000001',
   'moto','requested', st_point(30.0619,-1.9441)::geography,'Kimironko',
   st_point(30.0588,-1.9536)::geography,'Heights'),
  -- T5: carries the decline-an-expired-offer case.
  ('a1000000-0000-4000-8000-000000000005','a0000000-0000-4000-8000-000000000001',
   'moto','requested', st_point(30.0619,-1.9441)::geography,'Kimironko',
   st_point(30.0588,-1.9536)::geography,'Heights');

-- ---------------------------------------------------------------------------
-- The chain: a lapsed offer advances to the next candidate.
-- ---------------------------------------------------------------------------
-- The first offer the way supabase/functions/dispatch makes it: rank 1, with a
-- real ETA, to the nearest driver.
select public.create_trip_offer('a1000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000002', 1, 40, 15, 'offer-t1-1');

-- Backdated rather than slept through: the sweeper reads expires_at, and a test
-- that waits fifteen seconds is a test nobody runs.
update public.trip_offers set expires_at = now() - interval '1 second'
 where trip_id = 'a1000000-0000-4000-8000-000000000001';

select is(public.expire_stale_offers(), 1,
  'the sweeper still reports the number of offers it expired');

select is(
  (select outcome from public.trip_offers
    where trip_id='a1000000-0000-4000-8000-000000000001' and rank = 1),
  'timed_out',
  'the lapsed offer is marked timed_out');

select is(
  (select count(*)::int from public.trip_offers
    where trip_id='a1000000-0000-4000-8000-000000000001' and outcome is null),
  1,
  'and the trip now holds a NEW live offer instead of none at all');

select is(
  (select driver_id from public.trip_offers
    where trip_id='a1000000-0000-4000-8000-000000000001' and outcome is null),
  'a0000000-0000-4000-8000-000000000003'::uuid,
  'which went to the next nearest candidate, not the driver who ignored it');

select is(
  (select rank from public.trip_offers
    where trip_id='a1000000-0000-4000-8000-000000000001' and outcome is null),
  2,
  'the rank increments: this is the second offer made for this trip');

select is(
  (select driver_id from public.trips where id='a1000000-0000-4000-8000-000000000001'),
  'a0000000-0000-4000-8000-000000000003'::uuid,
  'trips.driver_id follows the offer instead of staying on the ignored driver');

select is(
  (select state::text from public.trips where id='a1000000-0000-4000-8000-000000000001'),
  'offered',
  'and the trip is still offered, to somebody who can actually see it');

-- The half of C1 that hurt the driver rather than the rider: while the trip kept
-- driver_id pointed at them, find_candidate_drivers counted them as committed,
-- so they were excluded from EVERY future match, permanently.
select ok(
  exists (
    select 1 from public.find_candidate_drivers(
      st_point(30.0619,-1.9441)::geography, 'moto', 2000, 10)
     where driver_id = 'a0000000-0000-4000-8000-000000000002'
  ),
  'the driver who let the offer lapse is matchable again');

-- ---------------------------------------------------------------------------
-- Termination: both ways out.
-- ---------------------------------------------------------------------------
select ok(
  public.offer_next_candidate('a1000000-0000-4000-8000-000000000002') is null,
  'a trip with no candidate at all gets no offer back');

select is(
  (select state::text from public.trips where id='a1000000-0000-4000-8000-000000000002'),
  'no_drivers',
  'and reaches no_drivers rather than waiting forever');

update public.trips set dispatch_attempts = 3
 where id = 'a1000000-0000-4000-8000-000000000003';

select ok(
  public.offer_next_candidate('a1000000-0000-4000-8000-000000000003') is null,
  'a trip past the attempt bound gets no offer back');

select is(
  (select state::text from public.trips where id='a1000000-0000-4000-8000-000000000003'),
  'no_drivers',
  'and reaches no_drivers even though candidates were still available');

select ok(
  not has_function_privilege('authenticated', 'public.offer_next_candidate(uuid)', 'EXECUTE'),
  'a driver cannot advance a trip to the next candidate themselves');

-- ---------------------------------------------------------------------------
-- C2: one live offer per DRIVER.
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_indexes
    where schemaname='public' and indexname='trip_offers_one_live_per_driver'),
  1,
  'the per-driver partial unique index exists');

-- Driver 2 is holding T1's live offer. Offering them a second trip is exactly
-- what concurrent dispatch used to do - and then the driver could accept both.
select throws_ok(
  $$ select public.create_trip_offer('a1000000-0000-4000-8000-000000000004',
       'a0000000-0000-4000-8000-000000000003', 1, 40, 15, 'offer-t4-1') $$,
  '42501', null,
  'a driver already holding a live offer cannot be offered a second trip');

select is(
  (select count(*)::int from public.trip_offers
    where driver_id='a0000000-0000-4000-8000-000000000003' and outcome is null),
  1,
  'and the refusal leaves the first offer untouched');

select is(
  (select state::text from public.trips where id='a1000000-0000-4000-8000-000000000004'),
  'requested',
  'the losing trip is not half-assigned either');

-- ---------------------------------------------------------------------------
-- The sweep interval and the offer TTL are no longer related only by a comment.
-- ---------------------------------------------------------------------------
select ok(
  (select schedule from cron.job where jobname = 'gera-expire-stale-offers')::interval
    < public.offer_ttl_seconds() * interval '1 second',
  'the sweeper runs strictly more often than an offer lives, so no offer outlives its window');

-- ---------------------------------------------------------------------------
-- decline_offer will not accept a lapsed offer as a decline.
-- ---------------------------------------------------------------------------
select public.create_trip_offer('a1000000-0000-4000-8000-000000000005',
  'a0000000-0000-4000-8000-000000000004', 1, 60, 15, 'offer-t5-1');

update public.trip_offers set expires_at = now() - interval '1 second'
 where trip_id = 'a1000000-0000-4000-8000-000000000005';

set local role authenticated;
set local request.jwt.claims to
  '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}';

-- Recording 'declined' here would say the driver refused the trip when in fact
-- the window had already closed on them - the reliability signal inverted.
select throws_ok(
  $$ select public.decline_offer(
       (select id from public.trip_offers
         where trip_id='a1000000-0000-4000-8000-000000000005')) $$,
  '42501', null,
  'an offer whose window has closed cannot be declined, only timed out');

-- ---------------------------------------------------------------------------
-- I1: driver_balance() no longer launders around the ledger's RLS.
-- ---------------------------------------------------------------------------
set local request.jwt.claims to
  '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';

select is(public.driver_balance('a0000000-0000-4000-8000-000000000002'), 5000,
  'a driver reads their own balance');

select throws_ok(
  $$ select public.driver_balance('a0000000-0000-4000-8000-000000000003') $$,
  '42501', null,
  'but not somebody else''s - security definer stops bypassing ledger RLS');

select throws_ok(
  $$ select public.can_go_online('a0000000-0000-4000-8000-000000000003') $$,
  '42501', null,
  'and cannot infer it through can_go_online either');

-- service_role has no auth.uid(). offer_next_candidate and the dispatcher both
-- depend on reading any driver's balance, so this must keep working.
set local role service_role;
set local request.jwt.claims to '';

select is(public.driver_balance('a0000000-0000-4000-8000-000000000003'), 5000,
  'service_role, with no auth.uid(), still reads any balance');

-- ---------------------------------------------------------------------------
-- I3: going online and reporting a position are different acts.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to
  '{"sub":"a0000000-0000-4000-8000-000000000005","role":"authenticated"}';

insert into public.driver_presence (driver_id, status, vehicle_class, position, heartbeat_at)
values ('a0000000-0000-4000-8000-000000000005','online','cab',
        st_point(30.1200,-1.9441)::geography, now());

set local role postgres;
set local request.jwt.claims to '';
insert into public.ledger_entries (driver_id, kind, amount_rwf)
values ('a0000000-0000-4000-8000-000000000005','commission_debit',300);

set local role authenticated;
set local request.jwt.claims to
  '{"sub":"a0000000-0000-4000-8000-000000000005","role":"authenticated"}';

-- Phase 3 feeds the rider's live map from this write. A driver who dips below
-- the minimum mid-shift used to get 42501 on every ping, so the rider watching
-- their moto approach would simply see it stop.
select lives_ok(
  $$ update public.driver_presence
        set position = st_point(30.1210,-1.9441)::geography, heartbeat_at = now()
      where driver_id = 'a0000000-0000-4000-8000-000000000005' $$,
  'an underfunded driver already online can still report a position');

select lives_ok(
  $$ update public.driver_presence set status = 'offline'
      where driver_id = 'a0000000-0000-4000-8000-000000000005' $$,
  'and can still go offline');

select throws_ok(
  $$ update public.driver_presence set status = 'online'
      where driver_id = 'a0000000-0000-4000-8000-000000000005' $$,
  '42501', null,
  'but going back INTO online is still gated on the wallet');

select * from finish();
rollback;
