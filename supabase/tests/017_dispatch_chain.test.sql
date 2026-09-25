-- The offer CHAIN: what happens after an offer lapses. 0019 only proved the
-- sweeper marks an offer timed_out; nothing proved the trip it belonged to ever
-- moved again, and it did not - the trip sat in `offered` with no live offer and
-- its rider, still attached, was excluded from every future match.
begin;
select plan(44);

-- Three verified, funded, online motos at 100m, 200m and 300m from one pickup,
-- so "the next candidate" has an unambiguous answer. D4 is a cab 5km away: far
-- enough and wrong enough in class never to enter moto matching, which leaves it
-- free to carry the presence-policy case at the bottom.
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000','a0000000-0000-4000-8000-000000000001',
   'authenticated','authenticated','c.passenger@test.local'),
  ('00000000-0000-0000-0000-000000000000','a0000000-0000-4000-8000-000000000002',
   'authenticated','authenticated','c.rider1@test.local'),
  ('00000000-0000-0000-0000-000000000000','a0000000-0000-4000-8000-000000000003',
   'authenticated','authenticated','c.rider2@test.local'),
  ('00000000-0000-0000-0000-000000000000','a0000000-0000-4000-8000-000000000004',
   'authenticated','authenticated','c.rider3@test.local'),
  ('00000000-0000-0000-0000-000000000000','a0000000-0000-4000-8000-000000000005',
   'authenticated','authenticated','c.rider4@test.local');

insert into public.profiles (id, role, first_name, phone) values
  ('a0000000-0000-4000-8000-000000000001','passenger','Aline','+250788970001'),
  ('a0000000-0000-4000-8000-000000000002','rider','Eric','+250788970002'),
  ('a0000000-0000-4000-8000-000000000003','rider','Jean','+250788970003'),
  ('a0000000-0000-4000-8000-000000000004','rider','Paul','+250788970004'),
  ('a0000000-0000-4000-8000-000000000005','rider','Mid','+250788970005');

insert into public.riders (id, verification) values
  ('a0000000-0000-4000-8000-000000000002','verified'),
  ('a0000000-0000-4000-8000-000000000003','verified'),
  ('a0000000-0000-4000-8000-000000000004','verified'),
  ('a0000000-0000-4000-8000-000000000005','verified');

insert into public.vehicles (rider_id, class, plate, is_active) values
  ('a0000000-0000-4000-8000-000000000002','moto','RAC 002A',true),
  ('a0000000-0000-4000-8000-000000000003','moto','RAC 003A',true),
  ('a0000000-0000-4000-8000-000000000004','moto','RAC 004A',true),
  ('a0000000-0000-4000-8000-000000000005','moto','RAC 005A',true);

-- Rider 5 is close to the cash ceiling: one more fare takes them over it,
-- mid-shift. The fleet analogue of the old near-the-float-minimum case, and
-- the reason the presence policy needs its already-online escape hatch.
insert into public.ledger_entries (rider_id, kind, amount_rwf) values
  ('a0000000-0000-4000-8000-000000000005','fare_collected',
   (select max_cash_held_rwf - 100 from public.platform_settings));

insert into public.rider_presence (rider_id, status, vehicle_class, position, heartbeat_at) values
  ('a0000000-0000-4000-8000-000000000002','online','moto',st_point(30.0628,-1.9441)::geography, now()),
  ('a0000000-0000-4000-8000-000000000003','online','moto',st_point(30.0637,-1.9441)::geography, now()),
  ('a0000000-0000-4000-8000-000000000004','online','moto',st_point(30.0646,-1.9441)::geography, now());

insert into public.trips (id, passenger_id, vehicle_class, state,
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
-- real ETA, to the nearest rider.
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
  (select rider_id from public.trip_offers
    where trip_id='a1000000-0000-4000-8000-000000000001' and outcome is null),
  'a0000000-0000-4000-8000-000000000003'::uuid,
  'which went to the next nearest candidate, not the rider who ignored it');

select is(
  (select rank from public.trip_offers
    where trip_id='a1000000-0000-4000-8000-000000000001' and outcome is null),
  2,
  'the rank increments: this is the second offer made for this trip');

