begin;
select plan(8);

-- Kimironko market as the pickup.
-- near      : ~300m away, moto, online, verified, fresh heartbeat  -> candidate
-- far       : ~5km away                                            -> outside radius
-- cab       : next to `near` but a cab                             -> wrong class
-- stale     : next to `near`, heartbeat 2 minutes old              -> app is dead
-- unverified: next to `near`, verification 'submitted'             -> not vetted
-- busy      : next to `near`, already on a trip                    -> committed
insert into auth.users (instance_id, id, aud, role, email)
select '00000000-0000-0000-0000-000000000000',
       ('d0000000-0000-4000-8000-00000000000' || n)::uuid,
       'authenticated','authenticated','m' || n || '@test.local'
  from generate_series(1,7) n;

insert into public.profiles (id, role, first_name, phone)
select ('d0000000-0000-4000-8000-00000000000' || n)::uuid,
       case when n = 7 then 'rider'::user_role else 'driver'::user_role end,
       'D' || n, '+25078894000' || n
  from generate_series(1,7) n;

insert into public.drivers (id, verification)
select ('d0000000-0000-4000-8000-00000000000' || n)::uuid,
       case when n = 5 then 'submitted'::verification_status else 'verified'::verification_status end
  from generate_series(1,6) n;

insert into public.ledger_entries (driver_id, kind, amount_rwf)
select ('d0000000-0000-4000-8000-00000000000' || n)::uuid, 'topup_credit', 5000
  from generate_series(1,6) n;

insert into public.driver_presence (driver_id, status, vehicle_class, position, heartbeat_at) values
  ('d0000000-0000-4000-8000-000000000001','online','moto', st_point(30.0650,-1.9441)::geography, now()),
  ('d0000000-0000-4000-8000-000000000002','online','moto', st_point(30.1200,-1.9441)::geography, now()),
  ('d0000000-0000-4000-8000-000000000003','online','cab',  st_point(30.0650,-1.9441)::geography, now()),
  ('d0000000-0000-4000-8000-000000000004','online','moto', st_point(30.0650,-1.9441)::geography, now() - interval '2 minutes'),
  ('d0000000-0000-4000-8000-000000000005','online','moto', st_point(30.0650,-1.9441)::geography, now()),
  ('d0000000-0000-4000-8000-000000000006','online','moto', st_point(30.0650,-1.9441)::geography, now());

insert into public.trips (id, rider_id, driver_id, vehicle_class, state,
                          pickup, pickup_label, dropoff, dropoff_label)
values ('d1000000-0000-4000-8000-000000000001',
        'd0000000-0000-4000-8000-000000000007','d0000000-0000-4000-8000-000000000006',
        'moto','accepted',
        st_point(30.0619,-1.9441)::geography,'X',
        st_point(30.0588,-1.9536)::geography,'Y');

select is(
  (select count(*)::int from public.find_candidate_drivers(
     st_point(30.0619,-1.9441)::geography, 'moto', 2000, 10)),
  1,
  'exactly one driver survives every filter'
);

select is(
  (select driver_id from public.find_candidate_drivers(
     st_point(30.0619,-1.9441)::geography, 'moto', 2000, 10)),
  'd0000000-0000-4000-8000-000000000001'::uuid,
  'and it is the near, fresh, verified, idle moto'
);

select ok(
  (select distance_m from public.find_candidate_drivers(
     st_point(30.0619,-1.9441)::geography, 'moto', 2000, 10)) < 500,
  'the reported distance is in metres, not degrees'
);

select is(
  (select count(*)::int from public.find_candidate_drivers(
     st_point(30.0619,-1.9441)::geography, 'moto', 20000, 10)),
  2,
  'widening the radius reaches the far driver'
);

select is(
  (select count(*)::int from public.find_candidate_drivers(
     st_point(30.0619,-1.9441)::geography, 'cab', 2000, 10)),
  1,
  'a cab request matches the cab, not the motos'
);

select is(
  (select count(*)::int from public.find_candidate_drivers(
     st_point(30.0619,-1.9441)::geography, 'moto', 20000, 1)),
  1,
  'the limit is respected'
);

select ok(
  not has_function_privilege('authenticated',
    'public.find_candidate_drivers(geography,vehicle_class,integer,integer)', 'EXECUTE'),
  'riders cannot enumerate nearby drivers'
);

-- The wrapper must agree with the function it wraps, or the dispatcher and the
-- tests are measuring different things.
select is(
  (select count(*)::int from public.find_candidates_for_trip(
     'd1000000-0000-4000-8000-000000000001', 20000, 10)),
  (select count(*)::int from public.find_candidate_drivers(
     st_point(30.0619,-1.9441)::geography, 'moto', 20000, 10)),
  'the trip-keyed wrapper returns what the geography form returns'
);

select * from finish();
rollback;
