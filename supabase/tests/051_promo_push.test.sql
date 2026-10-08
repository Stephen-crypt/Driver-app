begin;
select plan(1);

-- Aline rides 1,800 with 500 off; the "Trip complete" push must name what
-- she pays, the same figure both apps show.
insert into auth.users (instance_id, id, aud, role, email)
select '00000000-0000-0000-0000-000000000000', ('e5100000-0000-4000-8000-00000000000' || n)::uuid,
       'authenticated', 'authenticated', 'u' || n || '.e51@test.local' from generate_series(1, 2) n;
insert into public.profiles (id, role, first_name, phone) values
  ('e5100000-0000-4000-8000-000000000001', 'passenger', 'Aline', '+250788995101'),
  ('e5100000-0000-4000-8000-000000000002', 'rider', 'Eric', '+250788995102');
insert into public.riders (id, verification) values ('e5100000-0000-4000-8000-000000000002', 'verified');
insert into public.promo_codes (id, code, code_key, kind, amount_rwf)
values ('e51c0000-0000-4000-8000-000000000001', 'NOVA50', 'NOVA50', 'amount', 500);
insert into public.fare_quotes (id, passenger_id, policy_id, vehicle_class, distance_m, duration_s, amount_rwf, expires_at, promo_id, promo_discount_rwf)
values ('e51a0000-0000-4000-8000-000000000001', 'e5100000-0000-4000-8000-000000000001',
        (select id from public.fare_policies where vehicle_class = 'moto' and effective_to is null limit 1),
        'moto', 5000, 900, 1800, now() + interval '2 minutes', 'e51c0000-0000-4000-8000-000000000001', 500);
insert into public.trips (id, passenger_id, rider_id, vehicle_class, state, pickup, pickup_label, dropoff, dropoff_label,
                          quoted_distance_m, quoted_duration_s, quote_id, quoted_amount_rwf)
values ('e5110000-0000-4000-8000-000000000001', 'e5100000-0000-4000-8000-000000000001', 'e5100000-0000-4000-8000-000000000002',
        'moto', 'in_progress', st_point(30.06, -1.94)::geography, 'A', st_point(30.10, -1.95)::geography, 'B',
        5000, 900, 'e51a0000-0000-4000-8000-000000000001', 1800);

set local role authenticated;
set local request.jwt.claims to '{"sub":"e5100000-0000-4000-8000-000000000002","role":"authenticated"}';
select public.complete_trip('e5110000-0000-4000-8000-000000000001', 5000, 'c-e51');
reset role;

select is((select body from public.notifications
            where user_id = 'e5100000-0000-4000-8000-000000000001' and title = 'Trip complete'),
          'Pay 1300 RWF in cash.', 'the completion push names what the passenger pays after the promo');

select * from finish();
rollback;