select is(
  (select rider_id from public.trips where id='a1000000-0000-4000-8000-000000000001'),
  'a0000000-0000-4000-8000-000000000003'::uuid,
  'trips.rider_id follows the offer instead of staying on the ignored rider');

select is(
  (select state::text from public.trips where id='a1000000-0000-4000-8000-000000000001'),
  'offered',
  'and the trip is still offered, to somebody who can actually see it');

-- The half of C1 that hurt the rider rather than the passenger: while the trip kept
-- rider_id pointed at them, find_candidate_riders counted them as committed,
-- so they were excluded from EVERY future match, permanently.
select ok(
  exists (
    select 1 from public.find_candidate_riders(
      st_point(30.0619,-1.9441)::geography, 'moto', 2000, 10)
     where rider_id = 'a0000000-0000-4000-8000-000000000002'
  ),
  'the rider who let the offer lapse is matchable again');

-- ---------------------------------------------------------------------------
-- Termination: both ways out.
-- ---------------------------------------------------------------------------
select ok(
  public.offer_next_candidate('a1000000-0000-4000-8000-000000000002') is null,
  'a trip with no candidate at all gets no offer back');

select is(
  (select state::text from public.trips where id='a1000000-0000-4000-8000-000000000002'),
  'no_riders',
  'and reaches no_riders rather than waiting forever');

update public.trips set dispatch_attempts = 3
 where id = 'a1000000-0000-4000-8000-000000000003';

select ok(
  public.offer_next_candidate('a1000000-0000-4000-8000-000000000003') is null,
  'a trip past the attempt bound gets no offer back');

select is(
  (select state::text from public.trips where id='a1000000-0000-4000-8000-000000000003'),
  'no_riders',
  'and reaches no_riders even though candidates were still available');

select ok(
  not has_function_privilege('authenticated', 'public.offer_next_candidate(uuid)', 'EXECUTE'),
  'a rider cannot advance a trip to the next candidate themselves');

-- ---------------------------------------------------------------------------
-- C2: one live offer per RIDER.
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_indexes
    where schemaname='public' and indexname='trip_offers_one_live_per_rider'),
  1,
  'the per-rider partial unique index exists');

-- Rider 2 is holding T1's live offer. Offering them a second trip is exactly
-- what concurrent dispatch used to do - and then the rider could accept both.
select throws_ok(
  $$ select public.create_trip_offer('a1000000-0000-4000-8000-000000000004',
       'a0000000-0000-4000-8000-000000000003', 1, 40, 15, 'offer-t4-1') $$,
  '42501', null,
  'a rider already holding a live offer cannot be offered a second trip');

