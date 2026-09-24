begin;
select plan(6);

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000','b0000000-0000-4000-8000-000000000001',
   'authenticated','authenticated','poor.driver@test.local'),
  ('00000000-0000-0000-0000-000000000000','b0000000-0000-4000-8000-000000000002',
   'authenticated','authenticated','rich.driver@test.local');

insert into public.profiles (id, role, first_name, phone) values
  ('b0000000-0000-4000-8000-000000000001','driver','Poor','+250788930001'),
  ('b0000000-0000-4000-8000-000000000002','driver','Rich','+250788930002');

insert into public.drivers (id, verification) values
  ('b0000000-0000-4000-8000-000000000001','verified'),
  ('b0000000-0000-4000-8000-000000000002','verified');

-- Poor: 400 credited then 100 debited = 300, below the 500 minimum.
insert into public.ledger_entries (driver_id, kind, amount_rwf) values
  ('b0000000-0000-4000-8000-000000000001','topup_credit',400),
  ('b0000000-0000-4000-8000-000000000001','commission_debit',100),
  ('b0000000-0000-4000-8000-000000000002','topup_credit',5000);

select is(public.driver_balance('b0000000-0000-4000-8000-000000000001'), 300,
  'credits add and debits subtract');

select is(public.driver_balance('b0000000-0000-4000-8000-000000000002'), 5000,
  'a driver with only a top-up has that balance');

select is(public.driver_balance('b0000000-0000-4000-8000-000000000002'), 5000,
  'balance is derived, never stored');

select ok(not public.can_go_online('b0000000-0000-4000-8000-000000000001'),
  'a driver below the minimum cannot go online');

select ok(public.can_go_online('b0000000-0000-4000-8000-000000000002'),
  'a driver above the minimum can go online');

set local role authenticated;
set local request.jwt.claims to
  '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}';

select throws_ok(
  $$ insert into public.driver_presence (driver_id, status, vehicle_class, position)
     values ('b0000000-0000-4000-8000-000000000001','online','moto',
             st_point(30.0619,-1.9441)::geography) $$,
  '42501', null,
  'an underfunded driver is refused entry to the dispatch index'
);

select * from finish();
rollback;
