begin;
select plan(7);

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000',
   '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'convert.a@test.local');

-- This user already registered as a rider. Under the old three-insert client
-- flow their first driver insert always collided and they could never become a
-- driver at all.
insert into public.profiles (id, role, first_name, phone) values
  ('11111111-1111-1111-1111-111111111111', 'rider', 'Aline', '+250700000001');

set local role authenticated;
set local request.jwt.claims to
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select lives_ok(
  $$ select public.register_driver(
       'Aline', '+250788123456', 'LIC-001', 'RAD 123 B', '77', 'moto') $$,
  'a rider can register as a driver over their existing profile'
);

-- The wedge case: a partial failure previously left no way forward. Every write
-- is an upsert now, so the identical submission simply succeeds again.
select lives_ok(
  $$ select public.register_driver(
       'Aline', '+250788123456', 'LIC-001', 'RAD 123 B', '77', 'moto') $$,
  're-submitting the same details succeeds instead of wedging'
);

select is(
  (select verification::text from public.drivers
    where id = '11111111-1111-1111-1111-111111111111'),
  'submitted',
  'the driver lands in submitted, never verified'
);

select is(
  (select role::text from public.profiles
    where id = '11111111-1111-1111-1111-111111111111'),
  'driver',
  'the profile role flipped from rider to driver'
);

select is(
  (select count(*)::int from public.vehicles
    where driver_id = '11111111-1111-1111-1111-111111111111'),
  1,
  'the re-submit updated the vehicle rather than duplicating it'
);

-- Unverified drivers still cannot enter the dispatch index (see 0007).
select throws_ok(
  $$ insert into public.driver_presence (driver_id, status, vehicle_class, position)
     values ('11111111-1111-1111-1111-111111111111', 'online', 'moto',
             st_point(30.0619, -1.9441)::geography) $$,
  '42501', null,
  'submitting for verification does not itself grant dispatchability'
);

select ok(
  not has_function_privilege(
    'anon', 'public.register_driver(text,text,text,text,text,vehicle_class)', 'EXECUTE'),
  'anon cannot execute register_driver'
);

select * from finish();
rollback;
