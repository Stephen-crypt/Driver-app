begin;
select plan(6);

-- Olive runs operations, Claudine the control room; Eric is a rider.
insert into auth.users (instance_id, id, aud, role, email)
select '00000000-0000-0000-0000-000000000000', ('e5500000-0000-4000-8000-00000000000' || n)::uuid,
       'authenticated', 'authenticated', 'u' || n || '.e55@test.local'
  from generate_series(1, 3) n;
insert into public.staff_members (user_id, role, display_name, active) values
  ('e5500000-0000-4000-8000-000000000001', 'operations', 'Olive', true),
  ('e5500000-0000-4000-8000-000000000002', 'control_room', 'Claudine', true);
insert into public.profiles (id, role, first_name, phone) values
  ('e5500000-0000-4000-8000-000000000003', 'rider', 'Eric', '+250788995501');
insert into public.riders (id, verification) values ('e5500000-0000-4000-8000-000000000003', 'verified');

-- A zone that has already raised an alert.
insert into public.zones (id, name, kind, area, alert_on_enter)
values ('e5510000-0000-4000-8000-000000000001', 'Qwroad works', 'restricted',
        st_geogfromtext('POLYGON((22.0 -1.95, 22.01 -1.95, 22.01 -1.94, 22.0 -1.94, 22.0 -1.95))'), true);
insert into public.geo_alerts (kind, rider_id, zone_id, position, detail)
values ('zone_enter', 'e5500000-0000-4000-8000-000000000003', 'e5510000-0000-4000-8000-000000000001',
        st_point(22.005, -1.945)::geography, 'Entered Qwroad works');

set local role authenticated;
set local request.jwt.claims to '{"sub":"e5500000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok($$ select public.staff_delete_zone('e5510000-0000-4000-8000-000000000001') $$,
  '42501', 'not_permitted', 'the control room watches zones but does not delete them');

set local request.jwt.claims to '{"sub":"e5500000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok($$ select public.staff_delete_zone('e5510000-0000-4000-8000-000000000001') $$, 'operations deletes a zone');
select throws_ok($$ select public.staff_delete_zone('e5510000-0000-4000-8000-000000000001') $$,
  'P0002', 'zone_not_found', 'a zone already gone cannot be deleted again');
reset role;

select is((select count(*)::int from public.zones where id = 'e5510000-0000-4000-8000-000000000001'), 0, 'the zone is gone');
select is((select coalesce(zone_id::text, 'none') || ' / ' || detail from public.geo_alerts where rider_id = 'e5500000-0000-4000-8000-000000000003'),
  'none / Entered Qwroad works', 'its old alerts stay, still saying which zone they were about');
select is((select detail ->> 'name' from public.audit_log where action = 'zone.delete' and target_id = 'e5510000-0000-4000-8000-000000000001'),
  'Qwroad works', 'the deletion is in the audit log with the zone''s name');

select * from finish();
rollback;
