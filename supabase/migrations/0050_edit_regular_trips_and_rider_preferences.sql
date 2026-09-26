-- Changing booked rides, and primary / preferred / backup riders
-- (NOVA §12, §13).
--
-- §12: a passenger can already skip or cancel one ride and cancel a whole
-- schedule. Here they can also move one ride to another time that day, and
-- change a regular trip's days, time or end date from now on. A ride the
-- passenger moved by hand keeps the time they gave it when the schedule
-- changes around it.
--
-- §13: operations can name a primary, a preferred and a backup rider for a
-- regular trip, and hand any single ride to someone else. Dispatch offers the
-- ride to those riders first, in that order, if they are online and free -
-- and then carries on to the nearest riders as always. Nobody is promised the
-- same rider (§13: "should not be guaranteed"); the passenger is told
-- whenever the rider planned for them changes.

alter table public.trips add column if not exists occurrence_modified boolean not null default false;
alter table public.trips add column if not exists planned_rider_id uuid references public.riders(id);
alter table public.trips add column if not exists planned_by_staff boolean not null default false;
-- A ride cancelled because the passenger changed their schedule is replaced,
-- not refused: if the day comes back, it is booked again. The one-ride-per-day
-- rule covers every ride except the replaced ones.
alter table public.trips add column if not exists superseded boolean not null default false;
drop index if exists public.trips_occurrence_uniq;
create unique index trips_occurrence_uniq on public.trips (recurring_schedule_id, occurrence_date)
  where recurring_schedule_id is not null and not superseded;
create index if not exists trips_planned_rider_idx on public.trips (planned_rider_id, scheduled_for) where state = 'scheduled';

create table if not exists public.schedule_riders (
  schedule_id uuid not null references public.recurring_schedules(id) on delete cascade,
  role        text not null check (role in ('primary', 'preferred', 'backup')),
  rider_id    uuid not null references public.riders(id),
  set_by      uuid references auth.users(id),
  set_at      timestamptz not null default now(),
  primary key (schedule_id, role),
  unique (schedule_id, rider_id)
);
alter table public.schedule_riders enable row level security;
revoke all on public.schedule_riders from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The passenger: one ride
-- ---------------------------------------------------------------------------
create or replace function public.change_ride_time(p_trip_id uuid, p_time time)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  v_trip public.trips;
  v_day  date;
  v_at   timestamptz;
  v_lead integer;
begin
  select * into v_trip from public.trips where id = p_trip_id for update;
  if not found or v_trip.passenger_id is distinct from auth.uid() then
    raise exception 'not_your_trip' using errcode = '42501';
  end if;
  -- Once a ride is looking for a rider, moving it would move a rider.
  if v_trip.state <> 'scheduled' then
    raise exception 'ride_already_released' using errcode = '22023';
  end if;

  v_day := coalesce(v_trip.occurrence_date, (v_trip.scheduled_for at time zone 'Africa/Kigali')::date);
  v_at := (v_day + p_time) at time zone 'Africa/Kigali';
  select schedule_min_lead_seconds into v_lead from public.platform_settings;
  if v_at < now() + make_interval(secs => v_lead) then
    raise exception 'too_soon' using errcode = '22023';
  end if;

  update public.trips set scheduled_for = v_at, occurrence_modified = true where id = p_trip_id;
  -- The quote is valid until the ride it priced.
  update public.fare_quotes set expires_at = v_at where id = v_trip.quote_id;
  return v_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- The passenger: a regular trip, from now on
