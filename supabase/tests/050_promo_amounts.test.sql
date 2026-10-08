begin;
select plan(3);

-- Aline rode with a 500-off code and has another ride booked ahead with one.
insert into auth.users (instance_id, id, aud, role, email)
select '00000000-0000-0000-0000-000000000000', ('e5000000-0000-4000-8000-00000000000' || n)::uuid,
       'authenticated', 'authenticated', 'u' || n || '.e50@test.local' from generate_series(1, 2) n;
insert into public.profiles (id, role, first_name, phone) values
  ('e5000000-0000-4000-8000-000000000001', 'passenger', 'Aline', '+250788995001'),
  ('e5000000-0000-4000-8000-000000000002', 'rider', 'Eric', '+250788995002');
insert into public.riders (id, verification) values ('e5000000-0000-4000-8000-000000000002', 'verified');
insert into public.promo_codes (id, code, code_key, kind, amount_rwf, per_passenger_limit)
values ('e50c0000-0000-4000-8000-000000000001', 'NOVA50', 'NOVA50', 'amount', 500, 5);
insert into public.fare_quotes (id, passenger_id, policy_id, vehicle_class, distance_m, duration_s, amount_rwf, expires_at, promo_id, promo_discount_rwf)
select ('e50a0000-0000-4000-8000-00000000000' || n)::uuid, 'e5000000-0000-4000-8000-000000000001',
       (select id from public.fare_policies where vehicle_class = 'moto' and effective_to is null limit 1),
       'moto', 5000, 900, 2000, now() + interval '2 minutes', 'e50c0000-0000-4000-8000-000000000001', 500
  from generate_series(1, 2) n;
insert into public.trips (id, passenger_id, rider_id, vehicle_class, state, pickup, pickup_label, dropoff, dropoff_label,
                          quoted_distance_m, quoted_duration_s, quote_id, quoted_amount_rwf, scheduled_for)
values
  ('e5010000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000002',
   'moto', 'in_progress', st_point(30.06, -1.94)::geography, 'A', st_point(30.10, -1.95)::geography, 'B',
   5000, 900, 'e50a0000-0000-4000-8000-000000000001', 2000, null),
  ('e5010000-0000-4000-8000-000000000002', 'e5000000-0000-4000-8000-000000000001', null,
   'moto', 'scheduled', st_point(30.06, -1.94)::geography, 'A', st_point(30.10, -1.95)::geography, 'B',
   5000, 900, 'e50a0000-0000-4000-8000-000000000002', 2000, now() + interval '1 day');

set local role authenticated;
set local request.jwt.claims to '{"sub":"e5000000-0000-4000-8000-000000000002","role":"authenticated"}';
select public.complete_trip('e5010000-0000-4000-8000-000000000001', 5000, 'c-e50');

select is((select amount_rwf from public.my_trip_history('rider') where id = 'e5010000-0000-4000-8000-000000000001'), 2000,
  'the rider''s history shows what the ride was worth');

set local request.jwt.claims to '{"sub":"e5000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select amount_rwf from public.my_trip_history('passenger') where id = 'e5010000-0000-4000-8000-000000000001'), 1500,
  'the passenger''s history shows what they paid');
select is((select quoted_amount_rwf from public.my_upcoming_rides() where id = 'e5010000-0000-4000-8000-000000000002'), 1500,
  'and a ride booked ahead shows what they will pay');

select * from finish();
rollback;
