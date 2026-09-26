-- Scheduled and recurring rides (NOVA §9-§12, §41, §96), and fleet rider
-- registration.
--
-- A scheduled ride is a trip with a future `scheduled_for`, held in the
-- `scheduled` state until shortly before pickup, when it is released into the
-- ordinary dispatch queue. Nothing downstream of release knows it was booked
-- ahead - dispatch, the PIN, waiting and completion all work unchanged.
--
-- A recurring schedule is a separate record (§96), and each day it covers is
-- its own trip - an occurrence - created a week ahead. One occurrence can be
-- skipped, cancelled or fail without touching the rest (§11, §12).
--
-- The price is locked when the passenger books. For a recurring schedule it is
-- locked for the life of the schedule: each occurrence gets its own copy of the
-- schedule's quote (trips.quote_id is unique), priced under the policy in force
-- on the day it was booked.

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
alter table public.platform_settings
  -- Released to dispatch this long before pickup. Long enough to find a rider
  -- and for them to ride over; short enough that they are not parked outside
  -- someone's gate for half an hour.
  add column if not exists schedule_release_lead_seconds integer not null default 600
    check (schedule_release_lead_seconds between 60 and 3600),
  -- A "scheduled" ride booked for four minutes from now is really a ride now,
  -- and would be released before the passenger has closed the app.
  add column if not exists schedule_min_lead_seconds integer not null default 1800
    check (schedule_min_lead_seconds >= 0),
  add column if not exists schedule_max_days_ahead integer not null default 30
    check (schedule_max_days_ahead > 0),
  -- The price is locked for the whole schedule, so the schedule cannot run
  -- forever at a price nobody would set today.
  add column if not exists recurring_max_days integer not null default 92
    check (recurring_max_days > 0),
  add column if not exists recurring_horizon_days integer not null default 7
    check (recurring_horizon_days between 1 and 31);

-- ---------------------------------------------------------------------------
-- Transitions
-- ---------------------------------------------------------------------------
insert into public.trip_transition_rules (from_state, to_state, actor) values
  ('scheduled', 'requested', 'system'),
  ('scheduled', 'cancelled_by_passenger', 'passenger'),
  ('scheduled', 'skipped', 'passenger')
on conflict do nothing;

create or replace function public.is_terminal(p_state public.trip_state)
returns boolean language sql immutable as $$
  select p_state in (
    'completed', 'cancelled_by_passenger', 'cancelled_by_rider', 'expired',
    'no_riders', 'no_show', 'skipped'
  );
$$;

-- ---------------------------------------------------------------------------
-- Recurring schedules
-- ---------------------------------------------------------------------------
create table if not exists public.recurring_schedules (
  id                uuid primary key default gen_random_uuid(),
  passenger_id      uuid not null references public.profiles(id),
  vehicle_class     public.vehicle_class not null,
  pickup            geography(Point, 4326) not null,
  pickup_label      text not null,
  pickup_note       text,
  dropoff           geography(Point, 4326) not null,
  dropoff_label     text not null,
  -- ISO weekdays, 1 = Monday. A schedule with no days is not a schedule.
  days              smallint[] not null
                    check (cardinality(days) between 1 and 7 and days <@ array[1,2,3,4,5,6,7]::smallint[]),
  -- Local Kigali time. Rwanda has no daylight saving, so this never drifts.
  time_of_day       time not null,
  start_date        date not null,
  end_date          date not null,
  -- The locked price, copied off the quote the passenger accepted.
  policy_id         uuid not null references public.fare_policies(id),
  distance_m        integer not null,
  duration_s        integer not null,
  amount_rwf        integer not null,
  status            text not null default 'active' check (status in ('active', 'cancelled')),
  created_at        timestamptz not null default now(),
  cancelled_at      timestamptz,
  check (end_date >= start_date)
);

create index if not exists recurring_schedules_active_idx
  on public.recurring_schedules (status) where status = 'active';

