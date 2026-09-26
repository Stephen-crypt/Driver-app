-- Pricing and operating settings from the dashboard (NOVA §61, §86).
--
-- Until now changing a fare meant writing SQL. §61: "Pricing should not be
-- hard coded" - it was not in the app, but it was only reachable by someone
-- with the database password.
--
-- A price change is a NEW fare_policies row, never an edit. Every quote holds
-- the id of the policy that priced it and complete_trip settles against that
-- id, so a trip quoted before the change keeps the price its passenger agreed
-- to, and the history of what Gera charged, when, stays readable.

create or replace function public.staff_fare_policies()
returns table (
  id uuid, vehicle_class text, base_rwf integer, per_km_rwf integer,
  per_minute_rwf integer, minimum_rwf integer, commission_pct numeric,
  effective_from timestamptz, effective_to timestamptz, current boolean
) language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.require_staff(array['finance', 'operations']::public.staff_role[]);
  return query
    select f.id, f.vehicle_class::text, f.base_rwf, f.per_km_rwf, f.per_minute_rwf,
           f.minimum_rwf, f.commission_pct, f.effective_from, f.effective_to,
           f.id = (public.current_fare_policy(f.vehicle_class)).id
      from public.fare_policies f
     order by f.vehicle_class, f.effective_from desc
     limit 60;
end;
$$;

-- Admin and finance set prices. Operations can read them - they answer the
-- phone when a passenger asks why a ride cost what it did - but not change them.
create or replace function public.staff_set_fare_policy(
  p_class public.vehicle_class,
  p_base_rwf integer, p_per_km_rwf integer, p_per_minute_rwf integer,
  p_minimum_rwf integer, p_commission_pct numeric,
  p_effective_from timestamptz default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_from timestamptz := coalesce(p_effective_from, now());
  v_prev public.fare_policies;
  v_id uuid;
begin
  perform public.require_staff(array['finance']::public.staff_role[]);

  if least(p_base_rwf, p_per_km_rwf, p_per_minute_rwf, p_minimum_rwf) < 0 then
    raise exception 'negative_price' using errcode = '22023';
  end if;
  if p_commission_pct < 0 or p_commission_pct > 90 then
    raise exception 'commission_out_of_range' using errcode = '22023';
  end if;
  -- A change dated in the past would reprice trips already quoted under the
  -- old policy in every report that reads "the policy in force at the time".
  if v_from < now() - interval '1 minute' then
    raise exception 'cannot_backdate' using errcode = '22023';
  end if;

  select * into v_prev from public.current_fare_policy(p_class);

  insert into public.fare_policies
    (vehicle_class, base_rwf, per_km_rwf, per_minute_rwf, minimum_rwf, commission_pct, effective_from)
  values
    (p_class, p_base_rwf, p_per_km_rwf, p_per_minute_rwf, p_minimum_rwf, p_commission_pct, v_from)
  returning id into v_id;

  -- The policy it replaces ends where this one starts, so there is exactly one
  -- policy in force for any instant.
  if v_prev.id is not null then
    update public.fare_policies set effective_to = v_from
     where id = v_prev.id and (effective_to is null or effective_to > v_from);
  end if;

  perform public.audit_internal('pricing.change', 'fare_policy', v_id::text,
    jsonb_build_object(
      'class', p_class,
      'from', jsonb_build_object('base', v_prev.base_rwf, 'per_km', v_prev.per_km_rwf,
        'per_minute', v_prev.per_minute_rwf, 'minimum', v_prev.minimum_rwf, 'commission', v_prev.commission_pct),
      'to', jsonb_build_object('base', p_base_rwf, 'per_km', p_per_km_rwf,
        'per_minute', p_per_minute_rwf, 'minimum', p_minimum_rwf, 'commission', p_commission_pct),
      'effective_from', v_from));
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Operating settings. Named, bounded keys only - not an arbitrary JSON write.
-- ---------------------------------------------------------------------------
create or replace function public.staff_settings()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  s public.platform_settings;
begin
  perform public.require_staff(array['operations', 'finance', 'safety']::public.staff_role[]);
  select * into s from public.platform_settings;
  return jsonb_build_object(
    'max_cash_held_rwf', s.max_cash_held_rwf,
    'wait_grace_seconds', s.wait_grace_seconds,
    'wait_charge_per_minute_rwf', s.wait_charge_per_minute_rwf,
    'require_ride_pin', s.require_ride_pin,
    'max_pin_attempts', s.max_pin_attempts,
    'schedule_release_lead_seconds', s.schedule_release_lead_seconds,
    'schedule_min_lead_seconds', s.schedule_min_lead_seconds,
    'schedule_max_days_ahead', s.schedule_max_days_ahead,
    'recurring_max_days', s.recurring_max_days,
    'recurring_horizon_days', s.recurring_horizon_days,
    'updated_at', s.updated_at);
end;
$$;

-- Each key has its own guard and its own role. The ride PIN is a safety
-- control: only safety or an admin turns it off.
create or replace function public.staff_update_setting(p_key text, p_value text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_old text;
  n integer;
begin
  case p_key
    when 'require_ride_pin' then
      perform public.require_staff(array['safety']::public.staff_role[]);
    when 'max_cash_held_rwf', 'wait_charge_per_minute_rwf' then
      perform public.require_staff(array['finance']::public.staff_role[]);
    when 'wait_grace_seconds', 'max_pin_attempts', 'schedule_release_lead_seconds',
         'schedule_min_lead_seconds', 'schedule_max_days_ahead', 'recurring_max_days',
         'recurring_horizon_days' then
      perform public.require_staff(array['operations']::public.staff_role[]);
    else
      raise exception 'unknown_setting' using errcode = '22023';
  end case;

  execute format('select %I::text from public.platform_settings', p_key) into v_old;

  if p_key = 'require_ride_pin' then
    if p_value not in ('true', 'false') then
      raise exception 'bad_value' using errcode = '22023';
    end if;
    update public.platform_settings set require_ride_pin = p_value::boolean, updated_at = now() where true;
  else
    begin
      n := p_value::integer;
    exception when others then
      raise exception 'bad_value' using errcode = '22023';
    end;
    -- The table's own CHECK constraints are the last word on bounds; these
    -- catch the values that pass a CHECK but make no sense to run with.
    if (p_key = 'max_cash_held_rwf' and n not between 5000 and 1000000)
       or (p_key = 'wait_grace_seconds' and n not between 60 and 1800)
       or (p_key = 'wait_charge_per_minute_rwf' and n not between 0 and 1000)
       or (p_key = 'max_pin_attempts' and n not between 3 and 10) then
      raise exception 'out_of_range' using errcode = '22023';
    end if;
    execute format('update public.platform_settings set %I = $1, updated_at = now() where true', p_key) using n;
  end if;

  perform public.audit_internal('settings.change', 'setting', p_key,
    jsonb_build_object('from', v_old, 'to', p_value));
end;
$$;

revoke execute on function
  public.staff_fare_policies(),
  public.staff_set_fare_policy(public.vehicle_class, integer, integer, integer, integer, numeric, timestamptz),
  public.staff_settings(),
  public.staff_update_setting(text, text)
from public, anon, authenticated;

grant execute on function
  public.staff_fare_policies(),
  public.staff_set_fare_policy(public.vehicle_class, integer, integer, integer, integer, numeric, timestamptz),
  public.staff_settings(),
  public.staff_update_setting(text, text)
to authenticated;
