-- Placeholder rates. Spec open item 3 calls for market calibration before
-- launch; these are effective-dated so a later change never rewrites history.
insert into public.fare_policies
  (vehicle_class, base_rwf, per_km_rwf, per_minute_rwf, minimum_rwf, commission_pct)
values
  ('moto',   400,  250, 20, 700,  15.00),
  ('cab',    1000, 600, 50, 2000, 15.00),
  ('cab_xl', 1500, 800, 60, 3000, 15.00);

-- The policy in force for a class right now. Effective-dated, so a future
-- price change is inserted rather than updated and history stays intact.
create or replace function public.current_fare_policy(p_class vehicle_class)
returns public.fare_policies
language sql
stable
as $$
  select *
    from public.fare_policies
   where vehicle_class = p_class
     and effective_from <= now()
     and (effective_to is null or effective_to > now())
   order by effective_from desc
   limit 1;
$$;

revoke all on function public.current_fare_policy(vehicle_class) from public, anon;
grant execute on function public.current_fare_policy(vehicle_class) to authenticated, service_role;
