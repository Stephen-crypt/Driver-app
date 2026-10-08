begin;
select plan(16);

-- Diane runs operations, Felix is in finance, Aline is a passenger.
insert into auth.users (instance_id, id, aud, role, email)
select '00000000-0000-0000-0000-000000000000', ('e4900000-0000-4000-8000-00000000000' || n)::uuid,
       'authenticated', 'authenticated', 'u' || n || '.e49@test.local' from generate_series(1, 4) n;
insert into public.profiles (id, role, first_name, phone) values
  ('e4900000-0000-4000-8000-000000000003', 'passenger', 'Aline', '+250788994903'),
  ('e4900000-0000-4000-8000-000000000004', 'rider', 'Eric', '+250788994904');
insert into public.riders (id, verification) values ('e4900000-0000-4000-8000-000000000004', 'verified');
insert into public.staff_members (user_id, role, display_name, active) values
  ('e4900000-0000-4000-8000-000000000001', 'operations', 'Diane', true),
  ('e4900000-0000-4000-8000-000000000002', 'finance', 'Felix', true);

set local role authenticated;
set local request.jwt.claims to '{"sub":"e4900000-0000-4000-8000-000000000001","role":"authenticated"}';

select is((select code from public.staff_create_promo(p_code => 'nova 50', p_kind => 'amount', p_amount_rwf => 500,
                                                      p_note => 'Launch week')),
  'NOVA50', 'operations creates a code; it is stored in capitals without spaces');
reset role;
select is((select count(*)::int from public.audit_log where action = 'promo.create' and detail ->> 'code' = 'NOVA50'), 1,
  'and the audit log says so');
set local role authenticated;
select throws_ok($$ select public.staff_create_promo(p_code => 'Nova-50', p_kind => 'amount', p_amount_rwf => 300) $$,
  '23505', 'promo_code_taken', 'a code that matches an existing one when typed is refused');
select matches((select code from public.staff_create_promo(p_kind => 'percent', p_percent => 30, p_max_discount_rwf => 1000)),
  '^NV-[A-HJKMNP-Z2-9]{4}$', 'with no code given, one is made up from characters that cannot be misread');
select throws_ok($$ select public.staff_create_promo(p_code => 'EMPTY1', p_kind => 'amount') $$,
  '22023', 'invalid_promo', 'an amount code needs an amount');
select throws_ok($$ select public.staff_create_promo(p_code => 'NV', p_kind => 'amount', p_amount_rwf => 300) $$,
  '22023', 'invalid_promo', 'a code needs at least four letters or digits');

create temp table batch as
select code from public.staff_create_promo_batch(p_count => 5, p_kind => 'amount', p_amount_rwf => 1000, p_note => 'Apology');
select is((select count(distinct code)::int from batch), 5, 'a batch makes as many different codes as asked');
select is((select count(*)::int from public.staff_promos() s join batch b using (code)
            where s.per_passenger_limit = 1 and s.total_limit = 1), 5, 'each single-use');
select is((select count(distinct s.batch_id)::int from public.staff_promos() s join batch b using (code)), 1,
  'and they share a batch');
select throws_ok($$ select public.staff_create_promo_batch(p_count => 201, p_kind => 'amount', p_amount_rwf => 100) $$,
  '22023', 'invalid_promo', 'no more than 200 at a time');

select lives_ok($$ select public.staff_set_promo_paused((select id from public.staff_promos() where code = 'NOVA50'), true) $$,
  'operations pauses a code');
select is((select status from public.staff_promos() where code = 'NOVA50'), 'paused', 'and it shows as paused');

-- Two trips used NOVA50: one finished, one under way.
reset role;
update public.promo_codes set paused = false, per_passenger_limit = 5 where code_key = 'NOVA50';
insert into public.fare_quotes (id, passenger_id, policy_id, vehicle_class, distance_m, duration_s, amount_rwf, expires_at, promo_id, promo_discount_rwf)
select ('e4920000-0000-4000-8000-00000000000' || n)::uuid, 'e4900000-0000-4000-8000-000000000003',
       (select id from public.fare_policies where vehicle_class = 'moto' and effective_to is null limit 1),
       'moto', 5000, 900, 2000, now() + interval '2 minutes', (select id from public.promo_codes where code_key = 'NOVA50'), 500
  from generate_series(1, 2) n;
insert into public.trips (id, passenger_id, rider_id, vehicle_class, state, pickup, pickup_label, dropoff, dropoff_label,
                          quoted_distance_m, quoted_duration_s, quote_id, quoted_amount_rwf)
select ('e4910000-0000-4000-8000-00000000000' || n)::uuid, 'e4900000-0000-4000-8000-000000000003', 'e4900000-0000-4000-8000-000000000004',
       'moto', s.state::public.trip_state, st_point(30.06, -1.94)::geography, 'A', st_point(30.10, -1.95)::geography, 'B',
       5000, 900, ('e4920000-0000-4000-8000-00000000000' || n)::uuid, 2000
  from (values (1, 'completed'), (2, 'in_progress')) s(n, state);

set local role authenticated;
set local request.jwt.claims to '{"sub":"e4900000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select uses || ' uses, ' || cost_rwf || ' RWF' from public.staff_promos() where code = 'NOVA50'), '2 uses, 500 RWF',
  'finance sees uses (finished and under way) and the cost of finished rides');
select is((select phone_tail from public.staff_promo_trips((select id from public.staff_promos() where code = 'NOVA50')) limit 1),
  '903', 'and the trips that used it, with the last digits of the phone');
select throws_ok($$ select public.staff_create_promo(p_code => 'FELIX1', p_kind => 'amount', p_amount_rwf => 500) $$,
  '42501', 'not_permitted', 'finance cannot make codes');

set local request.jwt.claims to '{"sub":"e4900000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok($$ select * from public.staff_promos() $$, '42501', 'not_permitted', 'a passenger cannot list codes');

select * from finish();
rollback;