-- ---------------------------------------------------------------------------
create or replace function public.change_recurring_schedule(
  p_schedule_id uuid, p_days smallint[], p_time time, p_end date
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_s        public.recurring_schedules;
  v_set      public.platform_settings;
  v_days     smallint[];
  t          record;
  v_at       timestamptz;
  v_moved    integer := 0;
  v_dropped  integer := 0;
  v_added    integer;
begin
  select * into v_s from public.recurring_schedules where id = p_schedule_id for update;
  if not found or v_s.passenger_id is distinct from auth.uid() then
    raise exception 'not_your_schedule' using errcode = '42501';
  end if;
  if v_s.status <> 'active' then
    raise exception 'schedule_not_active' using errcode = '22023';
  end if;

  select array_agg(distinct d order by d) into v_days from unnest(p_days) d where d between 1 and 7;
  if v_days is null then
    raise exception 'pick_a_day' using errcode = '22023';
  end if;
  select * into v_set from public.platform_settings;
  if p_end < public.kigali_today() then
    raise exception 'ends_in_the_past' using errcode = '22023';
  end if;
  if p_end - v_s.start_date > v_set.recurring_max_days then
    raise exception 'schedule_too_long' using errcode = '22023';
  end if;

  update public.recurring_schedules
     set days = v_days, time_of_day = p_time, end_date = p_end
   where id = p_schedule_id;

  for t in
    select id, occurrence_date, occurrence_modified, scheduled_for
      from public.trips
     where recurring_schedule_id = p_schedule_id and state = 'scheduled'
     for update
  loop
    if not (extract(isodow from t.occurrence_date)::smallint = any (v_days)) or t.occurrence_date > p_end then
      perform public.trip_transition(t.id, 'cancelled_by_passenger',
        'schedule-change-' || t.id || '-' || extract(epoch from now())::bigint,
        jsonb_build_object('schedule', p_schedule_id, 'reason', 'schedule_changed'));
      update public.trips set superseded = true where id = t.id;
      v_dropped := v_dropped + 1;
    elsif not t.occurrence_modified then
      v_at := (t.occurrence_date + p_time) at time zone 'Africa/Kigali';
      -- A ride about to go out keeps its time; a change lands on the ones after.
      continue when v_at <= now() + make_interval(secs => v_set.schedule_min_lead_seconds)
                 or t.scheduled_for <= now() + make_interval(secs => v_set.schedule_min_lead_seconds);
      continue when v_at = t.scheduled_for;
      update public.trips set scheduled_for = v_at where id = t.id;
      update public.fare_quotes set expires_at = v_at
       where id = (select quote_id from public.trips where id = t.id);
      v_moved := v_moved + 1;
    end if;
  end loop;

  v_added := public.materialise_schedule_internal(p_schedule_id);
  return jsonb_build_object('moved', v_moved, 'cancelled', v_dropped, 'added', v_added);
end;
$$;

-- New occurrences carry the schedule's primary rider as their plan.
create or replace function public.materialise_schedule_internal(p_schedule_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_s       public.recurring_schedules;
  v_set     public.platform_settings;
  v_day     date;
  v_at      timestamptz;
  v_quote   uuid;
  v_primary uuid;
  v_created integer := 0;
begin
  select * into v_s from public.recurring_schedules where id = p_schedule_id;
  if not found or v_s.status <> 'active' then
    return 0;
  end if;
  select * into v_set from public.platform_settings;
  select rider_id into v_primary from public.schedule_riders where schedule_id = p_schedule_id and role = 'primary';

  for v_day in
    select d::date
      from generate_series(
             greatest(v_s.start_date, public.kigali_today()),
             least(v_s.end_date, public.kigali_today() + v_set.recurring_horizon_days),
             interval '1 day') d
     where extract(isodow from d)::smallint = any (v_s.days)
  loop
    v_at := (v_day + v_s.time_of_day) at time zone 'Africa/Kigali';
    -- Nothing in the past, and nothing so close it would be released the
    -- moment it exists.
    continue when v_at <= now() + make_interval(secs => v_set.schedule_release_lead_seconds);
    -- A day already booked - including one the passenger cancelled or
    -- skipped - is not booked again. The exception is a day dropped by a
    -- schedule change and then put back by a later one.
    continue when exists (
      select 1 from public.trips
       where recurring_schedule_id = v_s.id and occurrence_date = v_day and not superseded
    );

    insert into public.fare_quotes
      (passenger_id, policy_id, vehicle_class, distance_m, duration_s, amount_rwf, expires_at)
    values
      (v_s.passenger_id, v_s.policy_id, v_s.vehicle_class, v_s.distance_m,
       v_s.duration_s, v_s.amount_rwf, v_at)
    returning id into v_quote;

    insert into public.trips
      (passenger_id, vehicle_class, state, pickup, pickup_label, pickup_note,
       dropoff, dropoff_label, quoted_distance_m, quoted_duration_s,
       quote_id, quoted_amount_rwf, scheduled_for, recurring_schedule_id, occurrence_date,
       planned_rider_id)
    values
      (v_s.passenger_id, v_s.vehicle_class, 'scheduled', v_s.pickup, v_s.pickup_label,
       v_s.pickup_note, v_s.dropoff, v_s.dropoff_label, v_s.distance_m, v_s.duration_s,
       v_quote, v_s.amount_rwf, v_at, v_s.id, v_day, v_primary);

    v_created := v_created + 1;
  end loop;

  return v_created;
end;
$$;

-- ---------------------------------------------------------------------------
-- Dispatch: the planned riders first
-- ---------------------------------------------------------------------------
-- The riders a trip should be offered to before anyone else, best first.
create or replace function public.preferred_riders_for(p_trip public.trips)
returns table (rider_id uuid, pref integer) language sql stable security definer set search_path = public as $$
  select x.rider_id, min(x.pref)::integer
    from (
      select p_trip.planned_rider_id as rider_id, 0 as pref where p_trip.planned_rider_id is not null
      union all
      select sr.rider_id, case sr.role when 'primary' then 1 when 'preferred' then 2 else 3 end
        from public.schedule_riders sr
       where sr.schedule_id = p_trip.recurring_schedule_id
    ) x
   group by x.rider_id;
$$;

create or replace function public.offer_next_candidate(p_trip_id uuid)
returns public.trip_offers language plpgsql security definer set search_path = public as $$
declare
  -- Three offers to the nearest riders, as before. Planned riders are tried
  -- on top of those, so naming a primary rider never costs a passenger the
  -- ordinary search.
  v_base_attempts constant integer := 3;
  v_radius_m      constant integer := 4000;
  -- Far enough to reach a primary rider who is across town when their
  -- regular passenger's ride is released.
  v_planned_radius_m constant integer := 15000;
  v_scan_limit    constant integer := 10;
  v_trip      public.trips;
  v_rider_id  uuid;
  v_attempt   integer;
  v_planned   integer;
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

  update public.trips
     set dispatch_attempts = greatest(
           dispatch_attempts,
           (select count(*) from public.trip_offers where trip_id = p_trip_id)
         ) + 1
   where id = p_trip_id
  returning dispatch_attempts into v_attempt;

  select count(*) into v_planned from public.preferred_riders_for(v_trip);
  if v_attempt > v_base_attempts + v_planned then
    perform public.trip_transition_system(
      p_trip_id, 'no_riders',
      'dispatch-exhausted-' || p_trip_id::text,
      jsonb_build_object('reason', 'max_attempts', 'attempts', v_attempt));
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
   order by pr.pref, c.distance_m
   limit 1;

  -- 2. Otherwise the nearest, as for any ride.
  if v_rider_id is null then
    select c.rider_id into v_rider_id
      from public.find_candidate_riders(v_trip.pickup, v_trip.vehicle_class, v_radius_m, v_scan_limit) c
     where not exists (select 1 from public.trip_offers o where o.trip_id = p_trip_id and o.rider_id = c.rider_id)
       and not exists (select 1 from public.trip_offers o2 where o2.rider_id = c.rider_id and o2.outcome is null)
     order by c.distance_m
     limit 1;
  end if;

  if v_rider_id is null then
    perform public.trip_transition_system(
      p_trip_id, 'no_riders',
      'dispatch-no-candidates-' || p_trip_id::text || '-' || v_attempt::text,
      jsonb_build_object('reason', 'no_candidates', 'attempts', v_attempt));
    return null;
  end if;

  return public.create_trip_offer(
    p_trip_id, v_rider_id, v_attempt, null,
    public.offer_ttl_seconds(),
    'reoffer-' || p_trip_id::text || '-' || v_attempt::text);
end;
$$;

-- ---------------------------------------------------------------------------
-- Operations
-- ---------------------------------------------------------------------------
create or replace function public.rider_fits_schedule_internal(p_rider_id uuid, p_class public.vehicle_class)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.riders r
      join public.vehicles v on v.rider_id = r.id and v.is_active
     where r.id = p_rider_id and r.verification = 'verified' and v.class = p_class);
$$;

create or replace function public.notify_rider_change_internal(p_trip public.trips, p_new uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_name text;
begin
  select first_name into v_name from public.profiles where id = p_new;
  perform public.notify_user(p_trip.passenger_id,
    'Your rider has changed',
    case when p_new is null
         then 'For your ride at ' || to_char(p_trip.scheduled_for at time zone 'Africa/Kigali', 'Dy DD Mon HH24:MI')
              || ', the nearest available rider will pick you up.'
         else v_name || ' is now planned for your ride at '
              || to_char(p_trip.scheduled_for at time zone 'Africa/Kigali', 'Dy DD Mon HH24:MI') || '.' end,
    jsonb_build_object('kind', 'rider_changed', 'tripId', p_trip.id));
end;
$$;

create or replace function public.staff_set_schedule_rider(p_schedule_id uuid, p_role text, p_rider_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_s    public.recurring_schedules;
  v_old  uuid;
  t      public.trips;
  v_told boolean := false;
begin
  perform public.require_staff(array['operations', 'control_room']::public.staff_role[]);
  if p_role not in ('primary', 'preferred', 'backup') then
    raise exception 'bad_role' using errcode = '22023';
  end if;
  select * into v_s from public.recurring_schedules where id = p_schedule_id;
  if not found then
    raise exception 'schedule_not_found' using errcode = 'P0002';
  end if;
  if p_rider_id is not null and not public.rider_fits_schedule_internal(p_rider_id, v_s.vehicle_class) then
    raise exception 'rider_cannot_take_this' using errcode = '22023';
  end if;

  select rider_id into v_old from public.schedule_riders where schedule_id = p_schedule_id and role = p_role;
  delete from public.schedule_riders where schedule_id = p_schedule_id and (role = p_role or rider_id = p_rider_id);
  if p_rider_id is not null then
    insert into public.schedule_riders (schedule_id, role, rider_id, set_by)
    values (p_schedule_id, p_role, p_rider_id, auth.uid());
  end if;

  -- The primary rider is the plan for every ride still to come, except the
  -- ones staff have handed to someone in particular.
  if p_role = 'primary' and v_old is distinct from p_rider_id then
    for t in
      select * from public.trips
       where recurring_schedule_id = p_schedule_id and state = 'scheduled' and not planned_by_staff
       order by scheduled_for
    loop
      update public.trips set planned_rider_id = p_rider_id where id = t.id;
      -- One message for the change, about the next ride, rather than one per day.
      if not v_told then
        perform public.notify_rider_change_internal(t, p_rider_id);
        v_told := true;
      end if;
    end loop;
  end if;

  perform public.audit_internal('schedule.rider', 'recurring_schedule', p_schedule_id::text,
    jsonb_build_object('role', p_role, 'from', v_old, 'to', p_rider_id));
end;
$$;

create or replace function public.staff_reassign_ride(p_trip_id uuid, p_rider_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_trip public.trips;
begin
  perform public.require_staff(array['operations', 'control_room']::public.staff_role[]);
  select * into v_trip from public.trips where id = p_trip_id for update;
  if not found then
    raise exception 'trip_not_found' using errcode = 'P0002';
  end if;
  -- A ride already with a rider is changed by cancelling it, not by quietly
  -- swapping who turns up.
  if v_trip.state not in ('scheduled', 'requested') then
    raise exception 'ride_already_assigned' using errcode = '22023';
  end if;
  if p_rider_id is not null and not public.rider_fits_schedule_internal(p_rider_id, v_trip.vehicle_class) then
    raise exception 'rider_cannot_take_this' using errcode = '22023';
  end if;
  if v_trip.planned_rider_id is not distinct from p_rider_id then
    return;
  end if;

  update public.trips set planned_rider_id = p_rider_id, planned_by_staff = true where id = p_trip_id;
  perform public.notify_rider_change_internal(v_trip, p_rider_id);
  perform public.audit_internal('ride.reassign', 'trip', p_trip_id::text,
    jsonb_build_object('from', v_trip.planned_rider_id, 'to', p_rider_id));
end;
$$;

create or replace function public.staff_regular_trips()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_staff(array['operations', 'control_room']::public.staff_role[]);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'passenger', p.first_name, 'phone', p.phone, 'class', s.vehicle_class,
      'pickup', s.pickup_label, 'dropoff', s.dropoff_label, 'days', s.days,
      'time', to_char(s.time_of_day, 'HH24:MI'), 'start', s.start_date, 'end', s.end_date,
      'riders', coalesce((
        select jsonb_object_agg(sr.role, jsonb_build_object('id', sr.rider_id, 'name', rp.first_name, 'vest', v.vest_number))
          from public.schedule_riders sr
          join public.profiles rp on rp.id = sr.rider_id
          left join public.vehicles v on v.rider_id = sr.rider_id and v.is_active
         where sr.schedule_id = s.id), '{}'::jsonb),
      'rides', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', t.id, 'at', t.scheduled_for, 'state', t.state, 'moved', t.occurrence_modified,
                 'rider_id', t.planned_rider_id, 'rider', rp.first_name, 'by_staff', t.planned_by_staff)
                 order by t.scheduled_for)
          from public.trips t
          left join public.profiles rp on rp.id = t.planned_rider_id
         where t.recurring_schedule_id = s.id and t.state in ('scheduled', 'requested', 'offered')), '[]'::jsonb)
    ) order by s.time_of_day)
    from public.recurring_schedules s
    join public.profiles p on p.id = s.passenger_id
   where s.status = 'active' and s.end_date >= public.kigali_today()
  ), '[]'::jsonb);
