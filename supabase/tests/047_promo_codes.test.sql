begin;
select plan(19);

-- Aline and Eric book rides. Nova has four codes: a fixed 500 off, a capped
-- 30% with two uses each, one that ended yesterday and one that is paused.
insert into auth.users (instance_id, id, aud, role, email)
select '00000000-0000-0000-0000-000000000000', ('e4700000-0000-4000-8000-00000000000' || n)::uuid,
       'authenticated', 'authenticated', 'u' || n || '.e47@test.local' from generate_series(1, 2) n;
insert into public.profiles (id, role, first_name, phone) values
  ('e4700000-0000-4000-8000-000000000001', 'passenger', 'Aline', '+250788994701'),
  ('e4700000-0000-4000-8000-000000000002', 'passenger', 'Eric', '+250788994702');

insert into public.promo_codes (id, code, code_key, kind, amount_rwf, percent, max_discount_rwf, per_passenger_limit, total_limit, ends_at, paused) values
  ('e47c0000-0000-4000-8000-000000000001', 'NOVA50', 'NOVA50', 'amount', 500, null, null, 1, null, null, false),
  ('e47c0000-0000-4000-8000-000000000002', 'NV-7KQ2', 'NV7KQ2', 'percent', null, 30, 1000, 2, 5, null, false),
  ('e47c0000-0000-4000-8000-000000000003', 'OLD', 'OLD', 'amount', 300, null, null, 1, null, now() - interval '1 day', false),
  ('e47c0000-0000-4000-8000-000000000004', 'RESTING', 'RESTING', 'amount', 300, null, null, 1, null, null, true);

-- The arithmetic.
select is(public.promo_discount_rwf((select p from public.promo_codes p where code = 'NOVA50'), 1400), 500,
  'a fixed amount comes off the fare');
select is(public.promo_discount_rwf((select p from public.promo_codes p where code = 'NOVA50'), 300), 300,
  'but never more than the fare');
select is(public.promo_discount_rwf((select p from public.promo_codes p where code = 'NV-7KQ2'), 1400), 400,
  'a percentage rounds down to whole hundreds (30% of 1,400 is 420)');
select is(public.promo_discount_rwf((select p from public.promo_codes p where code = 'NV-7KQ2'), 9000), 1000,
  'and stops at its cap');

-- Typed any old way, a code is the same code.
select is(public.promo_key('  nv–7kq2 '), 'NV7KQ2', 'case, spaces and dashes do not matter');

set local role authenticated;
set local request.jwt.claims to '{"sub":"e4700000-0000-4000-8000-000000000001","role":"authenticated"}';

select is((select result from public.add_promo_code('nova 50')), 'added', 'a passenger adds a code');
select is((select result from public.add_promo_code('NOVA50')), 'already_added', 'adding it twice is harmless');
select is((select result from public.add_promo_code('OLD')), 'ended', 'an ended code is refused with its reason');
select is((select result from public.add_promo_code('RESTING')), 'paused', 'a paused code says so');
select is((select uses_left from public.add_promo_code('nv-7kq2')), 2, 'adding says how many uses are left');
select is((select count(*)::int from public.my_promos()), 2, 'my_promos lists the two saved codes, not the refused ones');
select is((select status from public.my_promos() where code = 'NOVA50'), 'ready', 'ready to use');
select is((select count(*)::int from public.passenger_promos), 2, 'a passenger sees their own saved codes');

-- Ten wrong tries in an hour, and the eleventh is refused even when right.
select is((select count(*)::int from (select public.add_promo_code('WRONG' || n) from generate_series(1, 10) n) x), 10,
  'ten wrong codes are tried');
select is((select result from public.add_promo_code('NOVA50')), 'too_many_tries', 'the next try within the hour is refused');

reset role;

-- Picking the code for a quote: the one saving most wins; "none" picks
-- nothing; a chosen code is used when it fits.
select is((select code from public.promo_for_quote('e4700000-0000-4000-8000-000000000001', 'moto', 1400, 'best')), 'NOVA50',
  '500 off beats 30% of 1,400 (400)');
select is((select count(*)::int from public.promo_for_quote('e4700000-0000-4000-8000-000000000001', 'moto', 1400, 'none')), 0,
  'none means no code');
select is((select code from public.promo_for_quote('e4700000-0000-4000-8000-000000000001', 'moto', 1400, 'e47c0000-0000-4000-8000-000000000002')), 'NV-7KQ2',
  'a chosen code is used when it fits');

select ok(not has_table_privilege('authenticated', 'public.promo_codes', 'SELECT'), 'codes are not readable from the app');

select * from finish();
rollback;
