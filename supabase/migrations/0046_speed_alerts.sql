-- Speed monitoring (NOVA §44).
--
-- The rider app already publishes a position every five seconds during a trip
-- (0031). Speed is worked out here, as each point arrives, from that point and
-- the latest one at least ten seconds older - not the one immediately before,
-- because two GPS fixes five seconds apart can disagree by thirty metres
-- standing still, which reads as 20 km/h of phantom speed. Fixes the phone
-- itself calls inaccurate are not used at all.
--
-- An alert is a record for a person to review (§44: "reviewed according to
-- company policy"). Nothing here suspends, fines or messages a rider.

alter table public.platform_settings
  add column if not exists speed_alert_kmh integer not null default 60
    check (speed_alert_kmh between 20 and 150);

create table if not exists public.speed_alerts (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips(id),
  rider_id    uuid not null references public.riders(id),
  vehicle_id  uuid references public.vehicles(id),
  position    geography(Point, 4326) not null,
  speed_kmh   integer not null,
  limit_kmh   integer not null,
  created_at  timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  review_note text
);

create index if not exists speed_alerts_trip_idx on public.speed_alerts (trip_id, created_at desc);
create index if not exists speed_alerts_open_idx on public.speed_alerts (created_at desc) where reviewed_at is null;

alter table public.speed_alerts enable row level security;
revoke all on public.speed_alerts from public, anon, authenticated;
grant select on public.speed_alerts to authenticated;
drop policy if exists speed_alerts_staff on public.speed_alerts;
create policy speed_alerts_staff on public.speed_alerts
  for select using (public.is_staff(array['control_room', 'safety', 'operations', 'fleet']::public.staff_role[]));

-- Pure: kept separate so it can be tested without a trip.
create or replace function public.speed_kmh(p_metres double precision, p_seconds double precision)
returns integer language sql immutable as $$
  select case when p_seconds <= 0 then null else round(p_metres / p_seconds * 3.6)::integer end;
$$;

create or replace function public.publish_track_point(
  p_trip_id uuid, p_lng double precision, p_lat double precision, p_accuracy_m real default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_trip  public.trips;
  v_here  geography := st_setsrid(st_point(p_lng, p_lat), 4326)::geography;
  v_prev  record;
  v_speed integer;
  v_limit integer;
begin
  select * into v_trip from public.trips where id = p_trip_id;

  -- Authorise before anything else, and answer the same way for "no such trip"
  -- and "not your trip".
  if not found or v_trip.rider_id is distinct from auth.uid() then
    raise exception 'trip_not_found' using errcode = 'P0002';
  end if;

  -- A finished trip is not a tracking channel.
  if v_trip.state not in ('accepted', 'arrived', 'in_progress') then
    return;
  end if;

  insert into public.trip_track_points (trip_id, position, accuracy_m, recorded_at)
  values (p_trip_id, v_here, p_accuracy_m, now());

  -- Speed, only from fixes the phone trusts to within 40 metres.
  if p_accuracy_m is null or p_accuracy_m > 40 then
    return;
  end if;

  select tp.position, tp.recorded_at into v_prev
    from public.trip_track_points tp
   where tp.trip_id = p_trip_id
     and tp.recorded_at <= now() - interval '10 seconds'
     and tp.recorded_at >= now() - interval '60 seconds'
     and tp.accuracy_m is not null and tp.accuracy_m <= 40
   order by tp.recorded_at desc
   limit 1;
  if not found then
    return;
  end if;

  v_speed := public.speed_kmh(st_distance(v_prev.position, v_here),
                              extract(epoch from now() - v_prev.recorded_at));
  select speed_alert_kmh into v_limit from public.platform_settings;

  if v_speed > v_limit and not exists (
    select 1 from public.speed_alerts
     where trip_id = p_trip_id and created_at > now() - interval '5 minutes'
  ) then
    insert into public.speed_alerts (trip_id, rider_id, vehicle_id, position, speed_kmh, limit_kmh)
    values (p_trip_id, v_trip.rider_id,
            (select id from public.vehicles where rider_id = v_trip.rider_id and is_active limit 1),
            v_here, v_speed, v_limit);
  end if;
end;
$$;

create or replace function public.staff_review_speed_alert(p_alert_id uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_staff(array['control_room', 'safety', 'operations', 'fleet']::public.staff_role[]);
  update public.speed_alerts
     set reviewed_at = now(), reviewed_by = auth.uid(), review_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_alert_id and reviewed_at is null;
  if not found then
    raise exception 'alert_not_found_or_reviewed' using errcode = 'P0002';
  end if;
  perform public.audit_internal('speed.review', 'speed_alert', p_alert_id::text,
    jsonb_build_object('note', p_note));
end;
$$;

-- The control room's "last 12 hours" rail now carries speed alerts and open
-- cases alongside failed dispatches and no-shows.
create or replace function public.staff_recent_events(p_hours integer default 12)
returns table (kind text, at timestamptz, title text, detail text, trip_id uuid, ref_id uuid)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.require_staff(array['control_room', 'operations', 'safety', 'fleet']::public.staff_role[]);
  return query
    select * from (
      select 'speed'::text, s.created_at,
             'Speeding - ' || p.first_name || ' at ' || s.speed_kmh || ' km/h',
             'Limit ' || s.limit_kmh || ' km/h' || coalesce(' · ' || v.plate, ''), s.trip_id, s.id
        from public.speed_alerts s
        join public.profiles p on p.id = s.rider_id
        left join public.vehicles v on v.id = s.vehicle_id
       where s.reviewed_at is null and s.created_at > now() - make_interval(hours => p_hours)
      union all
      select 'no_riders', t.updated_at, 'No rider found',
             t.pickup_label || ' to ' || t.dropoff_label, t.id, t.id
        from public.trips t
       where t.state = 'no_riders' and t.updated_at > now() - make_interval(hours => p_hours)
      union all
      select 'no_show', n.reported_at, 'Passenger no-show',
             coalesce(n.reason, '') || ' (waited ' || (n.waited_seconds / 60) || ' min)', n.trip_id, n.id
        from public.no_show_reports n
       where n.reported_at > now() - make_interval(hours => p_hours)
      union all
      select 'case:' || c.kind::text, c.created_at,
             '#' || c.number || ' ' || initcap(replace(coalesce(c.category, c.kind::text), '_', ' ')),
             left(c.description, 120), c.trip_id, c.id
        from public.support_cases c
       where c.status = 'open'
    ) x
    order by 2 desc
    limit 100;
end;
$$;

revoke execute on function
  public.speed_kmh(double precision, double precision),
  public.publish_track_point(uuid, double precision, double precision, real),
  public.staff_review_speed_alert(uuid, text),
  public.staff_recent_events(integer)
from public, anon, authenticated;

grant execute on function
  public.publish_track_point(uuid, double precision, double precision, real),
  public.staff_review_speed_alert(uuid, text),
  public.staff_recent_events(integer)
to authenticated;

-- The speed limit joins the other operating settings.
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
    'speed_alert_kmh', s.speed_alert_kmh,
    'schedule_release_lead_seconds', s.schedule_release_lead_seconds,
    'schedule_min_lead_seconds', s.schedule_min_lead_seconds,
    'schedule_max_days_ahead', s.schedule_max_days_ahead,
    'recurring_max_days', s.recurring_max_days,
    'recurring_horizon_days', s.recurring_horizon_days,
    'updated_at', s.updated_at);
end;
$$;

create or replace function public.staff_update_setting(p_key text, p_value text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_old text;
  n integer;
begin
  case p_key
    when 'require_ride_pin', 'speed_alert_kmh' then
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
    if (p_key = 'max_cash_held_rwf' and n not between 5000 and 1000000)
       or (p_key = 'wait_grace_seconds' and n not between 60 and 1800)
       or (p_key = 'wait_charge_per_minute_rwf' and n not between 0 and 1000)
       or (p_key = 'max_pin_attempts' and n not between 3 and 10)
       or (p_key = 'speed_alert_kmh' and n not between 20 and 150) then
      raise exception 'out_of_range' using errcode = '22023';
    end if;
    execute format('update public.platform_settings set %I = $1, updated_at = now() where true', p_key) using n;
  end if;

  perform public.audit_internal('settings.change', 'setting', p_key,
    jsonb_build_object('from', v_old, 'to', p_value));
end;
$$;
