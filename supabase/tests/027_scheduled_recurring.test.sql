begin;
select plan(20);

-- P books; Q is another passenger; R is a rider for the waiting-time checks.
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000','c7000000-0000-4000-8000-000000000001','authenticated','authenticated','p.c7@test.local'),
  ('00000000-0000-0000-0000-000000000000','c7000000-0000-4000-8000-000000000002','authenticated','authenticated','q.c7@test.local'),
  ('00000000-0000-0000-0000-000000000000','c7000000-0000-4000-8000-000000000003','authenticated','authenticated','r.c7@test.local');

insert into public.profiles (id, role, first_name, phone) values
  ('c7000000-0000-4000-8000-000000000001','passenger','Aline','+250788970101'),
  ('c7000000-0000-4000-8000-000000000002','passenger','Bosco','+250788970102'),
  ('c7000000-0000-4000-8000-000000000003','rider','Eric','+250788970103');

insert into public.riders (id, verification) values ('c7000000-0000-4000-8000-000000000003','verified');

insert into public.fare_quotes
  (id, passenger_id, policy_id, vehicle_class, distance_m, duration_s, amount_rwf, expires_at)
select ('c7200000-0000-4000-8000-00000000000' || n)::uuid,
       'c7000000-0000-4000-8000-000000000001',
       (select id from public.fare_policies where vehicle_class = 'moto' limit 1),
       'moto', 4000, 720, 1700, now() + interval '2 minutes'
  from generate_series(1, 6) n;

set local role authenticated;
set local request.jwt.claims to '{"sub":"c7000000-0000-4000-8000-000000000001","role":"authenticated"}';

-- ===========================================================================
-- A ride booked for later
-- ===========================================================================
select throws_ok(
  $$ select public.schedule_trip_from_quote('c7200000-0000-4000-8000-000000000001',
       st_point(30.06,-1.94)::geography, 'Home', null, st_point(30.07,-1.95)::geography, 'Work',
       now() + interval '5 minutes') $$,
  '22023', 'too_soon',
  'five minutes from now is a ride now, not a scheduled one');

select throws_ok(
  $$ select public.schedule_trip_from_quote('c7200000-0000-4000-8000-000000000001',
       st_point(30.06,-1.94)::geography, 'Home', null, st_point(30.07,-1.95)::geography, 'Work',
       now() + interval '90 days') $$,
  '22023', 'too_far_ahead',
  'nor can a ride be booked three months out at today''s price');

select is(
  (public.schedule_trip_from_quote('c7200000-0000-4000-8000-000000000001',
     st_point(30.06,-1.94)::geography, 'Home', null, st_point(30.07,-1.95)::geography, 'Work',
     now() + interval '1 day')).state::text,
  'scheduled',
  'a ride tomorrow is held as scheduled');

set local role postgres;
select public.dispatch_pending_trips();
select is(
  (select count(*)::int from public.trip_offers o join public.trips t on t.id = o.trip_id
    where t.quote_id = 'c7200000-0000-4000-8000-000000000001'),
  0,
  'dispatch leaves a scheduled ride alone');

update public.trips set scheduled_for = now() + interval '5 minutes'
 where quote_id = 'c7200000-0000-4000-8000-000000000001';
select public.release_scheduled_trips();
select is(
  (select state::text from public.trips where quote_id = 'c7200000-0000-4000-8000-000000000001'),
  'requested',
  'ten minutes before pickup it is released into the dispatch queue');

select is(
  (select actor::text from public.trip_events e join public.trips t on t.id = e.trip_id
    where t.quote_id = 'c7200000-0000-4000-8000-000000000001' and e.to_state = 'requested'),
  'system',
  'and the release is recorded as the system''s doing');

set local role authenticated;
set local request.jwt.claims to '{"sub":"c7000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok(
  $$ select public.trip_transition(
       (public.schedule_trip_from_quote('c7200000-0000-4000-8000-000000000002',
          st_point(30.06,-1.94)::geography, 'Home', null, st_point(30.07,-1.95)::geography, 'Work',
          now() + interval '2 days')).id,
       'cancelled_by_passenger', 'c7-cancel-one') $$,
  'a passenger can cancel a ride booked for later');

-- ===========================================================================
-- Recurring
-- ===========================================================================
select throws_ok(
  $$ select public.create_recurring_schedule('c7200000-0000-4000-8000-000000000003',
       st_point(30.06,-1.94)::geography, 'Home', null, st_point(30.07,-1.95)::geography, 'Work',
       array[1,2,3,4,5]::smallint[], '07:30', public.kigali_today() + 1, public.kigali_today() + 200) $$,
  '22023', 'schedule_too_long',
  'a schedule cannot lock today''s price for most of a year');

