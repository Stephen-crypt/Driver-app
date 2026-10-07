begin;
select plan(8);

-- Aline raises an SOS; Eric is someone else.
insert into auth.users (instance_id, id, aud, role, email)
select '00000000-0000-0000-0000-000000000000', ('e4300000-0000-4000-8000-00000000000' || n)::uuid,
       'authenticated', 'authenticated', 'u' || n || '.e43@test.local' from generate_series(1, 2) n;
insert into public.profiles (id, role, first_name, phone) values
  ('e4300000-0000-4000-8000-000000000001', 'passenger', 'Aline', '+250788994301'),
  ('e4300000-0000-4000-8000-000000000002', 'passenger', 'Eric', '+250788994302');

insert into public.sos_alerts (id, raised_by, source, position, note) values
  ('e4300000-0000-4000-8000-0000000000a1', 'e4300000-0000-4000-8000-000000000001', 'passenger',
   st_point(30.0619, -1.9441)::geography, 'He will not stop'),
  ('e4300000-0000-4000-8000-0000000000a2', 'e4300000-0000-4000-8000-000000000001', 'passenger', null, null);
insert into public.sos_alerts (id, raised_by, source, created_at) values
  ('e4300000-0000-4000-8000-0000000000a3', 'e4300000-0000-4000-8000-000000000002', 'passenger', now() - interval '1 hour');

-- Nobody signed in to an app may claim: only the function with the service key.
select ok(not has_function_privilege('authenticated', 'public.claim_sos_text(uuid, uuid)', 'execute'),
  'an app user cannot claim an alert for texting');
select ok(not has_function_privilege('anon', 'public.release_sos_text(uuid)', 'execute'),
  'nor give a claim back');

select is(
  (select row(first_name, lng, lat, note)::text from public.claim_sos_text('e4300000-0000-4000-8000-0000000000a1', 'e4300000-0000-4000-8000-000000000001')),
  row('Aline', 30.0619::double precision, -1.9441::double precision, 'He will not stop')::text,
  'the first claim returns who, where and what they wrote');
select is((select count(*)::int from public.claim_sos_text('e4300000-0000-4000-8000-0000000000a1', 'e4300000-0000-4000-8000-000000000001')), 0,
  'the same alert is never texted twice');
select is((select count(*)::int from public.claim_sos_text('e4300000-0000-4000-8000-0000000000a2', 'e4300000-0000-4000-8000-000000000001')), 0,
  'a second press within two minutes does not send a second text');

select public.release_sos_text('e4300000-0000-4000-8000-0000000000a1');
select is((select texted_at from public.sos_alerts where id = 'e4300000-0000-4000-8000-0000000000a1'), null,
  'a claim given back after a failed send can be claimed again');

select is((select count(*)::int from public.claim_sos_text('e4300000-0000-4000-8000-0000000000a1', 'e4300000-0000-4000-8000-000000000002')), 0,
  'someone else cannot have your alert texted');
select is((select count(*)::int from public.claim_sos_text('e4300000-0000-4000-8000-0000000000a3', 'e4300000-0000-4000-8000-000000000002')), 0,
  'an alert an hour old is not texted - the dashboard still has it');

select * from finish();
rollback;
