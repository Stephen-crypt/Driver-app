begin;
select plan(21);

-- Inspector (IN), fleet (FL), rider (R) with a moto, another rider (R2), passenger (P).
insert into auth.users (instance_id, id, aud, role, email)
select '00000000-0000-0000-0000-000000000000', ('e3400000-0000-4000-8000-00000000000' || n)::uuid,
       'authenticated', 'authenticated', 'u' || n || '.e34@test.local'
  from generate_series(1, 5) n;

insert into public.staff_members (user_id, role, display_name, active) values
  ('e3400000-0000-4000-8000-000000000001', 'inspector', 'Innocent', true),
  ('e3400000-0000-4000-8000-000000000002', 'fleet', 'Fidele', true);
insert into public.profiles (id, role, first_name, phone) values
  ('e3400000-0000-4000-8000-000000000003', 'rider', 'Eric', '+250788993801'),
  ('e3400000-0000-4000-8000-000000000004', 'rider', 'Jean', '+250788993802'),
  ('e3400000-0000-4000-8000-000000000005', 'passenger', 'Aline', '+250788993803');
insert into public.riders (id, verification) values
  ('e3400000-0000-4000-8000-000000000003', 'verified'),
  ('e3400000-0000-4000-8000-000000000004', 'verified');
insert into public.vehicles (id, rider_id, class, plate, vest_number, is_active) values
  ('e3410000-0000-4000-8000-000000000001', 'e3400000-0000-4000-8000-000000000003', 'moto', 'RAE 341 A', '3417', true);

create temp table ids (name text primary key, v text);
grant all on ids to authenticated;

set local role authenticated;

-- ---- the rider's QR ----------------------------------------------------------
set local request.jwt.claims to '{"sub":"e3400000-0000-4000-8000-000000000003","role":"authenticated"}';
insert into ids select 'qr', public.my_rider_qr();
select ok((select v from ids where name = 'qr') ~ '^GERA-R-[0-9A-F]{32}$', 'a rider has a QR code of their own');

-- ---- nobody else looks people up ---------------------------------------------
set local request.jwt.claims to '{"sub":"e3400000-0000-4000-8000-000000000005","role":"authenticated"}';
select throws_ok($$ select public.inspect_lookup((select v from ids where name = 'qr')) $$, '42501', 'not_permitted',
  'a passenger cannot scan a rider');
select throws_ok($$ insert into public.riders (id, verification, rating_sum, rating_count)
                    values ('e3400000-0000-4000-8000-000000000005', 'pending', 5000, 1000) $$,
  '42501', null, 'nor make themselves a rider with a ready-made five-star history');

-- ---- the inspector looks up -------------------------------------------------
set local request.jwt.claims to '{"sub":"e3400000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((public.inspect_lookup((select v from ids where name = 'qr')) -> 'vehicle' ->> 'plate'), 'RAE 341 A',
  'scanning the rider shows the vehicle they have');
select is((public.inspect_lookup('3417') -> 'rider' ->> 'name'), 'Eric', 'a vest number finds the rider');
reset role;
update public.vehicles set vest_number = '34170' where id = 'e3410000-0000-4000-8000-000000000001';
set local role authenticated;
select is((public.inspect_lookup('34170') -> 'rider' ->> 'name'), 'Eric', 'so does a five-digit one');
select is((public.inspect_lookup('rae341a') ->> 'scanned'), 'vehicle', 'a plate typed any old way finds the vehicle');
select throws_ok($$ select public.inspect_lookup('GERA-R-00000000000000000000000000000000') $$, 'P0002', 'not_found',
  'a made-up code finds nobody');

-- ---- recording --------------------------------------------------------------
select throws_ok($$ select public.record_inspection('e3400000-0000-4000-8000-000000000003', null, 'routine',
    '{"wheelie": "pass"}', null, null, null, 'pass', null, null, null, null) $$,
  '22023', 'unknown_check: wheelie', 'only checks on the list can be recorded');
select throws_ok($$ select public.record_inspection('e3400000-0000-4000-8000-000000000003', null, 'routine',
    '{"brakes": "fail"}', null, null, null, 'pass', null, null, null, null) $$,
  '22023', 'result_contradicts_checks', 'a pass cannot be recorded over failed brakes');
select throws_ok($$ select public.record_inspection('e3400000-0000-4000-8000-000000000003', null, 'random',
    '{}', 'positive', null, null, 'fail', null, null, null, null) $$,
  '22023', 'reading_required', 'a positive test needs its reading');
select throws_ok($$ select public.record_inspection('e3400000-0000-4000-8000-000000000003', null, 'routine',
    '{}', null, null, null, 'pass', null, array['someone-else/photo.jpg'], null, null) $$,
  '22023', 'bad_photo_path', 'photos come from the inspector''s own folder');

select lives_ok($$ insert into ids select 'ok', public.record_inspection('e3400000-0000-4000-8000-000000000003',
    'e3410000-0000-4000-8000-000000000001', 'routine',
    '{"identity":"pass","vest":"pass","helmets":"pass","brakes":"pass","lights":"pass"}',
    'negative', 0, 'Dräger 6820', 'pass', null, null, 30.06, -1.95) ->> 'case_number' $$,
  'a clean inspection is recorded');
select is((select v from ids where name = 'ok'), null, 'and opens no case');

select lives_ok($$ insert into ids select 'bad', public.record_inspection('e3400000-0000-4000-8000-000000000003',
    'e3410000-0000-4000-8000-000000000001', 'random', '{"lights":"fail"}',
    'positive', 0.21, 'Dräger 6820', 'fail', 'Rear light out', null, 30.06, -1.95) ->> 'case_number' $$,
  'a random check with a positive test is recorded');

reset role;
select is((select category || ': ' || description from public.support_cases where number = (select v::bigint from ids where name = 'bad')),
  'alcohol_test: Inspection with a positive alcohol test (0.21). Failed: lights. Rear light out.',
  'and becomes a case for someone to review');
select is((select verification::text from public.riders where id = 'e3400000-0000-4000-8000-000000000003'), 'verified',
  'but nobody is suspended by a machine (§48)');

-- ---- who sees what ------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"e3400000-0000-4000-8000-000000000003","role":"authenticated"}';
select is((select count(*)::int from public.inspections), 2, 'a rider sees what was recorded about them');
set local request.jwt.claims to '{"sub":"e3400000-0000-4000-8000-000000000004","role":"authenticated"}';
select is((select count(*)::int from public.inspections), 0, 'and no other rider does');

-- ---- a lost sticker -----------------------------------------------------------
set local request.jwt.claims to '{"sub":"e3400000-0000-4000-8000-000000000002","role":"authenticated"}';
insert into ids select 'old_sticker', public.staff_vehicle_qr('e3410000-0000-4000-8000-000000000001');
select isnt(public.staff_vehicle_qr('e3410000-0000-4000-8000-000000000001', true), (select v from ids where name = 'old_sticker'),
  'fleet reprints a sticker with a new code');
set local request.jwt.claims to '{"sub":"e3400000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$ select public.inspect_lookup((select v from ids where name = 'old_sticker')) $$, 'P0002', 'not_found',
  'and the old sticker stops working');

select * from finish();
rollback;
