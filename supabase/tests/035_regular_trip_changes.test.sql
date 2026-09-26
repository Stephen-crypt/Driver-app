begin;
select plan(23);

-- P books a regular trip; Q is someone else; O is operations.
-- Riders: NEAR waits at the pickup, PRIM is 8 km away, BACK 2 km away,
-- OFF is approved but offline, CAB drives a cab.
insert into auth.users (instance_id, id, aud, role, email)
select '00000000-0000-0000-0000-000000000000', ('e3500000-0000-4000-8000-00000000000' || n)::uuid,
       'authenticated', 'authenticated', 'u' || n || '.e35@test.local'
  from generate_series(1, 8) n;

insert into public.profiles (id, role, first_name, phone) values
  ('e3500000-0000-4000-8000-000000000001', 'passenger', 'Aline', '+250788993901'),
  ('e3500000-0000-4000-8000-000000000002', 'passenger', 'Bosco', '+250788993902'),
  ('e3500000-0000-4000-8000-000000000004', 'rider', 'Near', '+250788993904'),
  ('e3500000-0000-4000-8000-000000000005', 'rider', 'Prim', '+250788993905'),
  ('e3500000-0000-4000-8000-000000000006', 'rider', 'Back', '+250788993906'),
  ('e3500000-0000-4000-8000-000000000007', 'rider', 'Off', '+250788993907'),
  ('e3500000-0000-4000-8000-000000000008', 'rider', 'Cab', '+250788993908');
insert into public.staff_members (user_id, role, display_name, active) values
  ('e3500000-0000-4000-8000-000000000003', 'operations', 'Olive', true);
insert into public.riders (id, verification)
select ('e3500000-0000-4000-8000-00000000000' || n)::uuid, 'verified' from generate_series(4, 8) n;
insert into public.vehicles (rider_id, class, plate, is_active)
select ('e3500000-0000-4000-8000-00000000000' || n)::uuid, case when n = 8 then 'cab' else 'moto' end::public.vehicle_class,
       'RAE 35' || n || ' A', true
  from generate_series(4, 8) n;
insert into public.shifts (rider_id, vehicle_id, safety_checks)
select v.rider_id, v.id, '{}'::jsonb from public.vehicles v
 where v.rider_id in ('e3500000-0000-4000-8000-000000000004', 'e3500000-0000-4000-8000-000000000005', 'e3500000-0000-4000-8000-000000000006');
insert into public.rider_presence (rider_id, status, vehicle_class, position, heartbeat_at) values
  ('e3500000-0000-4000-8000-000000000004', 'online', 'moto', st_point(30.0600, -1.9400)::geography, now()),
  ('e3500000-0000-4000-8000-000000000005', 'online', 'moto', st_point(30.1320, -1.9400)::geography, now()),
  ('e3500000-0000-4000-8000-000000000006', 'online', 'moto', st_point(30.0780, -1.9400)::geography, now());
insert into public.device_tokens (user_id, token) values
  ('e3500000-0000-4000-8000-000000000001', 'ExponentPushToken[e35-aline]');

insert into public.fare_quotes (id, passenger_id, policy_id, vehicle_class, distance_m, duration_s, amount_rwf, expires_at)
values ('e3520000-0000-4000-8000-000000000001', 'e3500000-0000-4000-8000-000000000001',
        (select id from public.fare_policies where vehicle_class = 'moto' limit 1), 'moto', 4000, 720, 1700, now() + interval '5 minutes');

create temp table ids (name text primary key, id uuid);
grant all on ids to authenticated;

set local role authenticated;
set local request.jwt.claims to '{"sub":"e3500000-0000-4000-8000-000000000001","role":"authenticated"}';
insert into ids select 'schedule', (public.create_recurring_schedule('e3520000-0000-4000-8000-000000000001',
  st_point(30.06, -1.94)::geography, 'Home', null, st_point(30.07, -1.95)::geography, 'Work',
  '{1,2,3,4,5,6,7}', '07:30', public.kigali_today() + 1, public.kigali_today() + 20)).id;
insert into ids select 'first', id from public.trips
 where recurring_schedule_id = (select id from ids where name = 'schedule') order by scheduled_for limit 1;

-- ===========================================================================
-- §12: the passenger changes things
-- ===========================================================================
select lives_ok($$ select public.change_ride_time((select id from ids where name = 'first'), '08:15') $$,
  'a passenger moves one ride to later that morning');
select is((select to_char(scheduled_for at time zone 'Africa/Kigali', 'HH24:MI') || ' ' || occurrence_modified
             from public.trips where id = (select id from ids where name = 'first')),
  '08:15 true', 'that ride, and only that ride, moves');

set local request.jwt.claims to '{"sub":"e3500000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok($$ select public.change_recurring_schedule((select id from ids where name = 'schedule'), '{1}', '09:00', public.kigali_today() + 10) $$,
  '42501', 'not_your_schedule', 'nobody changes someone else''s regular trip');

set local request.jwt.claims to '{"sub":"e3500000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$ select public.change_recurring_schedule((select id from ids where name = 'schedule'), '{}', '09:00', public.kigali_today() + 10) $$,
  '22023', 'pick_a_day', 'a regular trip needs at least one day');
select lives_ok($$ select public.change_recurring_schedule((select id from ids where name = 'schedule'), '{1,2,3,4,5}', '07:00', public.kigali_today() + 20) $$,
  'the passenger switches to weekdays at 07:00');
select is((select count(*)::int from public.trips
            where recurring_schedule_id = (select id from ids where name = 'schedule') and state = 'scheduled'
              and extract(isodow from occurrence_date) in (6, 7)), 0,
  'weekend rides still to come are cancelled');