alter table public.recurring_schedules enable row level security;
revoke all on public.recurring_schedules from public, anon, authenticated;
grant select on public.recurring_schedules to authenticated;

drop policy if exists recurring_schedules_select_own on public.recurring_schedules;
create policy recurring_schedules_select_own on public.recurring_schedules
  for select using (passenger_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Trips learn when they are for
-- ---------------------------------------------------------------------------
alter table public.trips
  add column if not exists scheduled_for timestamptz,
  add column if not exists recurring_schedule_id uuid references public.recurring_schedules(id),
  add column if not exists occurrence_date date;

-- One trip per schedule per day: the materialiser runs hourly and must be
-- idempotent against itself.
create unique index if not exists trips_occurrence_uniq
  on public.trips (recurring_schedule_id, occurrence_date)
  where recurring_schedule_id is not null;

create index if not exists trips_scheduled_idx
  on public.trips (scheduled_for) where state = 'scheduled';

create or replace function public.kigali_today()
returns date language sql stable as $$
  select (now() at time zone 'Africa/Kigali')::date;
$$;

-- One-off: book now, ride later.
create or replace function public.schedule_trip_from_quote(
  p_quote_id uuid, p_pickup geography, p_pickup_label text, p_pickup_note text,
  p_dropoff geography, p_dropoff_label text, p_scheduled_for timestamptz
) returns public.trips
language plpgsql security definer set search_path = public as $$
declare
  v_quote public.fare_quotes;
  v_trip  public.trips;
  v_set   public.platform_settings;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  select * into v_quote from public.fare_quotes where id = p_quote_id;
  if not found then
    raise exception 'quote_not_found' using errcode = 'P0002';
  end if;
  if v_quote.passenger_id <> auth.uid() then
    raise exception 'quote_not_yours' using errcode = '42501';
  end if;
  if v_quote.expires_at <= now() then
    raise exception 'quote_expired' using errcode = '22023';
  end if;

  select * into v_set from public.platform_settings;
  if p_scheduled_for < now() + make_interval(secs => v_set.schedule_min_lead_seconds) then
    raise exception 'too_soon' using errcode = '22023';
  end if;
  if p_scheduled_for > now() + make_interval(days => v_set.schedule_max_days_ahead) then
    raise exception 'too_far_ahead' using errcode = '22023';
  end if;

  insert into public.trips
    (passenger_id, vehicle_class, state, pickup, pickup_label, pickup_note,
     dropoff, dropoff_label, quoted_distance_m, quoted_duration_s,
     quote_id, quoted_amount_rwf, scheduled_for)
  values
    (auth.uid(), v_quote.vehicle_class, 'scheduled', p_pickup, p_pickup_label,
     nullif(btrim(coalesce(p_pickup_note, '')), ''),
     p_dropoff, p_dropoff_label, v_quote.distance_m, v_quote.duration_s,
     v_quote.id, v_quote.amount_rwf, p_scheduled_for)
  returning * into v_trip;

  return v_trip;
end;
$$;

-- Creates the occurrences of one schedule up to the horizon. Internal: called
-- when a schedule is booked and by the hourly job. Idempotent - an occurrence
-- that exists is left exactly as it is, whatever state it has reached, so a
-- skipped day is never resurrected.
create or replace function public.materialise_schedule_internal(p_schedule_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_s       public.recurring_schedules;
  v_set     public.platform_settings;
  v_day     date;
  v_at      timestamptz;
  v_quote   uuid;
  v_created integer := 0;
begin
  select * into v_s from public.recurring_schedules where id = p_schedule_id;
  if not found or v_s.status <> 'active' then
    return 0;
  end if;
  select * into v_set from public.platform_settings;

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
    continue when exists (
      select 1 from public.trips
       where recurring_schedule_id = v_s.id and occurrence_date = v_day
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
       quote_id, quoted_amount_rwf, scheduled_for, recurring_schedule_id, occurrence_date)
    values
      (v_s.passenger_id, v_s.vehicle_class, 'scheduled', v_s.pickup, v_s.pickup_label,
       v_s.pickup_note, v_s.dropoff, v_s.dropoff_label, v_s.distance_m, v_s.duration_s,
       v_quote, v_s.amount_rwf, v_at, v_s.id, v_day);

    v_created := v_created + 1;
  end loop;

  return v_created;
end;
$$;

create or replace function public.materialise_recurring()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_id    uuid;
  v_total integer := 0;
begin
  for v_id in select id from public.recurring_schedules where status = 'active' loop
    begin
      v_total := v_total + public.materialise_schedule_internal(v_id);
    exception when others then
      -- One broken schedule must not stop everyone else's rides being created.
      raise warning 'materialise_recurring: schedule % failed: %', v_id, sqlerrm;
    end;
  end loop;
  return v_total;
end;
$$;

create or replace function public.create_recurring_schedule(
  p_quote_id uuid, p_pickup geography, p_pickup_label text, p_pickup_note text,
  p_dropoff geography, p_dropoff_label text,
  p_days smallint[], p_time time, p_start date, p_end date
) returns public.recurring_schedules
language plpgsql security definer set search_path = public as $$
declare
  v_quote public.fare_quotes;
  v_s     public.recurring_schedules;
  v_set   public.platform_settings;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  select * into v_quote from public.fare_quotes where id = p_quote_id;
  if not found then
    raise exception 'quote_not_found' using errcode = 'P0002';
  end if;
  if v_quote.passenger_id <> auth.uid() then
    raise exception 'quote_not_yours' using errcode = '42501';
  end if;
  if v_quote.expires_at <= now() then
    raise exception 'quote_expired' using errcode = '22023';
  end if;

  select * into v_set from public.platform_settings;
  if p_start < public.kigali_today() then
    raise exception 'starts_in_the_past' using errcode = '22023';
  end if;
  if p_end < p_start then
    raise exception 'ends_before_it_starts' using errcode = '22023';
  end if;
  if p_end - p_start > v_set.recurring_max_days then
    raise exception 'schedule_too_long' using errcode = '22023';
  end if;

  insert into public.recurring_schedules
    (passenger_id, vehicle_class, pickup, pickup_label, pickup_note, dropoff,
     dropoff_label, days, time_of_day, start_date, end_date, policy_id,
     distance_m, duration_s, amount_rwf)
  values
    (auth.uid(), v_quote.vehicle_class, p_pickup, p_pickup_label,
     nullif(btrim(coalesce(p_pickup_note, '')), ''), p_dropoff, p_dropoff_label,
     (select array_agg(distinct d order by d) from unnest(p_days) d), p_time,
     p_start, p_end, v_quote.policy_id, v_quote.distance_m, v_quote.duration_s,
     v_quote.amount_rwf)
  returning * into v_s;

  -- The quote the passenger accepted is spent: it priced the schedule, and it
  -- must not also be bookable as a ride now.
  update public.fare_quotes set expires_at = now() where id = v_quote.id;

  perform public.materialise_schedule_internal(v_s.id);
  return v_s;
end;
$$;

-- Cancels the schedule and every occurrence still in the future. Occurrences
-- already released, running or finished are left alone - cancelling the
-- schedule is not a way to cancel a rider who is already on the way.
create or replace function public.cancel_recurring_schedule(p_schedule_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_trip  uuid;
  v_count integer := 0;
begin
  update public.recurring_schedules
     set status = 'cancelled', cancelled_at = now()
   where id = p_schedule_id and passenger_id = auth.uid() and status = 'active';
  if not found then
    if not exists (
      select 1 from public.recurring_schedules where id = p_schedule_id and passenger_id = auth.uid()
    ) then
      raise exception 'not_your_schedule' using errcode = '42501';
    end if;
    return 0;
  end if;

  for v_trip in
    select id from public.trips
     where recurring_schedule_id = p_schedule_id and state = 'scheduled'
  loop
    perform public.trip_transition(v_trip, 'cancelled_by_passenger',
      'cancel-schedule-' || v_trip, jsonb_build_object('schedule', p_schedule_id));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Release
-- ---------------------------------------------------------------------------
create or replace function public.release_scheduled_trips()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_lead  integer;
  v_trip  uuid;
  v_count integer := 0;
begin
  select schedule_release_lead_seconds into v_lead from public.platform_settings;
  for v_trip in
    select id from public.trips
     where state = 'scheduled'
       and scheduled_for <= now() + make_interval(secs => v_lead)
     order by scheduled_for
     limit 100
  loop
    begin
      perform public.trip_transition_system(v_trip, 'requested', 'release-' || v_trip,
        jsonb_build_object('released_at', now()));
      v_count := v_count + 1;
    exception when others then
      raise warning 'release_scheduled_trips: trip % failed: %', v_trip, sqlerrm;
    end;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Waiting starts at the booked time, not before it.
--
-- A scheduled ride is released early, so its rider can arrive early. The clock
-- a passenger pays for must not start until the time they booked - they are
-- not late for 7:30 at 7:24.
-- ---------------------------------------------------------------------------
create or replace function public.trip_arrived_at_internal(p_trip_id uuid)
returns timestamptz language sql stable security definer set search_path = public as $$
  select case
    when a.at is null then null
    else greatest(a.at, coalesce(t.scheduled_for, a.at))
  end
    from public.trips t,
         (select max(created_at) as at from public.trip_events
           where trip_id = p_trip_id and to_state = 'arrived') a
   where t.id = p_trip_id;
$$;

create or replace function public.trip_waited_seconds_internal(p_trip_id uuid)
returns integer language sql stable security definer set search_path = public as $$
  with a as (select public.trip_arrived_at_internal(p_trip_id) as at),
       s as (
         select min(e.created_at) as at
           from public.trip_events e
          where e.trip_id = p_trip_id and e.to_state = 'in_progress'
       )
  select case
    when a.at is null then 0
    else greatest(0, floor(extract(epoch from (coalesce(s.at, now()) - a.at)))::integer)
  end
  from a, s;
$$;

-- ---------------------------------------------------------------------------
-- Push: tell the passenger their booked ride is being matched.
-- ---------------------------------------------------------------------------
create or replace function public.push_on_trip_state()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_total integer;
  v_grace integer;
begin
  if new.state = old.state then return new; end if;

  if new.state = 'requested' and old.state = 'scheduled' then
    perform public.notify_user(new.passenger_id, 'Finding your rider',
      'Your ride to ' || coalesce(new.dropoff_label, 'your destination') || ' at '
        || to_char(new.scheduled_for at time zone 'Africa/Kigali', 'HH24:MI') || ' is being matched now.',
      jsonb_build_object('kind', 'trip', 'tripId', new.id, 'state', new.state));

  elsif new.state = 'accepted' then
    perform public.notify_user(new.passenger_id, 'Rider on the way',
      'Your rider is coming to ' || coalesce(new.pickup_label, 'the pickup') || '.',
      jsonb_build_object('kind', 'trip', 'tripId', new.id, 'state', new.state));

  elsif new.state = 'arrived' then
    select wait_grace_seconds into v_grace from public.platform_settings;
    perform public.notify_user(new.passenger_id, 'Your rider is here',
      'They will wait ' || (v_grace / 60) || ' minutes free of charge.',
      jsonb_build_object('kind', 'trip', 'tripId', new.id, 'state', new.state));

  elsif new.state = 'completed' then
    select (meta->>'total_rwf')::integer into v_total
      from public.trip_events
     where trip_id = new.id and to_state = 'completed'
     order by created_at desc limit 1;
    perform public.notify_user(new.passenger_id, 'Trip complete',
      'Pay ' || coalesce(v_total, new.quoted_amount_rwf)::text || ' RWF in cash.',
      jsonb_build_object('kind', 'trip', 'tripId', new.id, 'state', new.state));

  elsif new.state = 'no_riders' then
    perform public.notify_user(new.passenger_id, 'No riders nearby',
      'Nobody was free. Try again in a few minutes.',
      jsonb_build_object('kind', 'trip', 'tripId', new.id, 'state', new.state));

  elsif new.state = 'no_show' then
    perform public.notify_user(new.passenger_id, 'Your rider could not find you',
      'They waited at the pickup and have left. Book again when you are ready.',
      jsonb_build_object('kind', 'trip', 'tripId', new.id, 'state', new.state));

  elsif new.state = 'cancelled_by_passenger' and new.rider_id is not null then
    perform public.notify_user(new.rider_id, 'Trip cancelled',
      'The passenger cancelled this trip.',
      jsonb_build_object('kind', 'trip', 'tripId', new.id, 'state', new.state));

  elsif new.state = 'cancelled_by_rider' then
    perform public.notify_user(new.passenger_id, 'Trip cancelled',
      'Your rider cancelled. Book again and we will find someone else.',
      jsonb_build_object('kind', 'trip', 'tripId', new.id, 'state', new.state));
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fleet rider registration.
--
-- The old register_rider took a plate, a vest number and a vehicle class from
-- the rider - a marketplace question. In a fleet the company owns the vehicles
-- and assigns one when it approves the rider, so registration asks only what
-- identifies the person.
-- ---------------------------------------------------------------------------
drop function if exists public.register_rider(text, text, text, text, text, public.vehicle_class);

create or replace function public.register_rider(
  p_first_name text, p_phone text, p_licence text, p_national_id text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_first_name, ''))) = 0 or length(btrim(coalesce(p_licence, ''))) = 0 then
    raise exception 'missing_details' using errcode = '22023';
  end if;

  insert into public.profiles (id, role, first_name, phone)
  values (v_uid, 'rider', btrim(p_first_name), p_phone)
  on conflict (id) do update
     set role       = 'rider',
         first_name = excluded.first_name,
         phone      = excluded.phone,
         updated_at = now();

  -- `verification` is hardcoded and is deliberately NOT a parameter. Ops owns
  -- that value; an existing row keeps whatever ops already gave it.
  insert into public.riders (id, verification, licence_number, national_id)
  values (v_uid, 'submitted', btrim(p_licence), nullif(btrim(coalesce(p_national_id, '')), ''))
  on conflict (id) do update
     set licence_number = excluded.licence_number,
         national_id    = coalesce(excluded.national_id, public.riders.national_id),
         updated_at     = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- Jobs and grants
-- ---------------------------------------------------------------------------
select cron.schedule('gera-release-scheduled-trips', '30 seconds',
  $cron$ select public.release_scheduled_trips(); $cron$);
select cron.schedule('gera-materialise-recurring', '7 * * * *',
  $cron$ select public.materialise_recurring(); $cron$);

revoke execute on function
  public.is_terminal(public.trip_state),
  public.kigali_today(),
  public.schedule_trip_from_quote(uuid, geography, text, text, geography, text, timestamptz),
  public.materialise_schedule_internal(uuid),
  public.materialise_recurring(),
  public.create_recurring_schedule(uuid, geography, text, text, geography, text, smallint[], time, date, date),
  public.cancel_recurring_schedule(uuid),
  public.release_scheduled_trips(),
  public.trip_arrived_at_internal(uuid),
  public.trip_waited_seconds_internal(uuid),
  public.push_on_trip_state(),
  public.register_rider(text, text, text, text)
from public, anon, authenticated;

grant execute on function
  public.is_terminal(public.trip_state),
  public.kigali_today(),
  public.schedule_trip_from_quote(uuid, geography, text, text, geography, text, timestamptz),
  public.create_recurring_schedule(uuid, geography, text, text, geography, text, smallint[], time, date, date),
  public.cancel_recurring_schedule(uuid),
  public.register_rider(text, text, text, text)
to authenticated;
