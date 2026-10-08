begin;
select plan(18);

-- Aline (passenger) has saved four codes; Eric (passenger) has saved one;
-- Olivier rides. Quotes are for a 5 km moto ride at 1,400.
insert into auth.users (instance_id, id, aud, role, email)
select '00000000-0000-0000-0000-000000000000', ('e4800000-0000-4000-8000-00000000000' || n)::uuid,
       'authenticated', 'authenticated', 'u' || n || '.e48@test.local' from generate_series(1, 3) n;
insert into public.profiles (id, role, first_name, phone) values
  ('e4800000-0000-4000-8000-000000000001', 'passenger', 'Aline', '+250788994801'),
  ('e4800000-0000-4000-8000-000000000002', 'rider', 'Olivier', '+250788994802'),
  ('e4800000-0000-4000-8000-000000000003', 'passenger', 'Eric', '+250788994803');
insert into public.riders (id, verification) values ('e4800000-0000-4000-8000-000000000002', 'verified');

insert into public.promo_codes (id, code, code_key, kind, amount_rwf, percent, max_discount_rwf, per_passenger_limit, total_limit) values
  ('e48c0000-0000-4000-8000-000000000001', 'NOVA50', 'NOVA50', 'amount', 500, null, null, 1, null),
  ('e48c0000-0000-4000-8000-000000000002', 'NV-PCT3', 'NVPCT3', 'percent', null, 30, 1000, 2, null),
  ('e48c0000-0000-4000-8000-000000000003', 'LAST1', 'LAST1', 'amount', 300, null, null, 1, 1),
  ('e48c0000-0000-4000-8000-000000000004', 'PAUSEME', 'PAUSEME', 'amount', 200, null, null, 1, null);
insert into public.passenger_promos (passenger_id, promo_id)
select 'e4800000-0000-4000-8000-000000000001', id from public.promo_codes where id::text like 'e48c%';
insert into public.passenger_promos (passenger_id, promo_id)
values ('e4800000-0000-4000-8000-000000000003', 'e48c0000-0000-4000-8000-000000000003');

-- Quotes 1-7, as the quote function would have written them.
insert into public.fare_quotes (id, passenger_id, policy_id, vehicle_class, distance_m, duration_s, amount_rwf, expires_at,
                                promo_id, promo_discount_rwf)
select ('e48a0000-0000-4000-8000-00000000000' || q.n)::uuid, q.passenger,
       (select id from public.fare_policies where vehicle_class = 'moto' and effective_to is null limit 1),
       'moto', 5000, 900, 1400, now() + interval '2 minutes', q.promo, q.discount
  from (values
    (1, 'e4800000-0000-4000-8000-000000000001'::uuid, 'e48c0000-0000-4000-8000-000000000001'::uuid, 500),
    (2, 'e4800000-0000-4000-8000-000000000001'::uuid, null, null),
    (3, 'e4800000-0000-4000-8000-000000000001'::uuid, 'e48c0000-0000-4000-8000-000000000004'::uuid, 200),
    (4, 'e4800000-0000-4000-8000-000000000001'::uuid, 'e48c0000-0000-4000-8000-000000000003'::uuid, 300),
    (5, 'e4800000-0000-4000-8000-000000000003'::uuid, 'e48c0000-0000-4000-8000-000000000003'::uuid, 300),
    (6, 'e4800000-0000-4000-8000-000000000001'::uuid, 'e48c0000-0000-4000-8000-000000000002'::uuid, 400),
    (7, 'e4800000-0000-4000-8000-000000000001'::uuid, null, null)
  ) q(n, passenger, promo, discount);

set local role authenticated;
set local request.jwt.claims to '{"sub":"e4800000-0000-4000-8000-000000000001","role":"authenticated"}';

select lives_ok($$ select public.create_trip_from_quote('e48a0000-0000-4000-8000-000000000001',
  st_point(30.06, -1.94)::geography, 'A', null, st_point(30.09, -1.95)::geography, 'B') $$,
  'a booking from a quote with a code goes through');
select lives_ok($$ select public.create_trip_from_quote('e48a0000-0000-4000-8000-000000000002',
  st_point(30.06, -1.94)::geography, 'A', null, st_point(30.09, -1.95)::geography, 'B') $$,
  'and so does one from a quote without');

reset role;
select is((select promo_discount_rwf from public.trips where quote_id = 'e48a0000-0000-4000-8000-000000000001'), 500,
  'the trip carries the quote''s code and its discount');
select is((select promo_id from public.trips where quote_id = 'e48a0000-0000-4000-8000-000000000002'), null,
  'a quote with promos turned off books without one, though the passenger owns codes that fit');

-- Whatever is written into the promo columns directly is replaced by what
-- the quote says.
insert into public.trips (passenger_id, vehicle_class, state, pickup, pickup_label, dropoff, dropoff_label,
                          quote_id, quoted_amount_rwf, promo_id, promo_discount_rwf)
values ('e4800000-0000-4000-8000-000000000001', 'moto', 'requested', st_point(30.06, -1.94)::geography, 'A',
        st_point(30.09, -1.95)::geography, 'B', 'e48a0000-0000-4000-8000-000000000007', 1400,
        'e48c0000-0000-4000-8000-000000000002', 1400);
select is((select promo_id from public.trips where quote_id = 'e48a0000-0000-4000-8000-000000000007'), null,
  'a code cannot be put on a trip except through its quote');

