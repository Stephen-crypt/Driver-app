begin;
select plan(6);

-- Aline rides with Eric; Solange is on the support desk, Felix in finance.
insert into auth.users (instance_id, id, aud, role, email)
select '00000000-0000-0000-0000-000000000000', ('e4000000-0000-4000-8000-00000000000' || n)::uuid,
       'authenticated', 'authenticated', 'u' || n || '.e40@test.local' from generate_series(1, 4) n;
insert into public.profiles (id, role, first_name, phone) values
  ('e4000000-0000-4000-8000-000000000001', 'passenger', 'Aline', '+250788994401'),
  ('e4000000-0000-4000-8000-000000000002', 'rider', 'Eric', '+250788994402');
insert into public.riders (id, verification) values ('e4000000-0000-4000-8000-000000000002', 'verified');
insert into public.staff_members (user_id, role, display_name, active) values
  ('e4000000-0000-4000-8000-000000000003', 'support', 'Solange', true),
  ('e4000000-0000-4000-8000-000000000004', 'finance', 'Felix', true);
insert into public.fare_quotes (id, passenger_id, policy_id, vehicle_class, distance_m, duration_s, amount_rwf, expires_at)
values ('e4020000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001',
        (select id from public.fare_policies where vehicle_class = 'moto' and effective_to is null limit 1),
        'moto', 5000, 900, 2000, now() + interval '2 minutes');
insert into public.trips (id, passenger_id, rider_id, vehicle_class, state, pickup, pickup_label, dropoff, dropoff_label,
                          quoted_distance_m, quoted_duration_s, quote_id, quoted_amount_rwf)
values ('e4010000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000002',
        'moto', 'accepted', st_point(30.06, -1.94)::geography, 'A', st_point(30.10, -1.95)::geography, 'B',
        5000, 900, 'e4020000-0000-4000-8000-000000000001', 2000);

-- Eric messages, gets no answer, and cancels saying why.
set local role authenticated;
set local request.jwt.claims to '{"sub":"e4000000-0000-4000-8000-000000000002","role":"authenticated"}';
insert into public.trip_messages (trip_id, sender_id, body)
values ('e4010000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000002', 'I''m outside');
select public.trip_transition('e4010000-0000-4000-8000-000000000001', 'cancelled_by_rider', 'e40-cancel',
                              '{"reason":"The passenger isn''t answering"}'::jsonb);
reset role;

-- The desk reads both.
set local role authenticated;
set local request.jwt.claims to '{"sub":"e4000000-0000-4000-8000-000000000003","role":"authenticated"}';
select is(jsonb_array_length(public.staff_trip_detail('e4010000-0000-4000-8000-000000000001')->'messages'), 1,
  'support sees the thread');
select is(public.staff_trip_detail('e4010000-0000-4000-8000-000000000001')->'messages'->0->>'from', 'rider',
  'each message says which side sent it');
select is(public.staff_trip_detail('e4010000-0000-4000-8000-000000000001')->'messages'->0->>'body', 'I''m outside',
  'with what they said');
select is((select e->>'reason' from jsonb_array_elements(public.staff_trip_detail('e4010000-0000-4000-8000-000000000001')->'events') e
            where e->>'to' = 'cancelled_by_rider'),
  'The passenger isn''t answering',
  'the cancellation carries its reason');
select is((select count(*)::int from public.staff_search('NV-E40100') where kind = 'trip' and id = 'e4010000-0000-4000-8000-000000000001'), 1,
  'the desk finds the trip by the booking reference on its ticket');
reset role;

-- Finance has no business reading a private thread.
set local role authenticated;
set local request.jwt.claims to '{"sub":"e4000000-0000-4000-8000-000000000004","role":"authenticated"}';
select throws_ok($$ select public.staff_trip_detail('e4010000-0000-4000-8000-000000000001') $$,
  '42501', null, 'finance cannot open the trip detail');
reset role;

select * from finish();
rollback;
