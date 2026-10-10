-- Finding a rider takes longer: riders get 30 seconds to accept an offer
-- (was 15), and a passenger's search runs for 3 minutes (was three riders,
-- about a minute, and it ended at once when nobody free was within 4 km).
-- Both are settings operations can change in the dashboard.

alter table public.platform_settings
  add column if not exists offer_seconds integer not null default 30 check (offer_seconds between 10 and 120),
  add column if not exists search_seconds integer not null default 180 check (search_seconds between 60 and 900);

-- How long a rider has to accept, from the setting. Stable, not immutable:
-- it can change between statements.
create or replace function public.offer_ttl_seconds()
returns integer language sql stable security definer set search_path = public as $$
  select offer_seconds from public.platform_settings;
$$;

create or replace function public.offer_next_candidate(p_trip_id uuid)
 RETURNS trip_offers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- The search runs for platform_settings.search_seconds, asking the nearest
  -- free rider not yet asked, one at a time; planned riders are asked first.
  v_radius_m      constant integer := 4000;
  -- Far enough to reach a primary rider who is across town when their
  -- regular passenger's ride is released.
  v_planned_radius_m constant integer := 15000;
  v_scan_limit    constant integer := 10;
  v_trip      public.trips;
  v_rider_id  uuid;
  v_attempt   integer;
  v_started   timestamptz;
  v_window    integer;
begin
  select * into v_trip from public.trips where id = p_trip_id for update;
  if not found then
    raise exception 'trip_not_found' using errcode = 'P0002';
  end if;
  if v_trip.state not in ('requested', 'offered') then
    return null;
  end if;
  if exists (select 1 from public.trip_offers where trip_id = p_trip_id and outcome is null) then
    return null;
  end if;

  -- The clock starts when the ride started looking for a rider: when it was
  -- booked, or for a ride booked ahead, when its search was released. An
  -- offer that runs out also puts a trip back to requested, so only the
  -- release from scheduled counts.
  select coalesce(
           (select max(e.created_at) from public.trip_events e
             where e.trip_id = p_trip_id and e.from_state = 'scheduled' and e.to_state = 'requested'),
           v_trip.created_at)
    into v_started;
  select search_seconds into v_window from public.platform_settings;
  v_attempt := greatest(
    v_trip.dispatch_attempts,
    (select count(*) from public.trip_offers where trip_id = p_trip_id)::integer) + 1;

  if now() > v_started + make_interval(secs => v_window) then
    perform public.trip_transition_system(
      p_trip_id, 'no_riders',
      'dispatch-search-time-' || p_trip_id::text,
      jsonb_build_object('reason', 'search_time', 'attempts', v_attempt - 1, 'seconds', v_window));
    return null;
  end if;

  if v_trip.rider_id is not null then
    perform set_config('gera.in_transition', '1', true);
    update public.trips set rider_id = null where id = p_trip_id;
    perform set_config('gera.in_transition', '0', true);
  end if;

  -- 1. A planned rider who is online, free and not yet asked.
  select c.rider_id into v_rider_id
    from public.find_candidate_riders(v_trip.pickup, v_trip.vehicle_class, v_planned_radius_m, 200) c
    join public.preferred_riders_for(v_trip) pr on pr.rider_id = c.rider_id
   where not exists (select 1 from public.trip_offers o where o.trip_id = p_trip_id and o.rider_id = c.rider_id)
     and not exists (select 1 from public.trip_offers o2 where o2.rider_id = c.rider_id and o2.outcome is null)
     and c.rider_id <> v_trip.passenger_id
   order by pr.pref, c.distance_m
   limit 1;

  -- 2. Otherwise the nearest, as for any ride.
  if v_rider_id is null then
    select c.rider_id into v_rider_id
      from public.find_candidate_riders(v_trip.pickup, v_trip.vehicle_class, v_radius_m, v_scan_limit) c
     where not exists (select 1 from public.trip_offers o where o.trip_id = p_trip_id and o.rider_id = c.rider_id)
       and not exists (select 1 from public.trip_offers o2 where o2.rider_id = c.rider_id and o2.outcome is null)
     and c.rider_id <> v_trip.passenger_id
     order by c.distance_m
     limit 1;
  end if;

  -- Nobody free nearby right now: keep the trip searching. The next tick, five
  -- seconds on, looks again - a rider who comes online or finishes a trip can
  -- still take it - until the search time is up.
  if v_rider_id is null then
    return null;
  end if;

  update public.trips set dispatch_attempts = v_attempt where id = p_trip_id;
  return public.create_trip_offer(
    p_trip_id, v_rider_id, v_attempt, null,
    public.offer_ttl_seconds(),
    'reoffer-' || p_trip_id::text || '-' || v_attempt::text);