select is(
  (select count(*)::int from public.trip_offers
    where rider_id='a0000000-0000-4000-8000-000000000003' and outcome is null),
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

-- Recording 'declined' here would say the rider refused the trip when in fact
-- the window had already closed on them - the reliability signal inverted.
select throws_ok(
  $$ select public.decline_offer(
       (select id from public.trip_offers
         where trip_id='a1000000-0000-4000-8000-000000000005')) $$,
  '42501', null,
  'an offer whose window has closed cannot be declined, only timed out');

-- ---------------------------------------------------------------------------
-- I1: the ledger readings do not launder around the ledger's RLS.
-- ---------------------------------------------------------------------------
set local request.jwt.claims to
  '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';

select is(public.rider_cash_held('a0000000-0000-4000-8000-000000000002'), 0,
  'a rider reads their own cash position');

select throws_ok(
  $$ select public.rider_cash_held('a0000000-0000-4000-8000-000000000003') $$,
  '42501', null,
  'but not somebody else''s - security definer stops bypassing ledger RLS');

select throws_ok(
  $$ select public.rider_net_owed('a0000000-0000-4000-8000-000000000003') $$,
  '42501', null,
  'nor what another rider is owed');

select throws_ok(
  $$ select public.can_go_online('a0000000-0000-4000-8000-000000000003') $$,
  '42501', null,
  'and cannot infer it through can_go_online either');

-- service_role has no auth.uid(). offer_next_candidate and the dispatcher both
-- depend on reading any rider's cash position, so this must keep working.
set local role service_role;
set local request.jwt.claims to '';

select is(public.rider_cash_held('a0000000-0000-4000-8000-000000000003'), 0,
  'service_role, with no auth.uid(), still reads any rider''s cash position');

-- ---------------------------------------------------------------------------
-- I3: going online and reporting a position are different acts.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to
  '{"sub":"a0000000-0000-4000-8000-000000000005","role":"authenticated"}';

insert into public.rider_presence (rider_id, status, vehicle_class, position, heartbeat_at)
values ('a0000000-0000-4000-8000-000000000005','online','cab',
        st_point(30.1200,-1.9441)::geography, now());

set local role postgres;
set local request.jwt.claims to '';

-- ---------------------------------------------------------------------------
-- I1: the cash ceiling is enforced at the point of dispatch, not only at the
-- door.
-- ---------------------------------------------------------------------------
-- The control. 100 RWF under the ceiling, verified, online, fresh heartbeat,
-- idle: this rider is dispatchable on every filter there is. If this assertion
-- ever fails the one below it proves nothing, because absence would have some
-- other cause.
select ok(
  exists (
    select 1 from public.find_candidate_riders(
      st_point(30.1200,-1.9441)::geography, 'cab', 2000, 10)
     where rider_id = 'a0000000-0000-4000-8000-000000000005'
  ),
  'a verified, online rider under the cash ceiling is dispatchable');

-- One more fare takes them over it. This is not a contrived edit: the row that
-- pushes a rider over is written by their OWN completed trip, which is what
-- makes the case worth testing at all.
insert into public.ledger_entries (rider_id, kind, amount_rwf)
values ('a0000000-0000-4000-8000-000000000005','fare_collected',200);

-- Over the ceiling now, and nothing about the presence row changed: still
-- 'online', still verified, still beating. The presence policy gates only the
-- transition INTO online, which this rider made while they were still clear -
-- so without a filter at dispatch, a rider carrying too much of the company's
-- cash would keep taking fares until they chose to stop.
select ok(
  not exists (
    select 1 from public.find_candidate_riders(
      st_point(30.1200,-1.9441)::geography, 'cab', 2000, 10)
     where rider_id = 'a0000000-0000-4000-8000-000000000005'
  ),
  'but one who went over the cash ceiling mid-shift is not');

set local role authenticated;
set local request.jwt.claims to
  '{"sub":"a0000000-0000-4000-8000-000000000005","role":"authenticated"}';

-- Phase 3 feeds the passenger's live map from this write. A rider who goes over
-- the ceiling mid-shift must not get 42501 on every ping, or the passenger
-- watching their moto approach would simply see it stop.
select lives_ok(
  $$ update public.rider_presence
        set position = st_point(30.1210,-1.9441)::geography, heartbeat_at = now()
      where rider_id = 'a0000000-0000-4000-8000-000000000005' $$,
  'a rider over the ceiling who is already online can still report a position');

select lives_ok(
  $$ update public.rider_presence set status = 'offline'
      where rider_id = 'a0000000-0000-4000-8000-000000000005' $$,
  'and can still go offline');

select throws_ok(
  $$ update public.rider_presence set status = 'online'
      where rider_id = 'a0000000-0000-4000-8000-000000000005' $$,
  '42501', null,
  'but going back INTO online is still gated on the cash they carry');

-- ---------------------------------------------------------------------------
-- C1 again, reached by DECLINING: the decline must advance the chain.
-- ---------------------------------------------------------------------------
-- Everything above this line is about a rider who IGNORED an offer. Declining
-- one used to strand the trip in exactly the same way and was never covered:
-- decline_offer set outcome = 'declined' and stopped, expire_stale_offers only
-- ever looks at `outcome is null`, and offer_next_candidate had one caller - the
-- sweeper. So a declined trip sat in `offered` forever with rider_id on the
-- decliner, and find_candidate_riders excludes riders committed to an
-- `offered` trip, which made the decliner permanently unmatchable. A timeout is
-- an edge case; declining is normal rider behaviour granted to every
-- authenticated rider.
--
-- Its own scene, ~15km east of the one above, so the riders already holding
-- T1's and T5's offers are outside offer_next_candidate's 4km radius and cannot
-- change which candidate wins here.
set local role postgres;
set local request.jwt.claims to '';

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000','a0000000-0000-4000-8000-000000000006',
   'authenticated','authenticated','c.rider6@test.local'),
  ('00000000-0000-0000-0000-000000000000','a0000000-0000-4000-8000-000000000007',
   'authenticated','authenticated','c.rider7@test.local'),
  ('00000000-0000-0000-0000-000000000000','a0000000-0000-4000-8000-000000000008',
   'authenticated','authenticated','c.rider8@test.local');

