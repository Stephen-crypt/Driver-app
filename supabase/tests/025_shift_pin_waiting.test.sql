begin;
select plan(41);

-- Passenger P; riders:
--   R1 verified, vehicle, no shift   - the shift lifecycle
--   R2 verified, no vehicle          - cannot start a shift
--   R3 submitted                     - cannot start a shift
--   R4 verified, vehicle, open shift - drives the trips
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000','e0000000-0000-4000-8000-000000000001','authenticated','authenticated','p.e@test.local'),
  ('00000000-0000-0000-0000-000000000000','e0000000-0000-4000-8000-000000000011','authenticated','authenticated','r1.e@test.local'),
  ('00000000-0000-0000-0000-000000000000','e0000000-0000-4000-8000-000000000012','authenticated','authenticated','r2.e@test.local'),
  ('00000000-0000-0000-0000-000000000000','e0000000-0000-4000-8000-000000000013','authenticated','authenticated','r3.e@test.local'),
  ('00000000-0000-0000-0000-000000000000','e0000000-0000-4000-8000-000000000014','authenticated','authenticated','r4.e@test.local');

insert into public.profiles (id, role, first_name, phone) values
  ('e0000000-0000-4000-8000-000000000001','passenger','Aline','+250788970001'),
  ('e0000000-0000-4000-8000-000000000011','rider','Eric','+250788970011'),
  ('e0000000-0000-4000-8000-000000000012','rider','Jean','+250788970012'),
  ('e0000000-0000-4000-8000-000000000013','rider','Olivier','+250788970013'),
  ('e0000000-0000-4000-8000-000000000014','rider','Claude','+250788970014');

insert into public.riders (id, verification) values
  ('e0000000-0000-4000-8000-000000000011','verified'),
  ('e0000000-0000-4000-8000-000000000012','verified'),
  ('e0000000-0000-4000-8000-000000000013','submitted'),
  ('e0000000-0000-4000-8000-000000000014','verified');

insert into public.vehicles (rider_id, class, plate, is_active) values
  ('e0000000-0000-4000-8000-000000000011','moto','RAE 011A',true),
  ('e0000000-0000-4000-8000-000000000014','moto','RAE 014A',true);

insert into public.shifts (rider_id, vehicle_id, safety_checks)
select rider_id, id, '{}'::jsonb from public.vehicles
 where rider_id = 'e0000000-0000-4000-8000-000000000014';

insert into public.fare_quotes
  (id, passenger_id, policy_id, vehicle_class, distance_m, duration_s, amount_rwf, expires_at)
select ('e2000000-0000-4000-8000-00000000000' || n)::uuid,
       'e0000000-0000-4000-8000-000000000001',
       (select id from public.fare_policies where vehicle_class = 'moto' limit 1),
       'moto', 4000, 720, 1700, now() + interval '2 minutes'
  from generate_series(1, 3) n;

-- T1 the happy path, T2 the lockout, T3 the no-show: all accepted by R4.
-- T4 has no rider yet.
insert into public.trips
  (id, passenger_id, rider_id, vehicle_class, state, pickup, pickup_label,
   dropoff, dropoff_label, quoted_distance_m, quoted_duration_s, quote_id, quoted_amount_rwf)
select ('e1000000-0000-4000-8000-00000000000' || n)::uuid,
       'e0000000-0000-4000-8000-000000000001',
       case when n = 4 then null else 'e0000000-0000-4000-8000-000000000014'::uuid end,
       'moto',
       case when n = 4 then 'requested'::public.trip_state else 'accepted'::public.trip_state end,
       st_point(30.0619, -1.9441)::geography, 'Kimironko',
       st_point(30.0588, -1.9536)::geography, 'Kigali Heights', 4000, 720,
       case when n = 4 then null else ('e2000000-0000-4000-8000-00000000000' || n)::uuid end,
       case when n = 4 then null else 1700 end
  from generate_series(1, 4) n;

