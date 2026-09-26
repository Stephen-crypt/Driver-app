begin;
select plan(8);

-- Each assertion here pins a hole that was open until 0041. They are written
-- as the attack, not as a grant check, so a future policy that re-opens the
-- door by another route still fails them.
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000','d8000000-0000-4000-8000-000000000001','authenticated','authenticated','r.d8@test.local'),
  ('00000000-0000-0000-0000-000000000000','d8000000-0000-4000-8000-000000000002','authenticated','authenticated','p.d8@test.local');

insert into public.profiles (id, role, first_name, phone) values
  ('d8000000-0000-4000-8000-000000000001','rider','Eric','+250788980001'),
  ('d8000000-0000-4000-8000-000000000002','passenger','Aline','+250788980002');
insert into public.riders (id, verification) values ('d8000000-0000-4000-8000-000000000001','verified');

-- A company vehicle, assigned to Eric, and a spare in the depot.
insert into public.vehicles (id, rider_id, class, plate, is_active) values
  ('d8100000-0000-4000-8000-000000000001', 'd8000000-0000-4000-8000-000000000001', 'moto', 'RAD 801A', true),
  ('d8100000-0000-4000-8000-000000000002', null, 'moto', 'RAD 802A', false);

set local role authenticated;
set local request.jwt.claims to '{"sub":"d8000000-0000-4000-8000-000000000001","role":"authenticated"}';

select throws_ok(
  $$ insert into public.vehicles (rider_id, class, plate, is_active)
     values ('d8000000-0000-4000-8000-000000000001', 'cab', 'SELF 001', true) $$,
  '42501', null,
  'a rider cannot give themselves a vehicle');

select throws_ok(
  $$ update public.vehicles set rider_id = 'd8000000-0000-4000-8000-000000000001', is_active = true
      where id = 'd8100000-0000-4000-8000-000000000002' $$,
  '42501', null,
  'nor take one from the depot');

select throws_ok(
  $$ delete from public.vehicles where id = 'd8100000-0000-4000-8000-000000000001' $$,
  '42501', null,
  'nor delete the one they were given');

select is(
  (select plate from public.vehicles),
  'RAD 801A',
  'they can still see the vehicle assigned to them, and only that one');

set local request.jwt.claims to '{"sub":"d8000000-0000-4000-8000-000000000002","role":"authenticated"}';

select throws_ok(
  $$ update public.profiles set role = 'ops' where id = 'd8000000-0000-4000-8000-000000000002' $$,
  '42501', null,
  'a passenger cannot promote themselves');

select throws_ok(
  $$ update public.profiles set phone = '+250788000000' where id = 'd8000000-0000-4000-8000-000000000002' $$,
  '42501', null,
  'nor change the verified number riders call');

select lives_ok(
  $$ update public.profiles set first_name = 'Aline M.' where id = 'd8000000-0000-4000-8000-000000000002' $$,
  'but they can still change the name riders see');

-- Scoped to the application's own tables. The extensions' objects (PostGIS,
-- pgTAP) belong to supabase_admin and are not ours to change.
select ok(
  not exists (
    select 1 from information_schema.role_table_grants g
      join pg_class c on c.relname = g.table_name
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     where g.table_schema = 'public' and g.privilege_type = 'TRUNCATE'
       and g.grantee in ('anon', 'authenticated')
       and pg_get_userbyid(c.relowner) = 'postgres'
  ),
  'no client role can truncate any application table, and TRUNCATE ignores RLS');

select * from finish();
rollback;