select is((select count(*)::int from public.trips
            where recurring_schedule_id = (select id from ids where name = 'schedule') and state = 'scheduled'
              and not occurrence_modified
              and to_char(scheduled_for at time zone 'Africa/Kigali', 'HH24:MI') <> '07:00'), 0,
  'every other ride moves to the new time');
select ok((select state <> 'scheduled' or to_char(scheduled_for at time zone 'Africa/Kigali', 'HH24:MI') = '08:15'
             from public.trips where id = (select id from ids where name = 'first')),
  'but the ride moved by hand keeps its own time');

select lives_ok($$ select public.change_recurring_schedule((select id from ids where name = 'schedule'), '{1,2,3,4,5,6,7}', '07:00', public.kigali_today() + 20) $$,
  'weekends go back in');
select ok((select count(*) from public.trips
            where recurring_schedule_id = (select id from ids where name = 'schedule') and state = 'scheduled'
              and extract(isodow from occurrence_date) in (6, 7)) > 0,
  'and are booked again');

-- ===========================================================================
-- §13: operations plans the riders
-- ===========================================================================
select throws_ok($$ select public.staff_set_schedule_rider((select id from ids where name = 'schedule'), 'primary',
    'e3500000-0000-4000-8000-000000000005') $$, '42501', 'not_permitted', 'a passenger cannot pick their rider');

set local request.jwt.claims to '{"sub":"e3500000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok($$ select public.staff_set_schedule_rider((select id from ids where name = 'schedule'), 'primary',
    'e3500000-0000-4000-8000-000000000008') $$, '22023', 'rider_cannot_take_this', 'a cab driver cannot be the moto rider');
select lives_ok($$ select public.staff_set_schedule_rider((select id from ids where name = 'schedule'), 'primary',
    'e3500000-0000-4000-8000-000000000005') $$, 'operations makes Prim the primary rider');
select lives_ok($$ select public.staff_set_schedule_rider((select id from ids where name = 'schedule'), 'backup',
    'e3500000-0000-4000-8000-000000000006') $$, 'and Back the backup');

set local request.jwt.claims to '{"sub":"e3500000-0000-4000-8000-000000000001","role":"authenticated"}';
select ok((select bool_and(rider_name = 'Prim') from public.my_upcoming_rides()
            where recurring_schedule_id = (select id from ids where name = 'schedule')),
  'the passenger sees Prim planned for every ride');
set local request.jwt.claims to '{"sub":"e3500000-0000-4000-8000-000000000005","role":"authenticated"}';
select ok((select count(*) from public.my_planned_rides()) > 0, 'and Prim sees the rides planned for them');

reset role;
select is((select count(*)::int from net.http_request_queue
            where convert_from(body, 'utf8')::jsonb ->> 'to' = 'ExponentPushToken[e35-aline]'
              and convert_from(body, 'utf8')::jsonb ->> 'title' = 'Your rider has changed'), 1,
  'the passenger is told once, not once per day');

-- ---- dispatch -------------------------------------------------------------------
insert into ids select 'released', id from public.trips
 where recurring_schedule_id = (select id from ids where name = 'schedule') and state = 'scheduled'
 order by scheduled_for limit 1;
update public.trips set scheduled_for = now() + interval '5 minutes' where id = (select id from ids where name = 'released');
select public.release_scheduled_trips();
select public.dispatch_pending_trips();
select is((select p.first_name from public.trip_offers o join public.profiles p on p.id = o.rider_id
            where o.trip_id = (select id from ids where name = 'released') order by o.rank desc limit 1), 'Prim',
  'the ride is offered to the primary rider first, though Near is closer');

update public.trip_offers set expires_at = now() - interval '1 second' where trip_id = (select id from ids where name = 'released');
select public.expire_stale_offers();
select public.offer_next_candidate((select id from ids where name = 'released'));
select is((select p.first_name from public.trip_offers o join public.profiles p on p.id = o.rider_id
            where o.trip_id = (select id from ids where name = 'released') order by o.rank desc limit 1), 'Back',
  'then to the backup');

update public.trip_offers set expires_at = now() - interval '1 second' where trip_id = (select id from ids where name = 'released') and outcome is null;
select public.expire_stale_offers();
select public.offer_next_candidate((select id from ids where name = 'released'));
select is((select p.first_name from public.trip_offers o join public.profiles p on p.id = o.rider_id
            where o.trip_id = (select id from ids where name = 'released') order by o.rank desc limit 1), 'Near',
  'then to the nearest rider, without the planned riders having used up the search');

-- ---- one ride handed to someone else -----------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"e3500000-0000-4000-8000-000000000003","role":"authenticated"}';
insert into ids select 'later', id from public.trips
 where recurring_schedule_id = (select id from ids where name = 'schedule') and state = 'scheduled'
 order by scheduled_for desc limit 1;
select lives_ok($$ select public.staff_reassign_ride((select id from ids where name = 'later'), 'e3500000-0000-4000-8000-000000000007') $$,
  'operations hands one ride to Off');
select lives_ok($$ select public.staff_set_schedule_rider((select id from ids where name = 'schedule'), 'primary',
    'e3500000-0000-4000-8000-000000000006') $$, 'then changes the primary rider');
select is((select planned_rider_id from public.trips where id = (select id from ids where name = 'later')),
  'e3500000-0000-4000-8000-000000000007'::uuid, 'and the hand-picked ride stays with Off');

select * from finish();
rollback;
