begin;
select plan(7);

insert into auth.users (instance_id, id, aud, role, email)
select '00000000-0000-0000-0000-000000000000', ('e4200000-0000-4000-8000-00000000000' || n)::uuid,
       'authenticated', 'authenticated', 'u' || n || '.e42@test.local' from generate_series(1, 2) n;
insert into public.profiles (id, role, first_name, phone) values
  ('e4200000-0000-4000-8000-000000000001', 'passenger', 'Aline', '+250788994201'),
  ('e4200000-0000-4000-8000-000000000002', 'passenger', 'Claude', '+250788994202');

select public.notify_user('e4200000-0000-4000-8000-000000000001', 'Trip complete', 'Pay 1700 RWF in cash.',
                          '{"kind":"trip","tripId":"x"}'::jsonb);
select public.notify_user('e4200000-0000-4000-8000-000000000001', 'New moto trip', 'Accept within 15 seconds.',
                          '{"kind":"offer"}'::jsonb);

set local role authenticated;
set local request.jwt.claims to '{"sub":"e4200000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.notifications), 1, 'a notification is kept for the person it was for');
select is((select title from public.notifications limit 1), 'Trip complete', 'with its title');
select is((select count(*)::int from public.notifications where kind = 'offer'), 0, 'offers are not kept');
update public.notifications set read_at = now();
select is((select count(*)::int from public.notifications where read_at is not null), 1, 'the owner marks it read');
select throws_ok($$ update public.notifications set title = 'Pay 0 RWF' $$, '42501', null, 'but cannot rewrite it');
select throws_ok($$ insert into public.notifications (user_id, title, body) values (auth.uid(), 'x', 'y') $$, '42501', null,
  'or write one');
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"e4200000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.notifications), 0, 'nobody else sees it');
reset role;

select * from finish();
rollback;