select throws_ok(
  $$ select public.create_recurring_schedule('c7200000-0000-4000-8000-000000000003',
       st_point(30.06,-1.94)::geography, 'Home', null, st_point(30.07,-1.95)::geography, 'Work',
       array[1]::smallint[], '07:30', public.kigali_today() - 3, public.kigali_today() + 10) $$,
  '22023', 'starts_in_the_past',
  'nor start in the past');

-- Every day, starting tomorrow: the seven-day horizon holds exactly seven.
select lives_ok(
  $$ select public.create_recurring_schedule('c7200000-0000-4000-8000-000000000003',
       st_point(30.06,-1.94)::geography, 'Home', 'Blue gate', st_point(30.07,-1.95)::geography, 'Work',
       array[1,2,3,4,5,6,7]::smallint[], '07:30', public.kigali_today() + 1, public.kigali_today() + 30) $$,
  'a passenger books a ride to work every day for a month');

select is(
  (select count(*)::int from public.trips t join public.recurring_schedules s on s.id = t.recurring_schedule_id
    where s.passenger_id = 'c7000000-0000-4000-8000-000000000001' and t.state = 'scheduled'),
  7,
  'the next week of it exists as seven separate rides, not one giant one');

select is(
  (select count(distinct t.quote_id)::int from public.trips t join public.recurring_schedules s on s.id = t.recurring_schedule_id
    where s.passenger_id = 'c7000000-0000-4000-8000-000000000001'),
  7,
  'each occurrence carries its own copy of the locked price');

select is(
  (select t.pickup_note from public.trips t join public.recurring_schedules s on s.id = t.recurring_schedule_id
    where s.passenger_id = 'c7000000-0000-4000-8000-000000000001' limit 1),
  'Blue gate',
  'and the note for the rider on every one of them');

select throws_ok(
  $$ select public.schedule_trip_from_quote('c7200000-0000-4000-8000-000000000003',
       st_point(30.06,-1.94)::geography, 'Home', null, st_point(30.07,-1.95)::geography, 'Work',
       now() + interval '1 day') $$,
  '22023', 'quote_expired',
  'the quote that priced the schedule cannot also be spent on another ride');

select lives_ok(
  $$ select public.trip_transition(
       (select t.id from public.trips t join public.recurring_schedules s on s.id = t.recurring_schedule_id
         where s.passenger_id = 'c7000000-0000-4000-8000-000000000001'
         order by t.scheduled_for limit 1),
       'skipped', 'c7-skip') $$,
  'one day can be skipped');

set local role postgres;
select is(
  public.materialise_recurring() >= 0
  and (select count(*)::int from public.trips t join public.recurring_schedules s on s.id = t.recurring_schedule_id
        where s.passenger_id = 'c7000000-0000-4000-8000-000000000001') = 7,
  true,
  'running the materialiser again adds nothing, and does not bring the skipped day back');

set local role authenticated;
set local request.jwt.claims to '{"sub":"c7000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(
  (select count(*)::int from public.recurring_schedules
    where passenger_id = 'c7000000-0000-4000-8000-000000000001'),
  0,
  'another passenger cannot see someone''s commute');

select throws_ok(
  $$ select public.cancel_recurring_schedule(
       (select id from public.recurring_schedules limit 1)) $$,
  null, null,
  'nor cancel it');

set local request.jwt.claims to '{"sub":"c7000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  public.cancel_recurring_schedule(
    (select id from public.recurring_schedules where passenger_id = 'c7000000-0000-4000-8000-000000000001')),
  6,
  'cancelling the schedule cancels the six rides still to come, and leaves the skipped one skipped');

-- ===========================================================================
-- Waiting starts at the booked time
-- ===========================================================================
set local role postgres;
insert into public.trips (id, passenger_id, rider_id, vehicle_class, state, pickup, pickup_label,
                          dropoff, dropoff_label, scheduled_for)
values ('c7100000-0000-4000-8000-000000000009',
        'c7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000003',
        'moto', 'accepted', st_point(30.06,-1.94)::geography, 'Home',
        st_point(30.07,-1.95)::geography, 'Work', now() - interval '8 minutes');

set local role authenticated;
set local request.jwt.claims to '{"sub":"c7000000-0000-4000-8000-000000000003","role":"authenticated"}';
select public.trip_transition('c7100000-0000-4000-8000-000000000009', 'arrived', 'c7-arrive');

-- The rider got there twenty minutes ago, twelve minutes early for the 7:30.
set local role postgres;
update public.trip_events set created_at = created_at - interval '20 minutes'
 where trip_id = 'c7100000-0000-4000-8000-000000000009' and to_state = 'arrived';

select is(
  public.trip_waited_seconds_internal('c7100000-0000-4000-8000-000000000009') between 479 and 481,
  true,
  'a rider who came early is waiting from the booked time, not from when they arrived');

select * from finish();
rollback;
