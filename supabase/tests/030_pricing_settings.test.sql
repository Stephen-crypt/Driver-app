begin;
select plan(14);

-- Finance (FI), operations (OP), safety (SA), and a passenger (P).
insert into auth.users (instance_id, id, aud, role, email)
select '00000000-0000-0000-0000-000000000000', ('e3000000-0000-4000-8000-00000000000' || n)::uuid,
       'authenticated', 'authenticated', 'u' || n || '.e3@test.local'
  from generate_series(1, 4) n;

insert into public.staff_members (user_id, role, display_name, active) values
  ('e3000000-0000-4000-8000-000000000001', 'finance', 'Fabrice', true),
  ('e3000000-0000-4000-8000-000000000002', 'operations', 'Olive', true),
  ('e3000000-0000-4000-8000-000000000003', 'safety', 'Sam', true);
insert into public.profiles (id, role, first_name, phone) values
  ('e3000000-0000-4000-8000-000000000004', 'passenger', 'Aline', '+250788993401');

create temp table before_policy as select * from public.current_fare_policy('moto');
grant select on before_policy to authenticated;

set local role authenticated;

-- ---- prices ----------------------------------------------------------------
set local request.jwt.claims to '{"sub":"e3000000-0000-4000-8000-000000000004","role":"authenticated"}';
select throws_ok($$ select * from public.staff_fare_policies() $$, '42501', 'not_permitted',
  'a passenger cannot read the pricing desk');

set local request.jwt.claims to '{"sub":"e3000000-0000-4000-8000-000000000002","role":"authenticated"}';
select ok((select count(*) from public.staff_fare_policies() where vehicle_class = 'moto' and current) = 1,
  'operations can read the price in force');
select throws_ok($$ select public.staff_set_fare_policy('moto', 300, 300, 30, 800, 15, null) $$,
  '42501', 'not_permitted', 'but cannot change it');

set local request.jwt.claims to '{"sub":"e3000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$ select public.staff_set_fare_policy('moto', 300, 300, 30, 800, 95, null) $$,
  '22023', 'commission_out_of_range', 'commission cannot exceed 90%');
select throws_ok($$ select public.staff_set_fare_policy('moto', 300, 300, 30, 800, 15, now() - interval '1 day') $$,
  '22023', 'cannot_backdate', 'a price cannot start in the past');
select lives_ok($$ select public.staff_set_fare_policy('moto', 350, 320, 30, 900, 12, null) $$,
  'finance sets a new moto price');

reset role;
select is((select base_rwf from public.current_fare_policy('moto')), 350,
  'the new price is the one in force');
select is((select effective_to from public.fare_policies where id = (select id from before_policy)), now(),
  'the old price ends exactly where the new one starts');
select is((select count(*)::int from public.audit_log where action = 'pricing.change'
            and actor_id = 'e3000000-0000-4000-8000-000000000001'), 1,
  'the change is in the audit log');
set local role authenticated;

-- ---- settings --------------------------------------------------------------
set local request.jwt.claims to '{"sub":"e3000000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok($$ select public.staff_update_setting('require_ride_pin', 'false') $$,
  '42501', 'not_permitted', 'operations cannot switch off the ride PIN');
select throws_ok($$ select public.staff_update_setting('wait_grace_seconds', '10') $$,
  '22023', 'out_of_range', 'a 10-second grace period is refused');
select throws_ok($$ select public.staff_update_setting('search_radius; drop table trips', '1') $$,
  '22023', 'unknown_setting', 'only named settings can be written');
select lives_ok($$ select public.staff_update_setting('wait_grace_seconds', '240') $$,
  'operations sets the grace period');

set local request.jwt.claims to '{"sub":"e3000000-0000-4000-8000-000000000003","role":"authenticated"}';
select is((select (public.staff_settings() ->> 'wait_grace_seconds')::int), 240,
  'and every desk sees the new value');

select * from finish();
rollback;
