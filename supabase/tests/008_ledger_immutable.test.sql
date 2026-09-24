begin;
select plan(6);

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000',
   'dddddddd-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'ledger.driver@test.local');

insert into public.profiles (id, role, first_name, phone)
values ('dddddddd-0000-0000-0000-000000000001', 'driver', 'Eric', '+250788000111');

insert into public.drivers (id, verification)
values ('dddddddd-0000-0000-0000-000000000001', 'verified');

insert into public.ledger_entries (driver_id, kind, amount_rwf)
values ('dddddddd-0000-0000-0000-000000000001', 'topup_credit', 5000);

select lives_ok(
  $$ insert into public.ledger_entries (driver_id, kind, amount_rwf)
     values ('dddddddd-0000-0000-0000-000000000001', 'commission_debit', 300) $$,
  'appending a new entry is allowed'
);

select throws_ok(
  $$ truncate public.ledger_entries $$,
  '42501', null,
  'the ledger cannot be truncated, even as superuser'
);

select ok(
  not has_table_privilege('service_role', 'public.ledger_entries', 'TRUNCATE')
  and not has_table_privilege('anon', 'public.ledger_entries', 'TRUNCATE')
  and not has_table_privilege('authenticated', 'public.ledger_entries', 'TRUNCATE'),
  'no API role holds TRUNCATE on the ledger'
);

select throws_ok(
  $$ update public.ledger_entries set amount_rwf = 1
      where driver_id = 'dddddddd-0000-0000-0000-000000000001' $$,
  '42501', null,
  'a ledger entry cannot be updated, even as superuser'
);

select throws_ok(
  $$ delete from public.ledger_entries
      where driver_id = 'dddddddd-0000-0000-0000-000000000001' $$,
  '42501', null,
  'a ledger entry cannot be deleted, even as superuser'
);

select is(
  (select sum(case when kind in ('topup_credit','adjustment_credit')
                   then amount_rwf else -amount_rwf end)::int
     from public.ledger_entries
    where driver_id = 'dddddddd-0000-0000-0000-000000000001'),
  4700,
  'the balance survives the refused edits'
);

select * from finish();
rollback;
