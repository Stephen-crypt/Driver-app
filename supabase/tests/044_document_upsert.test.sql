begin;
select plan(6);

-- Joseph signs up as a rider and sends his national ID, the way the app does:
-- an upsert, which PostgREST turns into INSERT ... ON CONFLICT DO UPDATE SET
-- every column it was given.
insert into auth.users (instance_id, id, aud, role, email)
select '00000000-0000-0000-0000-000000000000', ('e4400000-0000-4000-8000-00000000000' || n)::uuid,
       'authenticated', 'authenticated', 'u' || n || '.e44@test.local' from generate_series(1, 2) n;
insert into public.profiles (id, role, first_name, phone) values
  ('e4400000-0000-4000-8000-000000000001', 'rider', 'Joseph', '+250788994401'),
  ('e4400000-0000-4000-8000-000000000002', 'rider', 'Eric', '+250788994402');
insert into public.riders (id, verification) values
  ('e4400000-0000-4000-8000-000000000001', 'submitted'),
  ('e4400000-0000-4000-8000-000000000002', 'submitted');

set local role authenticated;
set local request.jwt.claims to '{"sub":"e4400000-0000-4000-8000-000000000001","role":"authenticated"}';

prepare app_save(text) as
  insert into public.rider_documents (rider_id, kind, storage_path, updated_at)
  values ('e4400000-0000-4000-8000-000000000001', 'national_id', $1, now())
  on conflict (rider_id, kind) do update
    set rider_id = excluded.rider_id, kind = excluded.kind,
        storage_path = excluded.storage_path, updated_at = excluded.updated_at;

select lives_ok($$ execute app_save('e4400000-0000-4000-8000-000000000001/national_id.jpg') $$,
  'a rider can send a document the way the app saves it');
select lives_ok($$ execute app_save('e4400000-0000-4000-8000-000000000001/national_id.png') $$,
  'and send it again to replace it');

-- What a reviewer decided does not survive a replacement.
reset role;
update public.rider_documents set status = 'rejected', note = 'Blurry'
 where rider_id = 'e4400000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claims to '{"sub":"e4400000-0000-4000-8000-000000000001","role":"authenticated"}';
execute app_save('e4400000-0000-4000-8000-000000000001/national_id.jpg');
select is((select status::text from public.rider_documents where rider_id = 'e4400000-0000-4000-8000-000000000001'), 'pending',
  'a replaced document goes back to waiting for review');

-- Trying to relabel it or hand it to someone else changes nothing.
update public.rider_documents set kind = 'driving_licence'
 where rider_id = 'e4400000-0000-4000-8000-000000000001' and kind = 'national_id';
select is((select count(*)::int from public.rider_documents where rider_id = 'e4400000-0000-4000-8000-000000000001' and kind = 'national_id'), 1,
  'a national ID cannot be relabelled as a licence');
update public.rider_documents set rider_id = 'e4400000-0000-4000-8000-000000000002'
 where rider_id = 'e4400000-0000-4000-8000-000000000001';
reset role;
select is((select count(*)::int from public.rider_documents where rider_id = 'e4400000-0000-4000-8000-000000000002'), 0,
  'nor moved onto another rider');
select ok(
  not has_column_privilege('authenticated', 'public.rider_documents', 'status', 'UPDATE'),
  'and the review status is still the reviewer''s alone');

select * from finish();
rollback;
