-- Zones and route deviation (NOVA §45, §46).
--
-- Zones are drawn by staff on the dashboard map. A zone raises an alert when
-- a rider on shift crosses its edge in the direction that matters for its
-- kind: into a restricted area, out of the service area. Crossings are read
-- from rider_presence, which the rider app updates while online, so a rider
-- is watched between trips as well as during them.
--
-- There is no routed line to compare a trip against (routing needs a paid
-- API), so deviation is read from two things that do not need one:
--   * moving away - the rider is now much further from the drop-off than the
--     closest they have been during the trip;
--   * detour - they have travelled far more than the quoted distance.
-- Both have a generous margin, because §45 is explicit that small normal
-- deviations must not become disciplinary matters. Like every alert here, it
-- is a record for a person to look at, not a verdict.

do $$ begin
  create type public.zone_kind as enum ('service', 'operating', 'restricted', 'parking', 'pickup');
exception when duplicate_object then null; end $$;

create table if not exists public.zones (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (length(btrim(name)) between 2 and 60),
  kind            public.zone_kind not null,
  area            geography(Polygon, 4326) not null,
  alert_on_enter  boolean not null default false,
  alert_on_exit   boolean not null default false,
  active          boolean not null default true,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists zones_area_idx on public.zones using gist (area) where active;

alter table public.zones enable row level security;
revoke all on public.zones from public, anon, authenticated;
grant select on public.zones to authenticated;
drop policy if exists zones_staff on public.zones;
create policy zones_staff on public.zones
  for select using (public.is_staff(array['control_room', 'safety', 'operations', 'fleet']::public.staff_role[]));

create table if not exists public.geo_alerts (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('zone_enter', 'zone_exit', 'moving_away', 'detour')),
  rider_id    uuid not null references public.riders(id),
  trip_id     uuid references public.trips(id),
  zone_id     uuid references public.zones(id),
  position    geography(Point, 4326) not null,
  detail      text not null,
  created_at  timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  review_note text
);
create index if not exists geo_alerts_open_idx on public.geo_alerts (created_at desc) where reviewed_at is null;
create index if not exists geo_alerts_rider_idx on public.geo_alerts (rider_id, kind, zone_id, created_at desc);

alter table public.geo_alerts enable row level security;
revoke all on public.geo_alerts from public, anon, authenticated;
grant select on public.geo_alerts to authenticated;
drop policy if exists geo_alerts_staff on public.geo_alerts;
create policy geo_alerts_staff on public.geo_alerts
  for select using (public.is_staff(array['control_room', 'safety', 'operations', 'fleet']::public.staff_role[]));

-- Per-trip progress towards the drop-off, kept as points arrive.
create table if not exists public.trip_progress (
  trip_id          uuid primary key references public.trips(id) on delete cascade,
  min_to_dropoff_m double precision not null,
  travelled_m      double precision not null default 0,
  last_position    geography(Point, 4326) not null,
  updated_at       timestamptz not null default now()
);
alter table public.trip_progress enable row level security;
revoke all on public.trip_progress from public, anon, authenticated;

alter table public.platform_settings
  add column if not exists route_deviation_m integer not null default 1500
    check (route_deviation_m between 300 and 20000);

-- ---------------------------------------------------------------------------
-- Zone crossings
-- ---------------------------------------------------------------------------
create or replace function public.presence_zone_crossings()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  z record;
begin
  if new.position is null or old.position is null or new.status = 'offline'
     or st_equals(new.position::geometry, old.position::geometry) then
    return new;
  end if;
  -- A rough fix near an edge would flap in and out.
  if new.accuracy_m is not null and new.accuracy_m > 50 then
    return new;
  end if;

  for z in
    select zn.id, zn.name, zn.kind, zn.alert_on_enter, zn.alert_on_exit,
           st_covers(zn.area, new.position) as now_in,
           st_covers(zn.area, old.position) as was_in
      from public.zones zn
     where zn.active and (zn.alert_on_enter or zn.alert_on_exit)
       and (st_dwithin(zn.area, new.position, 0) or st_dwithin(zn.area, old.position, 0))
  loop
    continue when z.now_in = z.was_in;
    continue when z.now_in and not z.alert_on_enter;
    continue when not z.now_in and not z.alert_on_exit;
    -- Riding along an edge crosses it again and again; one alert per rider,
    -- zone and direction every ten minutes is plenty to act on.
    continue when exists (
      select 1 from public.geo_alerts g
       where g.rider_id = new.rider_id and g.zone_id = z.id
         and g.kind = case when z.now_in then 'zone_enter' else 'zone_exit' end
         and g.created_at > now() - interval '10 minutes');

    insert into public.geo_alerts (kind, rider_id, trip_id, zone_id, position, detail)
    values (case when z.now_in then 'zone_enter' else 'zone_exit' end,
            new.rider_id,
            (select t.id from public.trips t
              where t.rider_id = new.rider_id and t.state in ('accepted', 'arrived', 'in_progress')
              order by t.updated_at desc limit 1),
            z.id, new.position,
            case when z.now_in then 'Entered ' else 'Left ' end || z.name
              || ' (' || replace(z.kind::text, '_', ' ') || ' zone)');
  end loop;
  return new;
