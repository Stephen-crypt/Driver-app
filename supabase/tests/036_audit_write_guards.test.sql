begin;
select plan(9);

-- A rider (R) with a moto, and a signed-up phone user (P) without a profile.
insert into auth.users (instance_id, id, aud, role, email, phone)
values ('00000000-0000-0000-0000-000000000000', 'e3600000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'r.e36@test.local', '250788994001'),
       ('00000000-0000-0000-0000-000000000000', 'e3600000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', null, '250788994002');
insert into public.profiles (id, role, first_name, phone) values
  ('e3600000-0000-4000-8000-000000000001', 'rider', 'Eric', '+250788994001');
insert into public.riders (id, verification) values ('e3600000-0000-4000-8000-000000000001', 'verified');
insert into public.vehicles (rider_id, class, plate, is_active) values ('e3600000-0000-4000-8000-000000000001', 'moto', 'RAE 360 A', true);
insert into public.shifts (rider_id, vehicle_id, safety_checks)
select rider_id, id, '{}'::jsonb from public.vehicles where rider_id = 'e3600000-0000-4000-8000-000000000001';

set local role authenticated;
set local request.jwt.claims to '{"sub":"e3600000-0000-4000-8000-000000000001","role":"authenticated"}';

-- ---- documents ------------------------------------------------------------------
select throws_ok($$ insert into public.rider_documents (rider_id, kind, storage_path, status)
                    values ('e3600000-0000-4000-8000-000000000001', 'national_id', 'e36/id.jpg', 'approved') $$,
  '42501', null, 'a rider cannot upload a document already approved');
insert into public.rider_documents (rider_id, kind, storage_path)
values ('e3600000-0000-4000-8000-000000000001', 'national_id', 'e3600000-0000-4000-8000-000000000001/national_id.jpg');
reset role;
update public.rider_documents set status = 'rejected', note = 'Blurred' where rider_id = 'e3600000-0000-4000-8000-000000000001';
set local role authenticated;
update public.rider_documents set storage_path = storage_path, updated_at = now() where rider_id = 'e3600000-0000-4000-8000-000000000001';
select is((select status::text || '/' || coalesce(note, '-') from public.rider_documents where rider_id = 'e3600000-0000-4000-8000-000000000001'),
  'pending/-', 'uploading again after a rejection puts it back in the queue');

-- ---- presence ----------------------------------------------------------------------
insert into public.rider_presence (rider_id, status, vehicle_class, position, heartbeat_at)
values ('e3600000-0000-4000-8000-000000000001', 'online', 'cab', st_point(30.06, -1.94)::geography, now() + interval '1 day');
select is((select vehicle_class::text from public.rider_presence where rider_id = 'e3600000-0000-4000-8000-000000000001'), 'moto',
  'a moto rider cannot claim to be a cab');
select ok((select heartbeat_at <= now() from public.rider_presence where rider_id = 'e3600000-0000-4000-8000-000000000001'),
  'nor stay "alive" with a heartbeat from the future');

-- ---- track points --------------------------------------------------------------------
select ok(not has_table_privilege('authenticated', 'public.trip_track_points', 'INSERT'),
  'track points only arrive through publish_track_point, never written directly');
select ok(not has_table_privilege('authenticated', 'public.trip_track_points', 'UPDATE'),
  'nor rewritten afterwards');

-- ---- profiles --------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"e3600000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok($$ insert into public.profiles (id, role, first_name) values ('e3600000-0000-4000-8000-000000000002', 'rider', 'Me') $$,
  '42501', null, 'a client cannot create a rider profile; riders register through register_rider');
insert into public.profiles (id, role, first_name, phone)
values ('e3600000-0000-4000-8000-000000000002', 'passenger', 'Aline', '+250788000000');
select is((select phone from public.profiles where id = 'e3600000-0000-4000-8000-000000000002'), '+250788994002',
  'the phone on a profile is the one they signed in with, not one they typed');
select ok(has_column_privilege('authenticated', 'public.profiles', 'first_name', 'UPDATE'), 'and they can still change their name');

select * from finish();
rollback;