end;
$function$
;

create or replace function public.staff_update_setting(p_key text, p_value text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_old text;
  n integer;
begin
  case p_key
    when 'require_ride_pin', 'speed_alert_kmh', 'route_deviation_m' then
      perform public.require_staff(array['safety']::public.staff_role[]);
    when 'max_cash_held_rwf', 'wait_charge_per_minute_rwf' then
      perform public.require_staff(array['finance']::public.staff_role[]);
    when 'wait_grace_seconds', 'max_pin_attempts', 'schedule_release_lead_seconds',
         'schedule_min_lead_seconds', 'schedule_max_days_ahead', 'recurring_max_days',
         'recurring_horizon_days', 'offer_seconds', 'search_seconds' then
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
    if (p_key = 'max_cash_held_rwf' and n not between 5000 and 1000000)
       or (p_key = 'wait_grace_seconds' and n not between 60 and 1800)
       or (p_key = 'wait_charge_per_minute_rwf' and n not between 0 and 1000)
       or (p_key = 'max_pin_attempts' and n not between 3 and 10)
       or (p_key = 'speed_alert_kmh' and n not between 20 and 150)
       or (p_key = 'route_deviation_m' and n not between 300 and 20000)
       or (p_key = 'offer_seconds' and n not between 10 and 120)
       or (p_key = 'search_seconds' and n not between 60 and 900) then
      raise exception 'out_of_range' using errcode = '22023';
    end if;
    execute format('update public.platform_settings set %I = $1, updated_at = now() where true', p_key) using n;
  end if;

  perform public.audit_internal('settings.change', 'setting', p_key,
    jsonb_build_object('from', v_old, 'to', p_value));
end;
$function$
;

create or replace function public.staff_settings()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    'speed_alert_kmh', s.speed_alert_kmh,
    'route_deviation_m', s.route_deviation_m,
    'schedule_release_lead_seconds', s.schedule_release_lead_seconds,
    'schedule_min_lead_seconds', s.schedule_min_lead_seconds,
    'schedule_max_days_ahead', s.schedule_max_days_ahead,
    'recurring_max_days', s.recurring_max_days,
    'recurring_horizon_days', s.recurring_horizon_days,
    'offer_seconds', s.offer_seconds,
    'search_seconds', s.search_seconds,
    'updated_at', s.updated_at);
end;
$function$
;

create or replace function public.dispatch_pending_trips()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- A tick's work is bounded so a backlog cannot make one run unbounded; the
  -- next tick five seconds later takes the rest.
  v_batch constant integer := 50;
  v_trip  record;
  v_count integer := 0;
begin
  for v_trip in
    select t.id
      from public.trips t
     -- An offered trip whose offer ran out with nobody left to ask stays
     -- offered between offers; the tick carries its search on too.
     where t.state in ('requested', 'offered')
       and not exists (
         select 1 from public.trip_offers o
          where o.trip_id = t.id and o.outcome is null
       )
     order by t.created_at
     limit v_batch
  loop
    begin
      perform public.offer_next_candidate(v_trip.id);
      v_count := v_count + 1;
    exception when others then
      -- One undispatchable trip must not abort the rest of the tick. Without
      -- this, a single bad row blocks every waiting passenger behind it.
      raise warning 'dispatch_pending_trips: trip % failed: %', v_trip.id, sqlerrm;
    end;
  end loop;

  return v_count;
end;
$function$
;