end;
$$;

-- Riders a schedule could be given: verified, with a vehicle of its class.
create or replace function public.staff_riders_for_class(p_class public.vehicle_class)
returns table (id uuid, name text, vest text, plate text) language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.require_staff(array['operations', 'control_room']::public.staff_role[]);
  return query
    select r.id, p.first_name, v.vest_number, v.plate
      from public.riders r
      join public.profiles p on p.id = r.id
      join public.vehicles v on v.rider_id = r.id and v.is_active and v.class = p_class
     where r.verification = 'verified'
     order by p.first_name;
end;
$$;

-- ---------------------------------------------------------------------------
-- What the passenger and the rider see
-- ---------------------------------------------------------------------------
-- The passenger's booked rides, with who is planned to take each. A plan, not
-- a promise: the app says "usually".
create or replace function public.my_upcoming_rides()
returns table (
  id uuid, scheduled_for timestamptz, pickup_label text, dropoff_label text, quoted_amount_rwf integer,
  vehicle_class text, recurring_schedule_id uuid, moved boolean, rider_name text, rider_vest text
) language sql stable security definer set search_path = public as $$
  select t.id, t.scheduled_for, t.pickup_label, t.dropoff_label, t.quoted_amount_rwf,
         t.vehicle_class::text, t.recurring_schedule_id, t.occurrence_modified, rp.first_name, v.vest_number
    from public.trips t
    left join public.profiles rp on rp.id = t.planned_rider_id
    left join public.vehicles v on v.rider_id = t.planned_rider_id and v.is_active
   where t.passenger_id = auth.uid() and t.state = 'scheduled'
   order by t.scheduled_for
   limit 50;
