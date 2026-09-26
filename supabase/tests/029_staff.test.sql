begin;
select plan(20);

-- A control-room operator (CR), a finance officer (FI), a fleet manager (FL),
-- an admin (AD), a former staff member (EX), a passenger (P) and a rider (R).
insert into auth.users (instance_id, id, aud, role, email)
select '00000000-0000-0000-0000-000000000000', ('e9000000-0000-4000-8000-00000000000' || n)::uuid,
       'authenticated', 'authenticated', 'u' || n || '.e9@test.local'
  from generate_series(1, 7) n;

insert into public.staff_members (user_id, role, display_name, active) values
  ('e9000000-0000-4000-8000-000000000001', 'control_room', 'Claudine', true),
  ('e9000000-0000-4000-8000-000000000002', 'finance', 'Fabrice', true),
  ('e9000000-0000-4000-8000-000000000003', 'fleet', 'Fidele', true),
  ('e9000000-0000-4000-8000-000000000004', 'admin', 'Ange', true),
  ('e9000000-0000-4000-8000-000000000005', 'operations', 'Former', false);

insert into public.profiles (id, role, first_name, phone) values
  ('e9000000-0000-4000-8000-000000000006', 'passenger', 'Aline', '+250788990601'),
  ('e9000000-0000-4000-8000-000000000007', 'rider', 'Eric', '+250788990701');
insert into public.riders (id, verification) values ('e9000000-0000-4000-8000-000000000007', 'verified');

insert into public.vehicles (id, rider_id, class, plate, is_active) values
  ('e9100000-0000-4000-8000-000000000001', 'e9000000-0000-4000-8000-000000000007', 'moto', 'RAE 901A', true),
  ('e9100000-0000-4000-8000-000000000002', null, 'moto', 'RAE 902A', false);

insert into public.sos_alerts (id, raised_by, source, position)
values ('e9200000-0000-4000-8000-000000000001', 'e9000000-0000-4000-8000-000000000006',
        'passenger', st_point(30.06, -1.94)::geography);

set local role authenticated;

-- ---- who is not staff ------------------------------------------------------
set local request.jwt.claims to '{"sub":"e9000000-0000-4000-8000-000000000006","role":"authenticated"}';
select throws_ok($$ select * from public.staff_live_riders() $$, '42501', 'not_permitted',
  'a passenger cannot open the control room');
select is((select count(*)::int from public.sos_alerts), 1,
  'a passenger still sees their own alert');

set local request.jwt.claims to '{"sub":"e9000000-0000-4000-8000-000000000007","role":"authenticated"}';
select is((select count(*)::int from public.sos_alerts), 0,
  'a rider cannot read someone else''s SOS');

set local request.jwt.claims to '{"sub":"e9000000-0000-4000-8000-000000000005","role":"authenticated"}';
select throws_ok($$ select * from public.staff_open_alerts() $$, '42501', 'not_permitted',
  'a deactivated staff member has no access left');

-- ---- nobody grants themselves a role ------------------------------------
set local request.jwt.claims to '{"sub":"e9000000-0000-4000-8000-000000000006","role":"authenticated"}';
select throws_ok(
  $$ insert into public.staff_members (user_id, role, display_name)
     values ('e9000000-0000-4000-8000-000000000006', 'admin', 'Me') $$,
  '42501', null, 'a passenger cannot make themselves staff');

set local request.jwt.claims to '{"sub":"e9000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ update public.staff_members set role = 'admin' where user_id = 'e9000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'nor can staff promote themselves');

-- ---- the control room ------------------------------------------------------
select is((select person_name from public.staff_open_alerts() where id = 'e9200000-0000-4000-8000-000000000001'), 'Aline',
  'the control room sees who raised the alert');
select is((select count(*)::int from public.sos_alerts where id = 'e9200000-0000-4000-8000-000000000001'), 1,
  'and can read alerts directly, which is what realtime delivers to them');
select throws_ok($$ select public.staff_resolve_sos('e9200000-0000-4000-8000-000000000001', 'ok') $$,
  '22023', 'resolution_required', 'an alert cannot be closed without saying what happened');
select lives_ok(
  $$ select public.staff_resolve_sos('e9200000-0000-4000-8000-000000000001',
       'Called Aline; she was safe, the rider had taken a wrong turn') $$,
  'with an account of what happened, it can');
select throws_ok($$ select public.staff_pay_rider('e9000000-0000-4000-8000-000000000007', 1000, 'x') $$,
  '42501', 'not_permitted', 'the control room cannot pay riders');

-- ---- finance ---------------------------------------------------------------
set local request.jwt.claims to '{"sub":"e9000000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok($$ select public.staff_suspend_rider('e9000000-0000-4000-8000-000000000007', 'Because I said so') $$,
  '42501', 'not_permitted', 'finance cannot suspend a rider');
select lives_ok($$ select public.staff_adjust_earnings('e9000000-0000-4000-8000-000000000007', 500, 'bonus', 'Rainy week') $$,
  'finance can add a bonus');
select throws_ok($$ select public.staff_adjust_earnings('e9000000-0000-4000-8000-000000000007', 500, 'fare_collected', 'x') $$,
  '22023', 'only_bonus_or_deduction', 'but cannot write a fake fare into the ledger');

-- ---- the fleet -------------------------------------------------------------
set local request.jwt.claims to '{"sub":"e9000000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok($$ select public.staff_create_vehicle('moto', 'rae  901a', null) $$,
  '23505', 'plate_exists', 'a plate already in the fleet cannot be added twice, however it is spaced');
select lives_ok($$ select public.staff_assign_vehicle('e9100000-0000-4000-8000-000000000002', 'e9000000-0000-4000-8000-000000000007') $$,
  'the fleet hands a depot moto to a rider');
select is(
  (select array_agg(plate order by plate) from public.staff_vehicles() where rider_id = 'e9000000-0000-4000-8000-000000000007'),
  array['RAE 902A'],
  'and the moto they had goes back to the depot - one vehicle per rider');

set local role postgres;
insert into public.shifts (rider_id, vehicle_id, safety_checks)
values ('e9000000-0000-4000-8000-000000000007', 'e9100000-0000-4000-8000-000000000002', '{}');
set local role authenticated;
set local request.jwt.claims to '{"sub":"e9000000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok($$ select public.staff_assign_vehicle('e9100000-0000-4000-8000-000000000002', null) $$,
  '23514', 'vehicle_on_shift', 'a vehicle cannot be taken back while it is out on a shift');

-- ---- the audit trail -------------------------------------------------------
set local role postgres;
select is(
  (select array_agg(action || ' by ' || actor_name order by id) from public.audit_log
    where target_id in ('e9200000-0000-4000-8000-000000000001', 'e9000000-0000-4000-8000-000000000007',
                        'e9100000-0000-4000-8000-000000000002')),
  array['sos.resolve by Claudine', 'earnings.bonus by Fabrice', 'vehicle.assign by Fidele'],
  'every action is recorded with who took it');

select ok(
  not has_function_privilege('anon', 'public.staff_live_riders()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.staff_suspend_rider(uuid, text)', 'EXECUTE'),
  'none of it is reachable without signing in');

select * from finish();
rollback;