-- Paused between the quote and the booking.
update public.promo_codes set paused = true where code = 'PAUSEME';
set local role authenticated;
select throws_ok($$ select public.create_trip_from_quote('e48a0000-0000-4000-8000-000000000003',
  st_point(30.06, -1.94)::geography, 'A', null, st_point(30.09, -1.95)::geography, 'B') $$,
  '22023', 'promo_unavailable', 'a code paused after the quote refuses the booking, so nothing is booked');

-- LAST1 has one use in all. Aline takes it; Eric's quote for it was made
-- before she booked.
select lives_ok($$ select public.create_trip_from_quote('e48a0000-0000-4000-8000-000000000004',
  st_point(30.06, -1.94)::geography, 'A', null, st_point(30.09, -1.95)::geography, 'B') $$,
  'the last use of a code goes to the first booking');
set local request.jwt.claims to '{"sub":"e4800000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok($$ select public.create_trip_from_quote('e48a0000-0000-4000-8000-000000000005',
  st_point(30.06, -1.94)::geography, 'A', null, st_point(30.09, -1.95)::geography, 'B') $$,
  '22023', 'promo_unavailable', 'and not to a second one');

-- Aline cancels: the use comes back and Eric can book with it.
reset role;
select set_config('gera.in_transition', '1', true);
update public.trips set state = 'cancelled_by_passenger' where quote_id = 'e48a0000-0000-4000-8000-000000000004';
select set_config('gera.in_transition', '0', true);
select is(public.promo_uses('e48c0000-0000-4000-8000-000000000003'), 0, 'a cancelled ride gives its use back');
set local role authenticated;
select lives_ok($$ select public.create_trip_from_quote('e48a0000-0000-4000-8000-000000000005',
  st_point(30.06, -1.94)::geography, 'A', null, st_point(30.09, -1.95)::geography, 'B') $$,
  'so the next passenger can have it');
reset role;

-- A 30% code (cap 1,000) on a ride quoted at 1,400 that ran to 10 km, with
-- ten minutes of waiting at the pickup.
insert into public.trips (id, passenger_id, rider_id, vehicle_class, state, pickup, pickup_label, dropoff, dropoff_label,
                          quoted_distance_m, quoted_duration_s, quote_id, quoted_amount_rwf)
values ('e4810000-0000-4000-8000-000000000001', 'e4800000-0000-4000-8000-000000000001', 'e4800000-0000-4000-8000-000000000002',
        'moto', 'in_progress', st_point(30.06, -1.94)::geography, 'A', st_point(30.10, -1.95)::geography, 'B',
        5000, 900, 'e48a0000-0000-4000-8000-000000000006', 1400);
insert into public.trip_events (trip_id, from_state, to_state, actor, idempotency_key, created_at) values
  ('e4810000-0000-4000-8000-000000000001', 'accepted', 'arrived', 'rider', 'a-e48', now() - interval '600 seconds'),
  ('e4810000-0000-4000-8000-000000000001', 'arrived', 'in_progress', 'rider', 's-e48', now());
insert into public.trip_progress (trip_id, min_to_dropoff_m, travelled_m, last_position)
values ('e4810000-0000-4000-8000-000000000001', 0, 10000, st_point(30.10, -1.95)::geography);

select is((select promo_discount_rwf from public.trips where id = 'e4810000-0000-4000-8000-000000000001'), 400,
  'at booking the trip holds the estimate: 30% of 1,400');

set local role authenticated;
set local request.jwt.claims to '{"sub":"e4800000-0000-4000-8000-000000000002","role":"authenticated"}';
select public.complete_trip('e4810000-0000-4000-8000-000000000001', 10000, 'c-e48');
reset role;

create temp table done as
select (meta ->> 'fare_rwf')::int as fare, (meta ->> 'waiting_charge_rwf')::int as wait,
       (meta ->> 'total_rwf')::int as total, (meta ->> 'promo_discount_rwf')::int as discount,
       (meta ->> 'paid_rwf')::int as paid
  from public.trip_events where trip_id = 'e4810000-0000-4000-8000-000000000001' and to_state = 'completed';
grant select on done to authenticated;

select ok((select fare > 1400 and wait > 0 from done), 'the final fare grew past the quote and there was waiting');
select is((select discount from done), (select least(1000, (floor(fare * 0.3 / 100) * 100)::int) from done),
  'the percentage is worked out again on the final fare, not the waiting charge');
select is((select promo_discount_rwf from public.trips where id = 'e4810000-0000-4000-8000-000000000001'), (select discount from done),
  'and the trip records the final discount');
select is((select amount_rwf from public.ledger_entries
            where trip_id = 'e4810000-0000-4000-8000-000000000001' and kind = 'fare_collected'),
          (select total - discount from done),
  'the rider collects fare + waiting - discount');
select is((select amount_rwf from public.ledger_entries
            where trip_id = 'e4810000-0000-4000-8000-000000000001' and kind = 'trip_earning'),
          (select public.rider_earning_rwf(total, (select commission_pct from public.fare_policies
                                                   where vehicle_class = 'moto' and effective_to is null limit 1)) from done),
  'and earns on the full total: Nova covers the discount');

set local role authenticated;
set local request.jwt.claims to '{"sub":"e4800000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select paid_rwf from public.trip_total_rwf('e4810000-0000-4000-8000-000000000001')), (select paid from done),
  'the passenger''s receipt says what they paid');
select is((select promo_discount_rwf + paid_rwf from public.trip_total_rwf('e4810000-0000-4000-8000-000000000001')),
          (select total from done),
  'which is the total less the promo');
reset role;

select * from finish();
rollback;