$$;

create or replace function public.my_planned_rides()
returns table (id uuid, scheduled_for timestamptz, pickup_label text, dropoff_label text, passenger_name text)
language sql stable security definer set search_path = public as $$
  select t.id, t.scheduled_for, t.pickup_label, t.dropoff_label, p.first_name
    from public.trips t
    join public.profiles p on p.id = t.passenger_id
   where t.planned_rider_id = auth.uid() and t.state = 'scheduled'
     and t.scheduled_for < now() + interval '7 days'
   order by t.scheduled_for
   limit 30;
$$;

revoke execute on function
  public.change_ride_time(uuid, time),
  public.change_recurring_schedule(uuid, smallint[], time, date),
  public.materialise_schedule_internal(uuid),
  public.preferred_riders_for(public.trips),
  public.offer_next_candidate(uuid),
  public.rider_fits_schedule_internal(uuid, public.vehicle_class),
  public.notify_rider_change_internal(public.trips, uuid),
  public.staff_set_schedule_rider(uuid, text, uuid),
  public.staff_reassign_ride(uuid, uuid),
  public.staff_regular_trips(),
  public.staff_riders_for_class(public.vehicle_class),
  public.my_upcoming_rides(),
  public.my_planned_rides()
from public, anon, authenticated;

grant execute on function
  public.change_ride_time(uuid, time),
  public.change_recurring_schedule(uuid, smallint[], time, date),
  public.staff_set_schedule_rider(uuid, text, uuid),
  public.staff_reassign_ride(uuid, uuid),
  public.staff_regular_trips(),
  public.staff_riders_for_class(public.vehicle_class),
  public.my_upcoming_rides(),
  public.my_planned_rides()
to authenticated;
