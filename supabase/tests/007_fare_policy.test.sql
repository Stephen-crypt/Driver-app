begin;
select plan(5);

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

select * from finish();
rollback;
