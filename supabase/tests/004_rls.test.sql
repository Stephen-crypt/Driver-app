begin;
select plan(15);

-- Two riders and one driver, created directly so we control the ids.
-- instance_id/aud/role are supplied explicitly: auth.users has no defaults for
-- them, and omitting them fails with a confusing not-null error.
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000',
   '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'rider.a@test.local'),
  ('00000000-0000-0000-0000-000000000000',
   '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'rider.b@test.local'),
  ('00000000-0000-0000-0000-000000000000',
   '33333333-3333-3333-3333-333333333333',
   'authenticated', 'authenticated', 'driver.c@test.local'),
  ('00000000-0000-0000-0000-000000000000',
   '44444444-4444-4444-4444-444444444444',
   'authenticated', 'authenticated', 'newcomer.d@test.local');

insert into public.profiles (id, role, first_name, phone) values
  ('11111111-1111-1111-1111-111111111111', 'rider',  'Aline', '+250700000001'),
  ('22222222-2222-2222-2222-222222222222', 'rider',  'Bosco', '+250700000002'),
  ('33333333-3333-3333-3333-333333333333', 'driver', 'Eric',  '+250700000003');

insert into public.drivers (id, verification) values
  ('33333333-3333-3333-3333-333333333333', 'verified');

insert into public.trips
  (id, rider_id, vehicle_class, state, pickup, pickup_label, dropoff, dropoff_label)
values (
  'aaaaaaaa-0000-0000-0000-000000000001',
  '11111111-1111-1111-1111-111111111111',
  'moto',
  'requested',
  st_point(30.0619, -1.9441)::geography, 'Kimironko Market',
  st_point(30.0588, -1.9536)::geography, 'Kigali Heights'
);

insert into public.ledger_entries (driver_id, kind, amount_rwf)
values ('33333333-3333-3333-3333-333333333333', 'topup_credit', 5000);

-- Act as rider A.
set local role authenticated;
set local request.jwt.claims to
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is(
  (select count(*)::int from public.trips),
  1,
  'rider A sees their own trip'
);

select is(
  (select count(*)::int from public.profiles
    where id = '22222222-2222-2222-2222-222222222222'),
  0,
  'rider A cannot read rider B profile'
);

select is(
  (select count(*)::int from public.profiles
    where id = '33333333-3333-3333-3333-333333333333'),
  0,
  'rider A cannot read the driver profile before a trip is accepted'
);

-- RLS denies an UPDATE by making the row invisible, not by raising. So the
-- statement succeeds, touches nothing, and the assertion that matters is that
-- the state did not move.
select lives_ok(
  $$ update public.trips set state = 'completed'
      where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  'a direct state update raises no error'
);

select is(
  (select state::text from public.trips
    where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'requested',
  'but trips.state is unchanged - only trip_transition() can move it'
);

select throws_ok(
  $$ insert into public.ledger_entries (driver_id, kind, amount_rwf)
     values ('33333333-3333-3333-3333-333333333333', 'topup_credit', 999999) $$,
  '42501',
  null,
  'no client can mint ledger entries'
);

select throws_ok(
  $$ insert into public.trips
       (rider_id, vehicle_class, state, pickup, pickup_label, dropoff, dropoff_label)
     values ('11111111-1111-1111-1111-111111111111', 'moto', 'completed',
             st_point(30.0619, -1.9441)::geography, 'A',
             st_point(30.0588, -1.9536)::geography, 'B') $$,
  '42501', null,
  'a rider cannot insert a trip that is already completed'
);

select throws_ok(
  $$ insert into public.trips
       (rider_id, driver_id, vehicle_class, state, pickup, pickup_label, dropoff, dropoff_label)
     values ('11111111-1111-1111-1111-111111111111',
             '33333333-3333-3333-3333-333333333333', 'moto', 'requested',
             st_point(30.0619, -1.9441)::geography, 'A',
             st_point(30.0588, -1.9536)::geography, 'B') $$,
  '42501', null,
  'a rider cannot self-assign a driver, bypassing dispatch'
);

select throws_ok(
  $$ insert into public.trip_transition_rules (from_state, to_state, actor)
     values ('requested', 'completed', 'rider') $$,
  '42501', null,
  'a client cannot rewrite the trip state machine rules'
);

-- Act as rider B.
set local request.jwt.claims to
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select is(
  (select count(*)::int from public.trips),
  0,
  'rider B cannot see rider A trips'
);

-- Privilege escalation: ownership alone is not enough on the drivers table.
select throws_ok(
  $$ insert into public.drivers (id, verification)
     values ('22222222-2222-2222-2222-222222222222', 'verified') $$,
  '42501',
  null,
  'a user cannot register themselves as an already-verified driver'
);

-- Act as the driver, who has not been offered this trip.
set local request.jwt.claims to
  '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

select is(
  (select count(*)::int from public.trips),
  0,
  'a driver cannot see a trip they were never offered'
);

select is(
  (select count(*)::int from public.ledger_entries),
  1,
  'a driver reads their own ledger'
);

select is(
  (select count(*)::int from public.profiles
    where id = '11111111-1111-1111-1111-111111111111'),
  0,
  'a driver cannot read rider contact details before accepting'
);

-- Act as a brand-new user with no profile row yet.
set local request.jwt.claims to
  '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';

select throws_ok(
  $$ insert into public.profiles (id, role, first_name, phone)
     values ('44444444-4444-4444-4444-444444444444', 'ops', 'Mallory', '+250700000004') $$,
  '42501', null,
  'a new user cannot register themselves as ops'
);

select * from finish();
rollback;
