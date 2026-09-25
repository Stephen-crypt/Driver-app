begin;
select plan(12);

-- The fleet's go-online gate. It replaced a marketplace float minimum, and the
-- two conditions are different in kind: a vehicle is something the company
-- gives a rider, and a cash ceiling is something the rider has to work off.
-- Telling them the wrong one wastes their day, so both are tested separately.

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000','b0000000-0000-4000-8000-000000000001',
   'authenticated','authenticated','novehicle.rider@test.local'),
  ('00000000-0000-0000-0000-000000000000','b0000000-0000-4000-8000-000000000002',
   'authenticated','authenticated','clear.rider@test.local'),
  ('00000000-0000-0000-0000-000000000000','b0000000-0000-4000-8000-000000000003',
   'authenticated','authenticated','loaded.rider@test.local'),
  ('00000000-0000-0000-0000-000000000000','b0000000-0000-4000-8000-000000000004',
   'authenticated','authenticated','deverified.rider@test.local');

insert into public.profiles (id, role, first_name, phone) values
  ('b0000000-0000-4000-8000-000000000001','rider','Novehicle','+250788930001'),
  ('b0000000-0000-4000-8000-000000000002','rider','Clear','+250788930002'),
  ('b0000000-0000-4000-8000-000000000003','rider','Loaded','+250788930003'),
  ('b0000000-0000-4000-8000-000000000004','rider','Revoked','+250788930004');

insert into public.riders (id, verification) values
  ('b0000000-0000-4000-8000-000000000001','verified'),
  ('b0000000-0000-4000-8000-000000000002','verified'),
  ('b0000000-0000-4000-8000-000000000003','verified'),
  ('b0000000-0000-4000-8000-000000000004','verified');

-- Everyone but Novehicle has a vehicle: the company owns them, so this is the
-- thing that decides whether a rider is working at all.
insert into public.vehicles (rider_id, class, plate, is_active) values
  ('b0000000-0000-4000-8000-000000000002','moto','RAB 002A',true),
  ('b0000000-0000-4000-8000-000000000003','moto','RAB 003A',true),
  ('b0000000-0000-4000-8000-000000000004','moto','RAB 004A',true);

-- Loaded is carrying one franc more of company cash than the ceiling allows.
-- Clear collected the same and handed it all back, which is the point of
-- tracking remittances separately: the same fares, a different answer.
insert into public.ledger_entries (rider_id, kind, amount_rwf) values
  ('b0000000-0000-4000-8000-000000000003','fare_collected',
   (select max_cash_held_rwf + 1 from public.platform_settings)),
  ('b0000000-0000-4000-8000-000000000002','fare_collected', 30000),
  ('b0000000-0000-4000-8000-000000000002','cash_remittance', 30000);

select ok(
  public.can_go_online_internal('b0000000-0000-4000-8000-000000000002'),
  'a rider with a vehicle and no cash outstanding may work'
);

select ok(
  not public.can_go_online_internal('b0000000-0000-4000-8000-000000000001'),
  'a rider with no vehicle may not, however clean their cash'
);

select ok(
  not public.can_go_online_internal('b0000000-0000-4000-8000-000000000003'),
  'a rider one franc over the cash ceiling may not'
);

select is(
  public.rider_cash_held_internal('b0000000-0000-4000-8000-000000000002'),
  0,
  'remitting everything clears what the rider is carrying'
);

-- The two readings must not contaminate each other. A remittance moves cash
-- without touching earnings; a bonus moves earnings without touching cash.
select is(
  public.rider_net_owed_internal('b0000000-0000-4000-8000-000000000002'),
  0,
  'and collecting then remitting earns the rider nothing by itself'
);

insert into public.ledger_entries (rider_id, kind, amount_rwf) values
  ('b0000000-0000-4000-8000-000000000002','bonus', 5000);

select is(
  public.rider_cash_held_internal('b0000000-0000-4000-8000-000000000002'),
  0,
  'a bonus does not change what the rider is carrying'
);

select is(
  public.rider_net_owed_internal('b0000000-0000-4000-8000-000000000002'),
  5000,
  'it changes what they are owed'
);

-- Going over the ceiling MID-SHIFT is the case that matters, because the trip
-- that does it is the rider's own completed fare. This is the trap Phase 2b
-- shipped in the marketplace version: the gate made the presence row
-- unwritable, so the rider could neither heartbeat nor go offline.
set local role authenticated;
set local request.jwt.claims to
  '{"sub":"b0000000-0000-4000-8000-000000000002","role":"authenticated"}';

select lives_ok(
  $$ insert into public.rider_presence (rider_id, status, vehicle_class, position)
     values ('b0000000-0000-4000-8000-000000000002','online','moto',
             st_point(30.06,-1.94)::geography) $$,
  'a clear rider goes online'
);

set local role postgres;
insert into public.ledger_entries (rider_id, kind, amount_rwf) values
  ('b0000000-0000-4000-8000-000000000002','fare_collected',
   (select max_cash_held_rwf + 1 from public.platform_settings));

select ok(
  not public.can_go_online_internal('b0000000-0000-4000-8000-000000000002'),
  'their own completed fare has now pushed them over the ceiling'
);

set local role authenticated;
set local request.jwt.claims to
  '{"sub":"b0000000-0000-4000-8000-000000000002","role":"authenticated"}';

select lives_ok(
  $$ update public.rider_presence
        set position = st_point(30.07,-1.95)::geography, heartbeat_at = now()
      where rider_id = 'b0000000-0000-4000-8000-000000000002' $$,
  'but they can still heartbeat - the gate must not trap a rider mid-shift'
);

select lives_ok(
  $$ update public.rider_presence set status = 'offline'
      where rider_id = 'b0000000-0000-4000-8000-000000000002' $$,
  'and they can still go offline, which is how they get to remit'
);

set local role postgres;
update public.riders set verification = 'rejected'
 where id = 'b0000000-0000-4000-8000-000000000004';

set local role authenticated;
set local request.jwt.claims to
  '{"sub":"b0000000-0000-4000-8000-000000000004","role":"authenticated"}';

select throws_ok(
  $$ insert into public.rider_presence (rider_id, status, vehicle_class, position)
     values ('b0000000-0000-4000-8000-000000000004','online','moto',
             st_point(30.06,-1.94)::geography) $$,
  '42501', null,
  'a rider whose verification was revoked cannot enter the dispatch index'
);

select * from finish();
rollback;
