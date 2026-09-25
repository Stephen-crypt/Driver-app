begin;
select plan(4);

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000','f0000000-0000-4000-8000-000000000001',
   'authenticated','authenticated','s.passenger@test.local'),
  ('00000000-0000-0000-0000-000000000000','f0000000-0000-4000-8000-000000000002',
   'authenticated','authenticated','s.rider@test.local');

insert into public.profiles (id, role, first_name, phone) values
  ('f0000000-0000-4000-8000-000000000001','passenger','Aline','+250788960001'),
  ('f0000000-0000-4000-8000-000000000002','rider','Eric','+250788960002');

insert into public.riders (id, verification)
values ('f0000000-0000-4000-8000-000000000002','verified');

insert into public.trips (id, passenger_id, vehicle_class, state,
                          pickup, pickup_label, dropoff, dropoff_label)
values ('f1000000-0000-4000-8000-000000000001',
        'f0000000-0000-4000-8000-000000000001','moto','requested',
        st_point(30.0619,-1.9441)::geography,'A',
        st_point(30.0588,-1.9536)::geography,'B');

-- One already past its window, written directly so the test does not sleep.
insert into public.trip_offers (id, trip_id, rider_id, rank, eta_seconds, expires_at)
values ('f2000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001',
        'f0000000-0000-4000-8000-000000000002', 1, 120, now() - interval '1 second');

select is(public.expire_stale_offers(), 1, 'the sweeper reports what it expired');

select is(
  (select outcome from public.trip_offers where id='f2000000-0000-4000-8000-000000000001'),
  'timed_out',
  'the stale offer is marked timed_out'
);

select is(public.expire_stale_offers(), 0, 'a second sweep finds nothing to do');

select ok(
  not has_function_privilege('authenticated', 'public.expire_stale_offers()', 'EXECUTE'),
  'riders cannot expire their own offers'
);

select * from finish();
rollback;