-- Stands in for the passenger reading the PIN out. The rider can never read
-- trip_pins themselves, which is asserted below.
create temp table pin_read_out as select trip_id, pin from public.trip_pins;
grant select on pin_read_out to authenticated;

-- ===========================================================================
-- Shifts
-- ===========================================================================
set local role authenticated;

set local request.jwt.claims to '{"sub":"e0000000-0000-4000-8000-000000000013","role":"authenticated"}';
select throws_ok(
  $$ select public.start_shift('{"helmets":true,"lights":true,"brakes":true,"tyres":true,"fuel":true,"phone":true}', null, null) $$,
  '42501', 'not_verified',
  'an unverified rider cannot start a shift');

set local request.jwt.claims to '{"sub":"e0000000-0000-4000-8000-000000000012","role":"authenticated"}';
select throws_ok(
  $$ select public.start_shift('{"helmets":true,"lights":true,"brakes":true,"tyres":true,"fuel":true,"phone":true}', null, null) $$,
  '23514', 'no_vehicle',
  'nor can a rider with no vehicle - the company has not handed them one');

set local role postgres;
select ok(
  not public.can_go_online_internal('e0000000-0000-4000-8000-000000000011'),
  'a rider with a vehicle but no shift may not go online');

set local role authenticated;
set local request.jwt.claims to '{"sub":"e0000000-0000-4000-8000-000000000011","role":"authenticated"}';
select throws_ok(
  $$ select public.start_shift('{"helmets":true,"lights":true,"brakes":false,"tyres":true,"fuel":true,"phone":true}', null, null) $$,
  '23514', 'safety_check_failed: brakes',
  'a failed safety check refuses the shift and names the check');

select throws_ok(
  $$ select public.start_shift('{"helmets":true,"lights":true}', null, null) $$,
  '23514', 'safety_check_failed: brakes,tyres,fuel,phone',
  'an unanswered check counts as failed, not as skipped');

select lives_ok(
  $$ select public.start_shift('{"helmets":true,"lights":true,"brakes":true,"tyres":true,"fuel":true,"phone":true}', 30.06, -1.94) $$,
  'every check passed starts the shift');

select is(
  (select (public.start_shift('{"helmets":true,"lights":true,"brakes":true,"tyres":true,"fuel":true,"phone":true}', null, null)).id),
  (select id from public.shifts where rider_id = 'e0000000-0000-4000-8000-000000000011' and ended_at is null),
  'starting again returns the open shift instead of a second one');

select throws_ok(
  $$ insert into public.shifts (rider_id, vehicle_id, safety_checks)
     select rider_id, id, '{}' from public.vehicles where rider_id = 'e0000000-0000-4000-8000-000000000011' $$,
  '42501', null,
  'a shift cannot be written directly, which would skip the checks');

set local role postgres;
select ok(
  public.can_go_online_internal('e0000000-0000-4000-8000-000000000011'),
  'with a shift open, the rider may go online');

set local role authenticated;
set local request.jwt.claims to '{"sub":"e0000000-0000-4000-8000-000000000014","role":"authenticated"}';
select is(
  (select count(*)::int from public.shifts where rider_id = 'e0000000-0000-4000-8000-000000000011'),
  0,
  'one rider cannot see another rider''s shifts');

set local request.jwt.claims to '{"sub":"e0000000-0000-4000-8000-000000000011","role":"authenticated"}';
select is(
  (public.end_shift('needs_repair', 'Rear brake is soft', 30.07, -1.95)) ->> 'trips',
  '0',
  'ending the shift reports what happened in it');

select is(
  (select count(*)::int from public.shifts
    where rider_id = 'e0000000-0000-4000-8000-000000000011' and ended_at is null),
  0,
  'and closes it');

select is(
  (select note from public.rider_reports
    where rider_id = 'e0000000-0000-4000-8000-000000000011' and kind = 'vehicle_problem'),
  'Rear brake is soft',
  'a vehicle that needs repair becomes a report the fleet sees');

