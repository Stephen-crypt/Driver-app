begin;
select plan(8);

-- A rider (R), a control-room operator (CR), a passenger (P).
insert into auth.users (instance_id, id, aud, role, email)
select '00000000-0000-0000-0000-000000000000', ('e3200000-0000-4000-8000-00000000000' || n)::uuid,
       'authenticated', 'authenticated', 'u' || n || '.e32@test.local'
  from generate_series(1, 3) n;

insert into public.staff_members (user_id, role, display_name, active) values
  ('e3200000-0000-4000-8000-000000000002', 'control_room', 'Claudine', true);
insert into public.profiles (id, role, first_name, phone) values
  ('e3200000-0000-4000-8000-000000000001', 'rider', 'Eric', '+250788993601'),
  ('e3200000-0000-4000-8000-000000000003', 'passenger', 'Aline', '+250788993602');
insert into public.riders (id, verification) values ('e3200000-0000-4000-8000-000000000001', 'verified');

insert into public.trips (id, passenger_id, rider_id, vehicle_class, state,
                          pickup, pickup_label, dropoff, dropoff_label)
values ('e3210000-0000-4000-8000-000000000001',
        'e3200000-0000-4000-8000-000000000003', 'e3200000-0000-4000-8000-000000000001', 'moto', 'in_progress',
        st_point(30.0619, -1.9441)::geography, 'Kimironko',
        st_point(30.0588, -1.9536)::geography, 'Kigali Heights');

select is(public.speed_kmh(500, 20), 90, '500 m in 20 s is 90 km/h');

-- 20 seconds ago the rider was here.
insert into public.trip_track_points (trip_id, position, accuracy_m, recorded_at)
values ('e3210000-0000-4000-8000-000000000001', st_point(30.0600, -1.9500)::geography, 8, now() - interval '20 seconds');

set local role authenticated;
set local request.jwt.claims to '{"sub":"e3200000-0000-4000-8000-000000000001","role":"authenticated"}';

-- ~110 m further on: 20 km/h, well under the limit.
select public.publish_track_point('e3210000-0000-4000-8000-000000000001', 30.0600, -1.9490, 8);
reset role;
select is((select count(*)::int from public.speed_alerts where trip_id = 'e3210000-0000-4000-8000-000000000001'), 0,
  'normal city speed raises nothing');

-- A fix the phone itself calls rough (150 m) 500 m away is ignored.
set local role authenticated;
select public.publish_track_point('e3210000-0000-4000-8000-000000000001', 30.0600, -1.9455, 150);
reset role;
select is((select count(*)::int from public.speed_alerts where trip_id = 'e3210000-0000-4000-8000-000000000001'), 0,
  'an inaccurate fix does not become phantom speeding');

-- A good fix ~500 m on from 20 s ago: ~90 km/h.
set local role authenticated;
select public.publish_track_point('e3210000-0000-4000-8000-000000000001', 30.0600, -1.9455, 6);
reset role;
select is((select speed_kmh between 85 and 95 from public.speed_alerts where trip_id = 'e3210000-0000-4000-8000-000000000001'), true,
  'real speeding raises an alert with the measured speed');

set local role authenticated;
select public.publish_track_point('e3210000-0000-4000-8000-000000000001', 30.0600, -1.9454, 6);
reset role;
select is((select count(*)::int from public.speed_alerts where trip_id = 'e3210000-0000-4000-8000-000000000001'), 1,
  'one alert per five minutes of a trip, not one per GPS point');

set local role authenticated;
select is((select count(*)::int from public.speed_alerts), 0, 'a rider cannot read speed alerts');

set local request.jwt.claims to '{"sub":"e3200000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.staff_recent_events(12)
            where kind = 'speed' and trip_id = 'e3210000-0000-4000-8000-000000000001'), 1,
  'the control room sees it in the events rail');
select lives_ok($$ select public.staff_review_speed_alert(
    (select id from public.speed_alerts where trip_id = 'e3210000-0000-4000-8000-000000000001'),
    'Spoke to Eric; downhill on the airport road') $$,
  'and marks it reviewed');

select * from finish();
rollback;
