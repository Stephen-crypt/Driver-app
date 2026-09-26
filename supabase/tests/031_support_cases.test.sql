begin;
select plan(17);

-- Support (SU), a passenger (P), a second passenger (Q), a rider (R).
insert into auth.users (instance_id, id, aud, role, email)
select '00000000-0000-0000-0000-000000000000', ('e3100000-0000-4000-8000-00000000000' || n)::uuid,
       'authenticated', 'authenticated', 'u' || n || '.e31@test.local'
  from generate_series(1, 4) n;

insert into public.staff_members (user_id, role, display_name, active) values
  ('e3100000-0000-4000-8000-000000000001', 'support', 'Sandrine', true);
insert into public.profiles (id, role, first_name, phone) values
  ('e3100000-0000-4000-8000-000000000002', 'passenger', 'Aline', '+250788993501'),
  ('e3100000-0000-4000-8000-000000000003', 'passenger', 'Bosco', '+250788993502'),
  ('e3100000-0000-4000-8000-000000000004', 'rider', 'Eric', '+250788993503');
insert into public.riders (id, verification) values ('e3100000-0000-4000-8000-000000000004', 'verified');

insert into public.trips (id, passenger_id, rider_id, vehicle_class, state,
                          pickup, pickup_label, dropoff, dropoff_label)
values ('e3110000-0000-4000-8000-000000000001',
        'e3100000-0000-4000-8000-000000000002', 'e3100000-0000-4000-8000-000000000004', 'moto', 'completed',
        st_point(30.0619, -1.9441)::geography, 'Kimironko',
        st_point(30.0588, -1.9536)::geography, 'Kigali Heights');

insert into public.device_tokens (user_id, token) values
  ('e3100000-0000-4000-8000-000000000002', 'ExponentPushToken[e31-aline]');

create temp table ids (name text primary key, id uuid);
grant all on ids to authenticated;

set local role authenticated;

-- ---- a passenger reports ---------------------------------------------------
set local request.jwt.claims to '{"sub":"e3100000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok($$ select public.open_case('lost_property', 'e3110000-0000-4000-8000-000000000001', 'phone') $$,
  '22023', 'describe_it', 'a one-word report is not enough to act on');
select throws_ok($$ select public.open_case('vehicle', null, 'The brakes squeal a lot') $$,
  '22023', 'use_rider_report', 'vehicle faults come through the rider app');
select lives_ok($$ insert into ids select 'lost', (public.open_case('lost_property',
    'e3110000-0000-4000-8000-000000000001', 'Left my black Samsung phone on the seat')).id $$,
  'a passenger reports a phone left behind');
select is((select reporter_role || '/' || rider_id::text from public.support_cases where id = (select id from ids where name = 'lost')),
  'passenger/e3100000-0000-4000-8000-000000000004',
  'the case knows who reported it and which rider had the trip');

set local request.jwt.claims to '{"sub":"e3100000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok($$ select public.open_case('complaint', 'e3110000-0000-4000-8000-000000000001', 'Someone else''s trip, pretending') $$,
  '42501', 'not_your_trip', 'nobody reports on a trip they were not on');
select is((select count(*)::int from public.support_cases where trip_id = 'e3110000-0000-4000-8000-000000000001'), 0,
  'nor reads someone else''s case');
select throws_ok($$ select public.staff_cases('open', null) $$, '42501', 'not_permitted',
  'a passenger cannot open the support queue');

-- ---- a rider's report joins the queue --------------------------------------
set local request.jwt.claims to '{"sub":"e3100000-0000-4000-8000-000000000004","role":"authenticated"}';
reset role;
insert into public.rider_reports (rider_id, trip_id, kind, note)
values ('e3100000-0000-4000-8000-000000000004', 'e3110000-0000-4000-8000-000000000001', 'vehicle_problem', 'flat');
set local role authenticated;
select is((select kind::text || '|' || description from public.support_cases
            where rider_report_id is not null and rider_id = 'e3100000-0000-4000-8000-000000000004'),
  'vehicle|Vehicle Problem: flat',
  'a one-word rider report still becomes a readable vehicle case');

-- ---- support works the case ------------------------------------------------
set local request.jwt.claims to '{"sub":"e3100000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.staff_cases('open', null)
            where trip_id = 'e3110000-0000-4000-8000-000000000001'), 2,
  'support sees both cases in the open queue');
select lives_ok($$ select public.staff_take_case((select id from ids where name = 'lost')) $$,
  'support takes the lost phone');
select lives_ok($$ select public.staff_add_case_note((select id from ids where name = 'lost'), 'Called Eric, he has it at the depot') $$,
  'and writes an internal note');
select throws_ok($$ select public.staff_resolve_case((select id from ids where name = 'lost'), 'ok') $$,
  '22023', 'resolution_required', 'a case cannot be closed without saying how');
select lives_ok($$ select public.staff_resolve_case((select id from ids where name = 'lost'),
    'Your phone is at the Remera depot. Bring your ID to collect it.') $$,
  'support resolves it with instructions for the passenger');
select is((public.staff_case_detail((select id from ids where name = 'lost')) -> 'notes' -> 0 ->> 'author'), 'Sandrine',
  'the note carries who wrote it');

set local request.jwt.claims to '{"sub":"e3100000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select status::text || ': ' || resolution from public.support_cases where id = (select id from ids where name = 'lost')),
  'resolved: Your phone is at the Remera depot. Bring your ID to collect it.',
  'the passenger sees the resolution');
select throws_ok($$ select * from public.support_case_notes $$, '42501', null,
  'but never the staff''s internal notes');

reset role;
select is((select count(*)::int from net.http_request_queue
            where convert_from(body, 'utf8')::jsonb ->> 'to' = 'ExponentPushToken[e31-aline]'
              and convert_from(body, 'utf8')::jsonb ->> 'title' like 'Report #% resolved'), 1,
  'and is told it was resolved');

select * from finish();
rollback;