set local role postgres;
select ok(
  not public.can_go_online_internal('e0000000-0000-4000-8000-000000000011'),
  'after the shift, the rider may not go online again until the next one');

-- ===========================================================================
-- Ride PIN
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"e0000000-0000-4000-8000-000000000001","role":"authenticated"}';

select is(
  public.trip_ride_pin('e1000000-0000-4000-8000-000000000004'),
  null,
  'there is no PIN to show before a rider is assigned');

select matches(
  public.trip_ride_pin('e1000000-0000-4000-8000-000000000001'),
  '^[0-9]{4}$',
  'once assigned, the passenger sees a four-digit PIN');

set local request.jwt.claims to '{"sub":"e0000000-0000-4000-8000-000000000014","role":"authenticated"}';

select throws_ok(
  $$ select public.trip_ride_pin('e1000000-0000-4000-8000-000000000001') $$,
  '42501', 'not_your_trip',
  'the rider cannot look the PIN up instead of asking for it');

select throws_ok(
  $$ select pin from public.trip_pins $$,
  '42501', null,
  'nor read the table it lives in');

select lives_ok(
  $$ select public.trip_transition('e1000000-0000-4000-8000-000000000001', 'arrived', 't1-arrive');
     select public.trip_transition('e1000000-0000-4000-8000-000000000002', 'arrived', 't2-arrive') $$,
  'the rider arrives at two pickups');

select throws_ok(
  $$ select public.trip_transition('e1000000-0000-4000-8000-000000000001', 'in_progress', 't1-skip') $$,
  '42501', 'ride_pin_required',
  'a trip cannot be started around the PIN through trip_transition');

select is(
  (public.start_trip('e1000000-0000-4000-8000-000000000002', '----', 't2-try1')) ->> 'reason',
  'wrong_pin',
  'a wrong PIN does not start the trip');

set local role postgres;
select is(
  (select failed_attempts from public.trip_pins where trip_id = 'e1000000-0000-4000-8000-000000000002'),
  1,
  'and the failure is counted - it is not rolled back with an exception');

set local role authenticated;
set local request.jwt.claims to '{"sub":"e0000000-0000-4000-8000-000000000014","role":"authenticated"}';
select lives_ok(
  $$ select public.start_trip('e1000000-0000-4000-8000-000000000002', '----', 't2-try' || n) from generate_series(2, 5) n $$,
  'four more wrong guesses');

select is(
  (public.start_trip('e1000000-0000-4000-8000-000000000002',
    (select pin from pin_read_out where trip_id = 'e1000000-0000-4000-8000-000000000002'),
    't2-right')) ->> 'reason',
  'locked',
  'after five, even the right PIN is refused - four digits cannot be guessed at forever');

select is(
  (select state::text from public.trips where id = 'e1000000-0000-4000-8000-000000000002'),
  'arrived',
  'and the locked trip has not started');

-- ===========================================================================
-- Waiting time
-- ===========================================================================
select is(
  array[
    public.waiting_charge_rwf(300, 300, 50),
    public.waiting_charge_rwf(359, 300, 50),
    public.waiting_charge_rwf(360, 300, 50),
    public.waiting_charge_rwf(1000, 300, 50)],
  array[0, 0, 50, 550],
  'only whole minutes past the grace period are charged');

-- The passenger kept the rider waiting eleven minutes: six past the grace.
set local role postgres;
update public.trip_events set created_at = created_at - interval '11 minutes'
 where trip_id = 'e1000000-0000-4000-8000-000000000001' and to_state = 'arrived';

set local role authenticated;
set local request.jwt.claims to '{"sub":"e0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select row(grace_seconds, waited_seconds, charge_rwf)::text
     from public.trip_wait_status('e1000000-0000-4000-8000-000000000001')),
  '(300,660,300)',
  'the passenger can see the clock and what it has cost so far');

set local request.jwt.claims to '{"sub":"e0000000-0000-4000-8000-000000000014","role":"authenticated"}';
select is(
  (public.start_trip('e1000000-0000-4000-8000-000000000001',
    (select pin from pin_read_out where trip_id = 'e1000000-0000-4000-8000-000000000001'),
    't1-go')) ->> 'started',
  'true',
  'the right PIN starts the trip');