end;
$$;

drop trigger if exists rider_presence_zones on public.rider_presence;
create trigger rider_presence_zones after update of position on public.rider_presence
  for each row execute function public.presence_zone_crossings();

-- ---------------------------------------------------------------------------
-- Route deviation, alongside speed, as trip points arrive.
-- ---------------------------------------------------------------------------
create or replace function public.track_trip_progress(p_trip public.trips, p_here geography)
returns void language plpgsql security definer set search_path = public as $$
declare
  p          public.trip_progress;
  v_to_drop  double precision := st_distance(p_here, p_trip.dropoff);
  v_margin   integer;
  v_kind     text;
  v_detail   text;
begin
  select * into p from public.trip_progress where trip_id = p_trip.id for update;
  if not found then
    insert into public.trip_progress (trip_id, min_to_dropoff_m, last_position)
    values (p_trip.id, v_to_drop, p_here);
    return;
  end if;

  update public.trip_progress
     set travelled_m = travelled_m + st_distance(last_position, p_here),
         min_to_dropoff_m = least(min_to_dropoff_m, v_to_drop),
         last_position = p_here,
         updated_at = now()
   where trip_id = p_trip.id
  returning * into p;

  select route_deviation_m into v_margin from public.platform_settings;

  if v_to_drop > p.min_to_dropoff_m + v_margin then
    v_kind := 'moving_away';
    v_detail := 'Now ' || round((v_to_drop / 1000.0)::numeric, 1) || ' km from the drop-off, after getting within '
             || round((p.min_to_dropoff_m / 1000.0)::numeric, 1) || ' km';
  elsif p_trip.quoted_distance_m is not null
        and p.travelled_m > p_trip.quoted_distance_m * 1.5 + v_margin then
    v_kind := 'detour';
    v_detail := round((p.travelled_m / 1000.0)::numeric, 1) || ' km travelled for a '
             || round((p_trip.quoted_distance_m / 1000.0)::numeric, 1) || ' km trip';
  else
    return;
  end if;

  if exists (select 1 from public.geo_alerts
              where trip_id = p_trip.id and kind = v_kind and created_at > now() - interval '10 minutes') then
    return;
  end if;
  insert into public.geo_alerts (kind, rider_id, trip_id, position, detail)
  values (v_kind, p_trip.rider_id, p_trip.id, p_here, v_detail);
end;
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

  -- Speed and route, only from fixes the phone trusts to within 40 metres.
  if p_accuracy_m is null or p_accuracy_m > 40 then
    return;
  end if;

  if v_trip.state = 'in_progress' then
    perform public.track_trip_progress(v_trip, v_here);
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