insert into public.profiles (id, role, first_name, phone) values
  ('a0000000-0000-4000-8000-000000000006','rider','Decliner','+250788970006'),
  ('a0000000-0000-4000-8000-000000000007','rider','Nextup','+250788970007'),
  ('a0000000-0000-4000-8000-000000000008','rider','Lonely','+250788970008');

insert into public.riders (id, verification) values
  ('a0000000-0000-4000-8000-000000000006','verified'),
  ('a0000000-0000-4000-8000-000000000007','verified'),
  ('a0000000-0000-4000-8000-000000000008','verified');

insert into public.vehicles (rider_id, class, plate, is_active) values
  ('a0000000-0000-4000-8000-000000000006','moto','RAC 006A',true),
  ('a0000000-0000-4000-8000-000000000007','moto','RAC 007A',true),
  ('a0000000-0000-4000-8000-000000000008','moto','RAC 008A',true);

insert into public.rider_presence (rider_id, status, vehicle_class, position, heartbeat_at) values
  -- ~100m and ~200m from T6's pickup: who is "next" is unambiguous.
  ('a0000000-0000-4000-8000-000000000006','online','moto',st_point(30.2009,-1.9441)::geography, now()),
  ('a0000000-0000-4000-8000-000000000007','online','moto',st_point(30.2018,-1.9441)::geography, now()),
  -- T7's only candidate, ~11km further east, so declining T7 leaves the chain
  -- with nobody at all to advance to.
  ('a0000000-0000-4000-8000-000000000008','online','moto',st_point(30.3009,-1.9441)::geography, now());

insert into public.trips (id, passenger_id, vehicle_class, state,
                          pickup, pickup_label, dropoff, dropoff_label) values
  -- T6: a decline with somebody left to ask.
  ('a1000000-0000-4000-8000-000000000006','a0000000-0000-4000-8000-000000000001',
   'moto','requested', st_point(30.2000,-1.9441)::geography,'Kabuga',
   st_point(30.2100,-1.9536)::geography,'Ndera'),
  -- T7: a decline with nobody left to ask.
  ('a1000000-0000-4000-8000-000000000007','a0000000-0000-4000-8000-000000000001',
   'moto','requested', st_point(30.3000,-1.9441)::geography,'Rwamagana road',
   st_point(30.3100,-1.9536)::geography,'Nowhere');

select public.create_trip_offer('a1000000-0000-4000-8000-000000000006',
  'a0000000-0000-4000-8000-000000000006', 1, 40, 15, 'offer-t6-1');

set local role authenticated;
set local request.jwt.claims to
  '{"sub":"a0000000-0000-4000-8000-000000000006","role":"authenticated"}';

-- The decline is made by the RIDER, so the chain now advances inside a
-- transaction whose auth.uid() belongs to somebody who is not the next
-- candidate. That is why the ledger arithmetic is split out of the guarded
-- wrappers into rider_cash_held_internal(): find_candidate_riders has to ask
-- about other people's cash positions by definition, and the guarded form would
-- raise not_your_ledger on every search reached this way. If that split is ever
-- undone, this fails first.
select lives_ok(
  $decline$ select public.decline_offer(
       (select id from public.trip_offers
         where trip_id='a1000000-0000-4000-8000-000000000006'
           and outcome is null)) $decline$,
  'a rider can decline a live offer');

set local role postgres;
set local request.jwt.claims to '';