select lives_ok(
  $$ select public.complete_trip('e1000000-0000-4000-8000-000000000001', 4000, 't1-done') $$,
  'the rider completes it');

set local role postgres;
select is(
  (select amount_rwf from public.ledger_entries
    where trip_id = 'e1000000-0000-4000-8000-000000000001' and kind = 'fare_collected'),
  2000,
  'the rider collects the fare plus six minutes of waiting');

select is(
  (select amount_rwf from public.ledger_entries
    where trip_id = 'e1000000-0000-4000-8000-000000000001' and kind = 'trip_earning'),
  public.rider_earning_rwf(2000, (select commission_pct from public.fare_policies where vehicle_class = 'moto' limit 1)),
  'and earns their share of the whole of it');

set local role authenticated;
set local request.jwt.claims to '{"sub":"e0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select row(total_rwf, fare_rwf, waiting_charge_rwf)::text
     from public.trip_total_rwf('e1000000-0000-4000-8000-000000000001')),
  '(2000,1700,300)',
  'the passenger sees the waiting charge as its own part of the total');

-- ===========================================================================
-- No-show
-- ===========================================================================
set local request.jwt.claims to '{"sub":"e0000000-0000-4000-8000-000000000014","role":"authenticated"}';
select lives_ok(
  $$ select public.trip_transition('e1000000-0000-4000-8000-000000000003', 'arrived', 't3-arrive') $$,
  'the rider arrives for the third trip');

select throws_ok(
  $$ select public.report_no_show('e1000000-0000-4000-8000-000000000003', 'Not here', null, null, 't3-ns-early') $$,
  '23514', null,
  'a no-show cannot be reported inside the grace period');

set local request.jwt.claims to '{"sub":"e0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ select public.report_no_show('e1000000-0000-4000-8000-000000000003', 'x', null, null, 't3-ns-p') $$,
  '42501', 'not_your_trip',
  'a passenger cannot mark their own trip as a no-show');

set local role postgres;
update public.trip_events set created_at = created_at - interval '6 minutes'
 where trip_id = 'e1000000-0000-4000-8000-000000000003' and to_state = 'arrived';

set local role authenticated;
set local request.jwt.claims to '{"sub":"e0000000-0000-4000-8000-000000000014","role":"authenticated"}';
select is(
  (public.report_no_show('e1000000-0000-4000-8000-000000000003',
    'Called twice, no answer', 30.0619, -1.9441, 't3-ns')).state::text,
  'no_show',
  'after the grace period, the rider can report the passenger missing');

set local request.jwt.claims to '{"sub":"e0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select reason from public.no_show_reports where trip_id = 'e1000000-0000-4000-8000-000000000003'),
  'Called twice, no answer',
  'and the passenger can see what was reported about them');

-- ===========================================================================
-- Reports and the end of a shift
-- ===========================================================================
set local request.jwt.claims to '{"sub":"e0000000-0000-4000-8000-000000000014","role":"authenticated"}';
select isnt(
  (public.report_issue('safety_issue', 'Road flooded at Nyabugogo', null, null, null)).shift_id,
  null,
  'a report is filed against the shift it happened in');

select throws_ok(
  $$ insert into public.rider_reports (rider_id, kind, note)
     values ('e0000000-0000-4000-8000-000000000014', 'incident', 'x') $$,
  '42501', null,
  'reports go through the function, never a direct write');

select throws_ok(
  $$ select public.end_shift('good', null, null, null) $$,
  '23514', 'trip_in_progress',
  'a rider with a passenger still waiting cannot end their shift');

select ok(
  not has_function_privilege('anon', 'public.start_shift(jsonb,double precision,double precision)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.trip_ride_pin(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.start_trip(uuid,text,text)', 'EXECUTE'),
  'none of it is reachable without signing in');

select * from finish();
rollback;
