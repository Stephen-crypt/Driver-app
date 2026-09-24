begin;
select plan(6);

select is(
  (select count(*)::int from public.fare_policies),
  3,
  'one seeded policy per vehicle class'
);

select is(
  (select base_rwf from public.current_fare_policy('moto')),
  400,
  'moto policy is returned with its base fare'
);

select is(
  (select commission_pct from public.current_fare_policy('moto')),
  15.00::numeric(5,2),
  'the commission rate is carried on the policy'
);

-- A superseding policy must win without the old row being touched.
insert into public.fare_policies
  (vehicle_class, base_rwf, per_km_rwf, per_minute_rwf, minimum_rwf, commission_pct, effective_from)
values ('moto', 500, 275, 22, 800, 18.00, now());

select is(
  (select base_rwf from public.current_fare_policy('moto')),
  500,
  'the most recently effective policy wins'
);

select is(
  (select count(*)::int from public.fare_policies where vehicle_class = 'moto'),
  2,
  'superseding a price inserts, never updates - history is intact'
);

-- Two policies for one class sharing an effective_from had an undefined winner,
-- so an ops edit made in the same clock tick as another could quote either rate.
-- created_at breaks the tie: the row written later is the one ops meant. Both
-- timestamps are explicit here because now() is frozen inside a transaction, so
-- defaults would tie on created_at too and prove nothing.
insert into public.fare_policies
  (vehicle_class, base_rwf, per_km_rwf, per_minute_rwf, minimum_rwf,
   commission_pct, effective_from, created_at)
values
  ('cab', 1100, 610, 51, 2100, 16.00, now(), now() - interval '10 minutes'),
  ('cab', 1200, 620, 52, 2200, 17.00, now(), now() - interval '1 minute');

select is(
  (select base_rwf from public.current_fare_policy('cab')),
  1200,
  'policies tied on effective_from are broken by created_at, not left undefined'
);

select * from finish();
rollback;