-- ---------------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------------
create or replace function public.staff_zones()
returns table (
  id uuid, name text, kind text, area jsonb, alert_on_enter boolean, alert_on_exit boolean,
  active boolean, area_km2 numeric, updated_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.require_staff(array['control_room', 'operations', 'safety', 'fleet']::public.staff_role[]);
  return query
    select z.id, z.name, z.kind::text, st_asgeojson(z.area)::jsonb, z.alert_on_enter, z.alert_on_exit,
           z.active, round((st_area(z.area) / 1e6)::numeric, 2), z.updated_at
      from public.zones z
     order by z.active desc, z.kind, z.name;
end;
$$;

-- p_points is [[lng, lat], ...] as drawn; the ring is closed here.
create or replace function public.staff_save_zone(
  p_id uuid, p_name text, p_kind public.zone_kind, p_points jsonb,
  p_alert_on_enter boolean, p_alert_on_exit boolean, p_active boolean default true
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_geom geometry;
  v_id   uuid;
begin
  perform public.require_staff(array['operations', 'safety']::public.staff_role[]);
  if length(btrim(coalesce(p_name, ''))) < 2 then
    raise exception 'name_required' using errcode = '22023';
  end if;

  if p_points is not null then
    if jsonb_typeof(p_points) <> 'array' or jsonb_array_length(p_points) < 3 or jsonb_array_length(p_points) > 200 then
      raise exception 'zone_needs_points' using errcode = '22023';
    end if;
    select st_makepolygon(st_addpoint(line, st_startpoint(line)))
      into v_geom
      from (select st_makeline(array_agg(st_setsrid(st_point((pt ->> 0)::float8, (pt ->> 1)::float8), 4326) order by ord)) as line
              from jsonb_array_elements(p_points) with ordinality as e(pt, ord)) l;
    if not (st_isvaliddetail(v_geom)).valid then
      raise exception 'zone_crosses_itself' using errcode = '22023';
    end if;
    -- Rwanda is about 26,000 km2; a zone bigger than Kigali is a mis-click.
    if st_area(v_geom::geography) > 1000e6 then
      raise exception 'zone_too_large' using errcode = '22023';
    end if;
  elsif p_id is null then
    raise exception 'zone_needs_points' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.zones (name, kind, area, alert_on_enter, alert_on_exit, active, created_by)
    values (btrim(p_name), p_kind, v_geom::geography, p_alert_on_enter, p_alert_on_exit, coalesce(p_active, true), auth.uid())
    returning id into v_id;
  else
    update public.zones
       set name = btrim(p_name), kind = p_kind, area = coalesce(v_geom::geography, area),
           alert_on_enter = p_alert_on_enter, alert_on_exit = p_alert_on_exit,
           active = coalesce(p_active, active), updated_at = now()
     where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'zone_not_found' using errcode = 'P0002';
    end if;
  end if;

  perform public.audit_internal(case when p_id is null then 'zone.create' else 'zone.update' end, 'zone', v_id::text,
    jsonb_build_object('name', btrim(p_name), 'kind', p_kind, 'enter', p_alert_on_enter, 'exit', p_alert_on_exit,
                       'active', p_active, 'reshaped', p_points is not null));
  return v_id;
end;
$$;

create or replace function public.staff_review_geo_alert(p_alert_id uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_staff(array['control_room', 'safety', 'operations', 'fleet']::public.staff_role[]);
  update public.geo_alerts
     set reviewed_at = now(), reviewed_by = auth.uid(), review_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_alert_id and reviewed_at is null;
  if not found then
    raise exception 'alert_not_found_or_reviewed' using errcode = 'P0002';
  end if;
  perform public.audit_internal('geo.review', 'geo_alert', p_alert_id::text, jsonb_build_object('note', p_note));
end;
$$;

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
      select 'geo:' || g.kind, g.created_at,
             case g.kind
               when 'zone_enter' then 'Zone entered'
               when 'zone_exit' then 'Zone left'
               when 'moving_away' then 'Moving away from drop-off'
               else 'Long detour' end || ' - ' || p.first_name,
             g.detail, g.trip_id, g.id
        from public.geo_alerts g
        join public.profiles p on p.id = g.rider_id
       where g.reviewed_at is null and g.created_at > now() - make_interval(hours => p_hours)
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

-- The deviation margin joins the operating settings.
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
    'route_deviation_m', s.route_deviation_m,
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
    when 'require_ride_pin', 'speed_alert_kmh', 'route_deviation_m' then
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
       or (p_key = 'speed_alert_kmh' and n not between 20 and 150)
       or (p_key = 'route_deviation_m' and n not between 300 and 20000) then
      raise exception 'out_of_range' using errcode = '22023';
    end if;
    execute format('update public.platform_settings set %I = $1, updated_at = now() where true', p_key) using n;
  end if;

  perform public.audit_internal('settings.change', 'setting', p_key,
    jsonb_build_object('from', v_old, 'to', p_value));
end;
$$;

revoke execute on function
  public.presence_zone_crossings(),
  public.track_trip_progress(public.trips, geography),
  public.publish_track_point(uuid, double precision, double precision, real),
  public.staff_zones(),
  public.staff_save_zone(uuid, text, public.zone_kind, jsonb, boolean, boolean, boolean),
  public.staff_review_geo_alert(uuid, text),
  public.staff_recent_events(integer),
  public.staff_settings(),
  public.staff_update_setting(text, text)
from public, anon, authenticated;

grant execute on function
  public.publish_track_point(uuid, double precision, double precision, real),
  public.staff_zones(),
  public.staff_save_zone(uuid, text, public.zone_kind, jsonb, boolean, boolean, boolean),
  public.staff_review_geo_alert(uuid, text),
  public.staff_recent_events(integer),
  public.staff_settings(),
  public.staff_update_setting(text, text)
to authenticated;
