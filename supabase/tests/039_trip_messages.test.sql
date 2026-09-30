begin;
select plan(11);

-- Aline is riding with Eric. Claude is a stranger to the trip.
insert into auth.users (instance_id, id, aud, role, email)
select '00000000-0000-0000-0000-000000000000', ('e3900000-0000-4000-8000-00000000000' || n)::uuid,
       'authenticated', 'authenticated', 'u' || n || '.e39@test.local' from generate_series(1, 3) n;
insert into public.profiles (id, role, first_name, phone) values
  ('e3900000-0000-4000-8000-000000000001', 'passenger', 'Aline', '+250788994301'),
  ('e3900000-0000-4000-8000-000000000002', 'rider', 'Eric', '+250788994302'),
  ('e3900000-0000-4000-8000-000000000003', 'passenger', 'Claude', '+250788994303');
insert into public.riders (id, verification) values ('e3900000-0000-4000-8000-000000000002', 'verified');
insert into public.fare_quotes (id, passenger_id, policy_id, vehicle_class, distance_m, duration_s, amount_rwf, expires_at)
values ('e3920000-0000-4000-8000-000000000001', 'e3900000-0000-4000-8000-000000000001',
        (select id from public.fare_policies where vehicle_class = 'moto' and effective_to is null limit 1),
        'moto', 5000, 900, 2000, now() + interval '2 minutes');
insert into public.trips (id, passenger_id, rider_id, vehicle_class, state, pickup, pickup_label, dropoff, dropoff_label,
                          quoted_distance_m, quoted_duration_s, quote_id, quoted_amount_rwf)
values ('e3910000-0000-4000-8000-000000000001', 'e3900000-0000-4000-8000-000000000001', 'e3900000-0000-4000-8000-000000000002',
        'moto', 'accepted', st_point(30.06, -1.94)::geography, 'A', st_point(30.10, -1.95)::geography, 'B',
        5000, 900, 'e3920000-0000-4000-8000-000000000001', 2000);

-- The rider writes.
set local role authenticated;
set local request.jwt.claims to '{"sub":"e3900000-0000-4000-8000-000000000002","role":"authenticated"}';
select lives_ok(
  $$ insert into public.trip_messages (trip_id, sender_id, body)
     values ('e3910000-0000-4000-8000-000000000001', 'e3900000-0000-4000-8000-000000000002', 'Two minutes away') $$,
  'the rider on the trip can send a message');
select throws_ok(
  $$ insert into public.trip_messages (trip_id, sender_id, body)
     values ('e3910000-0000-4000-8000-000000000001', 'e3900000-0000-4000-8000-000000000001', 'not me') $$,
  '42501', null,
  'and cannot write as the other person');
reset role;

-- The passenger reads it, and marks it read. A stranger sees nothing.
set local role authenticated;
set local request.jwt.claims to '{"sub":"e3900000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.trip_messages where trip_id = 'e3910000-0000-4000-8000-000000000001'), 1,
  'the passenger sees the thread');
update public.trip_messages set read_at = now()
 where trip_id = 'e3910000-0000-4000-8000-000000000001' and sender_id <> 'e3900000-0000-4000-8000-000000000001';
select isnt((select read_at from public.trip_messages where body = 'Two minutes away'), null,
  'and can mark the rider''s message as read');
insert into public.trip_messages (trip_id, sender_id, body)
values ('e3910000-0000-4000-8000-000000000001', 'e3900000-0000-4000-8000-000000000001', 'At the gate');
update public.trip_messages set read_at = now() where body = 'At the gate';
select is((select read_at from public.trip_messages where body = 'At the gate'), null,
  'but not their own message');
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"e3900000-0000-4000-8000-000000000003","role":"authenticated"}';
select is((select count(*)::int from public.trip_messages where trip_id = 'e3910000-0000-4000-8000-000000000001'), 0,
  'a stranger to the trip sees nothing');
select throws_ok(
  $$ insert into public.trip_messages (trip_id, sender_id, body)
     values ('e3910000-0000-4000-8000-000000000001', 'e3900000-0000-4000-8000-000000000003', 'hello?') $$,
  '42501', null,
  'and cannot write into it');
reset role;

-- The reader marks read and nothing else: not the words, not the time, not the trip.
set local role authenticated;
set local request.jwt.claims to '{"sub":"e3900000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ update public.trip_messages set body = 'You never came' where trip_id = 'e3910000-0000-4000-8000-000000000001' $$,
  '42501', null,
  'the reader cannot rewrite a message');
reset role;

-- A sender cannot backdate a message, or send it already read.
set local role authenticated;
set local request.jwt.claims to '{"sub":"e3900000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok(
  $$ insert into public.trip_messages (trip_id, sender_id, body, created_at)
     values ('e3910000-0000-4000-8000-000000000001', 'e3900000-0000-4000-8000-000000000002', 'I was here at 7', now() - interval '1 hour') $$,
  '42501', null,
  'a sender cannot backdate a message');
select throws_ok(
  $$ insert into public.trip_messages (trip_id, sender_id, body, read_at)
     values ('e3910000-0000-4000-8000-000000000001', 'e3900000-0000-4000-8000-000000000002', 'Seen', now()) $$,
  '42501', null,
  'or send it already read');
reset role;

-- Once the trip has ended, the thread is closed to both.
-- Test setup only: unlock the state projection the way trip_transition() does.
select set_config('gera.in_transition', '1', true);
update public.trips set state = 'completed' where id = 'e3910000-0000-4000-8000-000000000001';
select set_config('gera.in_transition', '', true);
set local role authenticated;
set local request.jwt.claims to '{"sub":"e3900000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok(
  $$ insert into public.trip_messages (trip_id, sender_id, body)
     values ('e3910000-0000-4000-8000-000000000001', 'e3900000-0000-4000-8000-000000000002', 'you forgot your bag') $$,
  '42501', null,
  'nobody can message once the trip has ended');
reset role;

select * from finish();
rollback;