select is(
  (select outcome::text from public.trip_offers
    where trip_id='a1000000-0000-4000-8000-000000000006'
      and rider_id='a0000000-0000-4000-8000-000000000006'),
  'declined',
  'the decline is recorded as a decline, not a timeout');

select is(
  (select count(*)::int from public.trip_offers
    where trip_id='a1000000-0000-4000-8000-000000000006' and outcome is null),
  1,
  'and the trip holds a NEW live offer rather than sitting in offered with none');

select is(
  (select rider_id from public.trip_offers
    where trip_id='a1000000-0000-4000-8000-000000000006' and outcome is null),
  'a0000000-0000-4000-8000-000000000007'::uuid,
  'which went to a DIFFERENT rider - the next nearest candidate');

select is(
  (select rank from public.trip_offers
    where trip_id='a1000000-0000-4000-8000-000000000006' and outcome is null),
  2,
  'the rank increments: this is the second offer made for this trip');

select is(
  (select rider_id from public.trips where id='a1000000-0000-4000-8000-000000000006'),
  'a0000000-0000-4000-8000-000000000007'::uuid,
  'trips.rider_id moves off the decliner onto the new holder');

select is(
  (select state::text from public.trips where id='a1000000-0000-4000-8000-000000000006'),
  'offered',
  'and the trip is still offered, to somebody who can actually see it');

-- The half of the bug that burned the rider rather than the passenger.
select ok(
  exists (
    select 1 from public.find_candidate_riders(
      st_point(30.2000,-1.9441)::geography, 'moto', 2000, 10)
     where rider_id = 'a0000000-0000-4000-8000-000000000006'
  ),
  'the decliner is matchable again instead of being burned by their own decline');

select ok(
  not exists (
    select 1 from public.find_candidate_riders(
      st_point(30.2000,-1.9441)::geography, 'moto', 2000, 10)
     where rider_id = 'a0000000-0000-4000-8000-000000000007'
  ),
  'and the rider now holding the offer is the one counted as committed');

-- ---------------------------------------------------------------------------
-- A decline with nobody left to ask terminates instead of stranding.
-- ---------------------------------------------------------------------------
select public.create_trip_offer('a1000000-0000-4000-8000-000000000007',
  'a0000000-0000-4000-8000-000000000008', 1, 80, 15, 'offer-t7-1');

set local role authenticated;
set local request.jwt.claims to
  '{"sub":"a0000000-0000-4000-8000-000000000008","role":"authenticated"}';

select lives_ok(
  $decline$ select public.decline_offer(
       (select id from public.trip_offers
         where trip_id='a1000000-0000-4000-8000-000000000007'
           and outcome is null)) $decline$,
  'the only candidate there is can still decline');

set local role postgres;
set local request.jwt.claims to '';

select is(
  (select state::text from public.trips where id='a1000000-0000-4000-8000-000000000007'),
  'no_riders',
  'a decline with no candidate left reaches no_riders rather than waiting forever');

select is(
  (select count(*)::int from public.trip_offers
    where trip_id='a1000000-0000-4000-8000-000000000007' and outcome is null),
  0,
  'and leaves no live offer behind for a sweeper that would never look at it');

select ok(
  (select rider_id from public.trips where id='a1000000-0000-4000-8000-000000000007') is null,
  'the terminal trip releases its rider instead of keeping them attached');

select ok(
  exists (
    select 1 from public.find_candidate_riders(
      st_point(30.3000,-1.9441)::geography, 'moto', 2000, 10)
     where rider_id = 'a0000000-0000-4000-8000-000000000008'
  ),
  'so the rider who declined an undispatchable trip is matchable again too');

-- ---------------------------------------------------------------------------
-- The invariant the whole wave exists to hold.
-- ---------------------------------------------------------------------------
-- `offered` with no live offer is the corrupt state: a passenger waiting on an offer
-- nobody holds, and a rider excluded from every future match. Whatever paths
-- the tests above took, none of them may leave one behind.
select is(
  (select count(*)::int from public.trips t
    where t.state = 'offered'
      and not exists (
        select 1 from public.trip_offers o
         where o.trip_id = t.id and o.outcome is null)),
  0,
  'no trip anywhere is left in offered with no live offer');

select * from finish();
rollback;

