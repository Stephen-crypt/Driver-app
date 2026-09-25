-- Live tracking, ETA, and SOS.
--
-- trip_track_points has existed since Phase 1 with policies on it and has never
-- been written or read. The consequence is the single biggest hole in the
-- product: a rider watching "Driver on the way" has no idea where the driver
-- is, how far off they are, or whether they are moving at all. Every ride app
-- shows this because without it the wait is indistinguishable from a failure.

/**
 * The driver publishes where they are. Only their own live trip, only them.
 *
 * Accuracy is stored rather than filtered here: a 300m fix from a cold GPS is
 * still worth showing as "roughly here", and the app can decide how to draw it.
 */
create or replace function public.publish_track_point(
  p_trip_id    uuid,
  p_lng        double precision,
  p_lat        double precision,
  p_accuracy_m real default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip public.trips;
begin
  select * into v_trip from public.trips where id = p_trip_id;

  -- Authorise before anything else, and answer the same way for "no such trip"
  -- and "not your trip".
  if not found or v_trip.driver_id is distinct from auth.uid() then
    raise exception 'trip_not_found' using errcode = 'P0002';
  end if;

  -- A finished trip is not a tracking channel. Without this a driver could
  -- keep publishing their position long after dropping the rider off, and the
  -- rider could keep reading it.
  if v_trip.state not in ('accepted', 'arrived', 'in_progress') then
    return;
  end if;

  insert into public.trip_track_points (trip_id, position, accuracy_m, recorded_at)
  values (
    p_trip_id,
    st_setsrid(st_point(p_lng, p_lat), 4326)::geography,
    p_accuracy_m,
    now()
  );
end;
$$;

revoke all on function public.publish_track_point(uuid, double precision, double precision, real)
  from public, anon;
grant execute on function public.publish_track_point(uuid, double precision, double precision, real)
  to authenticated, service_role;

/**
 * Where the driver is now, and roughly how long until they reach the rider.
 *
 * The ETA is straight-line distance over an average Kigali speed, and it is
 * deliberately coarse. A precise-looking number derived from a straight line
 * across a valley would be a lie told to three significant figures; the app
 * presents it as "about N min".
 */
create or replace function public.trip_driver_position(p_trip_id uuid)
returns table (
  lng          double precision,
  lat          double precision,
  recorded_at  timestamptz,
  metres_away  double precision,
  eta_seconds  integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip   public.trips;
  v_target geography;
begin
  select * into v_trip from public.trips where id = p_trip_id;
  if not found then
    return;
  end if;

  -- Both sides of a trip may see it; nobody else may.
  if v_trip.rider_id <> auth.uid() and v_trip.driver_id is distinct from auth.uid() then
    return;
  end if;

  if v_trip.state not in ('accepted', 'arrived', 'in_progress') then
    return;
  end if;

  -- Before the rider is aboard the driver is heading to the pickup; after, to
  -- the drop-off. The distance shown should be to wherever they are going.
  v_target := case
    when v_trip.state = 'in_progress' then v_trip.dropoff
    else v_trip.pickup
  end;

  return query
  select st_x(t.position::geometry),
         st_y(t.position::geometry),
         t.recorded_at,
         st_distance(t.position, v_target),
         -- 7.5 m/s is the same average the fare quote uses. One number, one
         -- meaning, rather than a second speed constant living here.
         greatest(30, (st_distance(t.position, v_target) / 7.5))::integer
    from public.trip_track_points t
   where t.trip_id = p_trip_id
   order by t.recorded_at desc
   limit 1;
end;
$$;

revoke all on function public.trip_driver_position(uuid) from public, anon;
grant execute on function public.trip_driver_position(uuid) to authenticated, service_role;

-- Old points are noise once a trip ends. Kept for a day so a dispute can be
-- looked at, then dropped - this table grows fastest of anything in the schema.
create index trip_track_points_trip_time_idx
  on public.trip_track_points (trip_id, recorded_at desc);

create or replace function public.prune_track_points()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  with gone as (
    delete from public.trip_track_points
     where recorded_at < now() - interval '24 hours'
    returning 1
  )
  select count(*)::integer into v_deleted from gone;
  return v_deleted;
end;
$$;

revoke all on function public.prune_track_points() from public, anon, authenticated;
grant execute on function public.prune_track_points() to service_role;

select cron.schedule('gera-prune-track-points', '17 3 * * *',
  $cron$ select public.prune_track_points(); $cron$);

-- ---------------------------------------------------------------------------
-- SOS
--
-- HONEST LIMIT: an alert is only worth as much as the person who answers it,
-- and there is no safety desk yet. So this records the alert with the trip and
-- the exact position, marks the trip for review, and the app puts the rider one
-- tap from 112. It does not pretend somebody is watching. Wiring this to a
-- staffed desk is a launch requirement, not a nice-to-have.

create type sos_source as enum ('rider', 'driver');

create table public.sos_alerts (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid references public.trips (id) on delete set null,
  raised_by    uuid not null references auth.users (id) on delete cascade,
  source       sos_source not null,
  position     geography(Point, 4326),
  note         text,
  acknowledged_at timestamptz,
  created_at   timestamptz not null default now()
);

create index sos_alerts_created_idx on public.sos_alerts (created_at desc);

alter table public.sos_alerts enable row level security;

-- The person who raised it may see it. Nobody else reads it through the API;
-- a safety desk uses service_role.
create policy sos_alerts_own_select on public.sos_alerts
  for select using (raised_by = auth.uid());

-- Naming authenticated in the revoke, not just public and anon: Supabase grants
-- it table privileges through ALTER DEFAULT PRIVILEGES, so leaving it out would
-- let anyone acknowledge or delete their own alert.
revoke all on table public.sos_alerts from public, anon, authenticated;
grant select on table public.sos_alerts to authenticated;
grant all on table public.sos_alerts to service_role;

/**
 * Raise an alert. Deliberately cheap to call and impossible to get wrong: no
 * required fields beyond who you are, because somebody in trouble should not be
 * filling in a form.
 */
create or replace function public.raise_sos(
  p_trip_id uuid default null,
  p_lng     double precision default null,
  p_lat     double precision default null,
  p_note    text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip   public.trips;
  v_source sos_source;
  v_id     uuid;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  v_source := 'rider';

  if p_trip_id is not null then
    select * into v_trip from public.trips where id = p_trip_id;
    if found then
      if v_trip.driver_id = auth.uid() then
        v_source := 'driver';
      elsif v_trip.rider_id <> auth.uid() then
        -- Not their trip. Still record the alert, just not against that trip -
        -- refusing to log because an id was wrong would be the wrong call here.
        p_trip_id := null;
      end if;
    else
      p_trip_id := null;
    end if;
  end if;

  insert into public.sos_alerts (trip_id, raised_by, source, position, note)
  values (
    p_trip_id,
    auth.uid(),
    v_source,
    case when p_lng is not null and p_lat is not null
         then st_setsrid(st_point(p_lng, p_lat), 4326)::geography
    end,
    p_note
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.raise_sos(uuid, double precision, double precision, text)
  from public, anon;
grant execute on function public.raise_sos(uuid, double precision, double precision, text)
  to authenticated, service_role;

-- Live position updates reach the rider without polling.
alter table public.trip_track_points replica identity full;
alter publication supabase_realtime add table public.trip_track_points;
