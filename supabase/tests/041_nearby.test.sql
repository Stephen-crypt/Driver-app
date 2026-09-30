begin;
select plan(7);

-- Four riders around Nyarugenge: two free motos close by, a cab too far away,
-- and a moto whose phone went quiet five minutes ago. Aline is the passenger.
insert into auth.users (instance_id, id, aud, role, email)
select '00000000-0000-0000-0000-000000000000', ('e4100000-0000-4000-8000-00000000000' || n)::uuid,
       'authenticated', 'authenticated', 'u' || n || '.e41@test.local' from generate_series(1, 5) n;
insert into public.profiles (id, role, first_name, phone) values
  ('e4100000-0000-4000-8000-000000000001', 'rider', 'Eric', '+250788994101'),
  ('e4100000-0000-4000-8000-000000000002', 'rider', 'Jean', '+250788994102'),
  ('e4100000-0000-4000-8000-000000000003', 'rider', 'Claude', '+250788994103'),
  ('e4100000-0000-4000-8000-000000000004', 'rider', 'Paul', '+250788994104'),
  ('e4100000-0000-4000-8000-000000000005', 'passenger', 'Aline', '+250788994105');
insert into public.riders (id, verification)
select ('e4100000-0000-4000-8000-00000000000' || n)::uuid, 'verified' from generate_series(1, 4) n;

-- Clear anything the seed or another test left online, so the counts are ours.
delete from public.rider_presence;
insert into public.rider_presence (rider_id, status, vehicle_class, position, heartbeat_at) values
  ('e4100000-0000-4000-8000-000000000001', 'online', 'moto', st_point(30.0620, -1.9440)::geography, now()),
  ('e4100000-0000-4000-8000-000000000002', 'online', 'moto', st_point(30.0700, -1.9460)::geography, now()),
  ('e4100000-0000-4000-8000-000000000003', 'online', 'cab', st_point(30.1500, -1.9900)::geography, now()),
  ('e4100000-0000-4000-8000-000000000004', 'online', 'moto', st_point(30.0621, -1.9441)::geography, now() - interval '5 minutes');

set local role authenticated;
set local request.jwt.claims to '{"sub":"e4100000-0000-4000-8000-000000000005","role":"authenticated"}';

select is((select riders from public.riders_nearby(30.0619, -1.9441) where vehicle_class = 'moto'), 2,
  'counts the free motos nearby, not the one gone quiet');
select ok((select nearest_m from public.riders_nearby(30.0619, -1.9441) where vehicle_class = 'moto') < 50,
  'and says how far the closest one is');
select is((select count(*)::int from public.riders_nearby(30.0619, -1.9441) where vehicle_class = 'cab'), 0,
  'a cab ten kilometres away is not nearby');
select is((select count(*)::int from public.landmarks_near(30.0619, -1.9441, 4)), 4,
  'landmarks_near returns as many places as asked for');
select ok(
  (select bool_and(d1 <= d2) from (
     select distance_m as d1, lead(distance_m) over (order by distance_m) as d2
       from public.landmarks_near(30.0619, -1.9441, 6)
   ) x where d2 is not null),
  'nearest first');
reset role;

set local role anon;
select throws_ok($$ select * from public.riders_nearby(30.0619, -1.9441) $$, '42501', null,
  'someone not signed in cannot count riders');
select throws_ok($$ select * from public.landmarks_near(30.0619, -1.9441, 3) $$, '42501', null,
  'or list places');
reset role;

select * from finish();
rollback;
