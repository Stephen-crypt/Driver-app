-- The rider's working day, NOVA §15, §16, §18, §25 and §29:
--
--   shifts        start with safety checks, end with a vehicle condition report
--   ride PIN      the passenger reads it out; the trip cannot start without it
--   waiting time  a grace period after the rider arrives, then a per-minute charge
--   no-show       the rider reports a passenger who never came, after the grace
--   reports       vehicle problems, safety issues, accidents
--
-- Every write goes through a function. No table here grants INSERT, UPDATE or
-- DELETE to a client role, and every function revokes EXECUTE from PUBLIC before
-- granting it: Postgres grants EXECUTE to PUBLIC by default and anon inherits
-- from PUBLIC, so revoking from anon alone does nothing. That mistake has been
-- made five times in this project.

-- ---------------------------------------------------------------------------
-- Settings. All of it is policy the business may change, so none of it lives in
-- the apps (NOVA §61).
-- ---------------------------------------------------------------------------
alter table public.platform_settings
  add column if not exists wait_grace_seconds integer not null default 300
    check (wait_grace_seconds >= 0),
  add column if not exists wait_charge_per_minute_rwf integer not null default 50
    check (wait_charge_per_minute_rwf >= 0),
  add column if not exists require_ride_pin boolean not null default true,
  add column if not exists max_pin_attempts integer not null default 5
    check (max_pin_attempts > 0);

-- ---------------------------------------------------------------------------
-- No-show is a terminal state, reached only by the rider, only from `arrived`.
-- ---------------------------------------------------------------------------
insert into public.trip_transition_rules (from_state, to_state, actor)
values ('arrived', 'no_show', 'rider')
on conflict do nothing;

create or replace function public.is_terminal(p_state public.trip_state)
returns boolean language sql immutable as $$
  select p_state in (
    'completed', 'cancelled_by_passenger', 'cancelled_by_rider', 'expired',
    'no_riders', 'no_show'
  );
$$;

-- ---------------------------------------------------------------------------
-- Waiting time.
--
-- Measured from the trip's own events rather than a column the rider sets, so
-- the clock cannot be moved by the person it charges for. Only whole minutes
-- past the grace period are charged: a passenger who comes out at 5:59 of a
-- five-minute grace pays nothing, not a minute.
-- ---------------------------------------------------------------------------
create or replace function public.waiting_charge_rwf(
  p_waited_s integer, p_grace_s integer, p_per_minute_rwf integer
) returns integer language sql immutable as $$
  select case
    when p_waited_s <= p_grace_s then 0
    else ((p_waited_s - p_grace_s) / 60) * p_per_minute_rwf
  end;
$$;

create or replace function public.trip_arrived_at_internal(p_trip_id uuid)
returns timestamptz language sql stable security definer set search_path = public as $$
  -- The latest arrival: a trip re-dispatched after its first rider vanished
  -- arrives again, and it is the second rider's wait that counts.
  select max(created_at) from public.trip_events
   where trip_id = p_trip_id and to_state = 'arrived';
$$;

create or replace function public.trip_waited_seconds_internal(p_trip_id uuid)
returns integer language sql stable security definer set search_path = public as $$
  with a as (select public.trip_arrived_at_internal(p_trip_id) as at),
       s as (
         select min(e.created_at) as at
           from public.trip_events e, a
          where e.trip_id = p_trip_id and e.to_state = 'in_progress'
            and e.created_at >= a.at
       )
  select case
    when a.at is null then 0
    else greatest(0, floor(extract(epoch from (coalesce(s.at, now()) - a.at)))::integer)
  end
  from a, s;
$$;

create or replace function public.trip_waiting_charge_internal(p_trip_id uuid)
returns integer language sql stable security definer set search_path = public as $$
  select public.waiting_charge_rwf(
    public.trip_waited_seconds_internal(p_trip_id),
    ps.wait_grace_seconds,
    ps.wait_charge_per_minute_rwf
  ) from public.platform_settings ps;
$$;

-- What both apps draw the waiting clock from. The apps count down locally from
-- `arrived_at`; this is what they re-sync against, and what the charge is.
create or replace function public.trip_wait_status(p_trip_id uuid)
returns table (
  arrived_at timestamptz,
  grace_seconds integer,
  per_minute_rwf integer,
  waited_seconds integer,
  charge_rwf integer
) language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.trips t
     where t.id = p_trip_id
       and (t.passenger_id = auth.uid() or t.rider_id = auth.uid())
  ) then
    raise exception 'not_a_participant' using errcode = '42501';
  end if;

  return query
  select public.trip_arrived_at_internal(p_trip_id),
         ps.wait_grace_seconds,
         ps.wait_charge_per_minute_rwf,
         public.trip_waited_seconds_internal(p_trip_id),
         public.trip_waiting_charge_internal(p_trip_id)
    from public.platform_settings ps;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ride PIN.
--
-- In its own table rather than a column on trips, because the rider can read
-- every column of their trip row - a PIN on it would be a PIN the rider reads
-- instead of asking for. Here nobody reads it but the passenger, through a
-- function.
-- ---------------------------------------------------------------------------
create table if not exists public.trip_pins (
  trip_id         uuid primary key references public.trips(id) on delete cascade,
  pin             text not null check (pin ~ '^[0-9]{4}$'),
  failed_attempts integer not null default 0,
  verified_at     timestamptz,
  created_at      timestamptz not null default now()
);

alter table public.trip_pins enable row level security;
revoke all on public.trip_pins from public, anon, authenticated;

-- Cryptographic randomness: random() is predictable, and four digits is already
-- a small space.
create or replace function public.new_ride_pin()
returns text language sql volatile set search_path = public, extensions as $$
  select lpad(
    (('x' || encode(extensions.gen_random_bytes(2), 'hex'))::bit(16)::integer % 10000)::text,
    4, '0');
$$;

create or replace function public.trips_issue_pin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.trip_pins (trip_id, pin) values (new.id, public.new_ride_pin())
  on conflict (trip_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trips_issue_pin on public.trips;
create trigger trips_issue_pin after insert on public.trips
  for each row execute function public.trips_issue_pin();

-- Trips already running when this lands get a PIN too - but already-started
-- ones are marked verified, so nothing live is stranded mid-trip.
insert into public.trip_pins (trip_id, pin, verified_at)
select t.id, public.new_ride_pin(),
       case when t.state in ('in_progress') then now() end
  from public.trips t
 where not public.is_terminal(t.state)
on conflict (trip_id) do nothing;

-- The passenger's view of their PIN. Only once a rider is assigned - before that
-- there is nobody to give it to - and only until the trip ends.
create or replace function public.trip_ride_pin(p_trip_id uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  v_trip public.trips;
begin
  select * into v_trip from public.trips where id = p_trip_id;
  if not found or v_trip.passenger_id is distinct from auth.uid() then
    raise exception 'not_your_trip' using errcode = '42501';
  end if;
  if v_trip.state not in ('accepted', 'arrived', 'in_progress') then
    return null;
  end if;
  return (select pin from public.trip_pins where trip_id = p_trip_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- trip_transition, now refusing to start a trip whose PIN was never checked.
--
-- The guard lives here, in the one function every state change goes through,
-- rather than only in start_trip: otherwise a rider could skip the PIN by
-- calling trip_transition(..., 'in_progress') directly, which they are allowed
-- to call for every other step.
-- ---------------------------------------------------------------------------
create or replace function public.trip_transition(
  p_trip_id uuid, p_to public.trip_state, p_idempotency_key text,
  p_meta jsonb default '{}'::jsonb
) returns public.trips
language plpgsql security definer set search_path = public as $$
declare
  v_trip  public.trips;
  v_actor public.trip_actor;
begin
  select * into v_trip from public.trips where id = p_trip_id for update;
  if not found then
    raise exception 'trip_not_found' using errcode = 'P0002';
  end if;

  if v_trip.passenger_id = auth.uid() then
    v_actor := 'passenger';
  elsif v_trip.rider_id = auth.uid() then
    v_actor := 'rider';
  else
    raise exception 'not_a_participant' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.trip_events
     where trip_id = p_trip_id and idempotency_key = p_idempotency_key
  ) then
    return v_trip;
  end if;

  if not public.is_legal_transition(v_trip.state, p_to, v_actor) then
    raise exception 'illegal_transition: % -> % by %', v_trip.state, p_to, v_actor
      using errcode = '23514';
  end if;

  if p_to = 'in_progress'
     and (select require_ride_pin from public.platform_settings)
     and exists (
       select 1 from public.trip_pins
        where trip_id = p_trip_id and verified_at is null
     ) then
    raise exception 'ride_pin_required' using errcode = '42501';
  end if;

  insert into public.trip_events
    (trip_id, from_state, to_state, actor, actor_id, idempotency_key, meta)
  values
    (p_trip_id, v_trip.state, p_to, v_actor, auth.uid(), p_idempotency_key, p_meta);

  perform set_config('gera.in_transition', '1', true);

  update public.trips
     set state = p_to, updated_at = now()
   where id = p_trip_id
  returning * into v_trip;

  perform set_config('gera.in_transition', '0', true);

  return v_trip;
end;
$$;

-- Starts the trip if the PIN matches. Returns a verdict instead of raising on a
-- wrong PIN, and that is load-bearing: an exception rolls back the transaction,
-- including the failed-attempt counter, so a raising version could be guessed
-- at forever.
create or replace function public.start_trip(
  p_trip_id uuid, p_pin text, p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_trip     public.trips;
  v_pin      public.trip_pins;
  v_max      integer;
  v_required boolean;
begin
  select * into v_trip from public.trips where id = p_trip_id for update;
  if not found or v_trip.rider_id is distinct from auth.uid() then
    raise exception 'not_your_trip' using errcode = '42501';
  end if;

  if v_trip.state = 'in_progress' then
    return jsonb_build_object('started', true);
  end if;
  if v_trip.state <> 'arrived' then
    raise exception 'not_at_pickup' using errcode = '23514';
  end if;

  select require_ride_pin, max_pin_attempts into v_required, v_max
    from public.platform_settings;

  select * into v_pin from public.trip_pins where trip_id = p_trip_id for update;

  if v_required and found and v_pin.verified_at is null then
    if v_pin.failed_attempts >= v_max then
      return jsonb_build_object('started', false, 'reason', 'locked', 'attempts_left', 0);
    end if;

    if p_pin is distinct from v_pin.pin then
      update public.trip_pins set failed_attempts = failed_attempts + 1
       where trip_id = p_trip_id;
      return jsonb_build_object(
        'started', false,
        'reason', 'wrong_pin',
        'attempts_left', v_max - v_pin.failed_attempts - 1);
    end if;

    update public.trip_pins set verified_at = now() where trip_id = p_trip_id;
  end if;

  perform public.trip_transition(
    p_trip_id, 'in_progress', p_idempotency_key,
    jsonb_build_object('pin_verified', true));

  return jsonb_build_object('started', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Completion now includes the waiting charge, as its own component of the
-- total. The commission is taken from the whole total: waiting is the rider's
-- time on the company's vehicle, the same as driving.
-- ---------------------------------------------------------------------------
create or replace function public.complete_trip(
  p_trip_id uuid, p_actual_distance_m integer, p_idempotency_key text
) returns public.trips
language plpgsql security definer set search_path = public as $$
declare
  v_trip    public.trips;
  v_policy  record;
  v_fare    integer;
  v_wait    integer;
  v_total   integer;
  v_earning integer;
begin
  select * into v_trip from public.trips where id = p_trip_id for update;
  if not found then
    raise exception 'trip_not_found' using errcode = 'P0002';
  end if;

  if v_trip.rider_id is distinct from auth.uid() then
    raise exception 'not_your_trip' using errcode = '42501';
  end if;

  -- Idempotent: a replayed completion must not write the money twice.
  if v_trip.state = 'completed' then
    return v_trip;
  end if;

  if v_trip.quoted_amount_rwf is null or v_trip.quote_id is null then
    raise exception 'trip_has_no_quote' using errcode = '22023';
  end if;

  -- Priced under the policy the trip was QUOTED under, never the one in force
  -- now: a rate change between quote and completion must not reach this trip.
  select * into v_policy from public.fare_policy_for_quote(v_trip.quote_id);
  if v_policy.id is null then
    raise exception 'quote_policy_not_found' using errcode = '22023';
  end if;

  v_fare := public.final_fare_rwf(
    v_trip.quoted_amount_rwf,
    coalesce(v_trip.quoted_distance_m, 0),
    p_actual_distance_m,
    v_policy.per_km_rwf
  );
  v_wait := public.trip_waiting_charge_internal(p_trip_id);
  v_total := v_fare + v_wait;

  v_earning := public.rider_earning_rwf(v_total, v_policy.commission_pct);

  perform set_config('gera.in_transition', '1', true);
  update public.trips
     set actual_distance_m = p_actual_distance_m
   where id = p_trip_id;
  perform set_config('gera.in_transition', '0', true);

  v_trip := public.trip_transition(
    p_trip_id, 'completed', p_idempotency_key,
    jsonb_build_object(
      'total_rwf', v_total,
      'fare_rwf', v_fare,
      'waiting_charge_rwf', v_wait,
      'rider_earning_rwf', v_earning,
      'policy_id', v_policy.id
    )
  );

  -- Two rows, not one, and this is the point of the whole model. The rider now
  -- holds v_total of the company's cash AND is owed v_earning of it. Netting
  -- them into a single entry would hide the exposure, which is the number that
  -- decides whether they work tomorrow.
  insert into public.ledger_entries (rider_id, trip_id, kind, amount_rwf, memo)
  values
    (v_trip.rider_id, p_trip_id, 'fare_collected', v_total,
     'cash taken on trip ' || p_trip_id),
    (v_trip.rider_id, p_trip_id, 'trip_earning', v_earning,
     'earning on trip ' || p_trip_id);

  return v_trip;
end;
$$;

-- The final amount a passenger pays, for any screen that shows a finished trip.
-- Read from the completion event, which is the only place the total is written.
create or replace function public.trip_total_rwf(p_trip_id uuid)
returns table (total_rwf integer, fare_rwf integer, waiting_charge_rwf integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.trips t
     where t.id = p_trip_id
       and (t.passenger_id = auth.uid() or t.rider_id = auth.uid())
  ) then
    raise exception 'not_a_participant' using errcode = '42501';
  end if;

  return query
  select (e.meta->>'total_rwf')::integer,
         coalesce((e.meta->>'fare_rwf')::integer, (e.meta->>'total_rwf')::integer),
         coalesce((e.meta->>'waiting_charge_rwf')::integer, 0)
    from public.trip_events e
   where e.trip_id = p_trip_id and e.to_state = 'completed'
   order by e.created_at desc
   limit 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- No-show.
-- ---------------------------------------------------------------------------
create table if not exists public.no_show_reports (
  id             uuid primary key default gen_random_uuid(),
  trip_id        uuid not null unique references public.trips(id),
  rider_id       uuid not null references public.riders(id),
  passenger_id   uuid not null references public.profiles(id),
  reported_at    timestamptz not null default now(),
  position       geography(Point, 4326),
  reason         text not null check (length(trim(reason)) > 0),
  waited_seconds integer not null
);

alter table public.no_show_reports enable row level security;
revoke all on public.no_show_reports from public, anon, authenticated;
grant select on public.no_show_reports to authenticated;

drop policy if exists no_show_reports_participant on public.no_show_reports;
create policy no_show_reports_participant on public.no_show_reports
  for select using (rider_id = auth.uid() or passenger_id = auth.uid());

-- Only after the grace period. Before it, the passenger is still inside the
-- time they were promised, and a no-show there is a rider who did not wait.
create or replace function public.report_no_show(
  p_trip_id uuid, p_reason text, p_lng double precision, p_lat double precision,
  p_idempotency_key text
) returns public.trips
language plpgsql security definer set search_path = public as $$
declare
  v_trip   public.trips;
  v_waited integer;
  v_grace  integer;
begin
  select * into v_trip from public.trips where id = p_trip_id for update;
  if not found or v_trip.rider_id is distinct from auth.uid() then
    raise exception 'not_your_trip' using errcode = '42501';
  end if;

  if v_trip.state = 'no_show' then
    return v_trip;
  end if;
  if v_trip.state <> 'arrived' then
    raise exception 'not_at_pickup' using errcode = '23514';
  end if;

  v_waited := public.trip_waited_seconds_internal(p_trip_id);
  select wait_grace_seconds into v_grace from public.platform_settings;
  if v_waited < v_grace then
    raise exception 'grace_not_elapsed: % seconds left', v_grace - v_waited
      using errcode = '23514';
  end if;

  insert into public.no_show_reports
    (trip_id, rider_id, passenger_id, position, reason, waited_seconds)
  values
    (p_trip_id, v_trip.rider_id, v_trip.passenger_id,
     case when p_lng is not null and p_lat is not null
          then st_point(p_lng, p_lat)::geography end,
     coalesce(nullif(trim(p_reason), ''), 'Passenger could not be found'),
     v_waited);

  return public.trip_transition(
    p_trip_id, 'no_show', p_idempotency_key,
    jsonb_build_object('waited_seconds', v_waited));
end;
$$;

-- ---------------------------------------------------------------------------
-- Shifts.
-- ---------------------------------------------------------------------------
create table if not exists public.shifts (
  id                uuid primary key default gen_random_uuid(),
  rider_id          uuid not null references public.riders(id),
  vehicle_id        uuid not null references public.vehicles(id),
  started_at        timestamptz not null default now(),
  start_position    geography(Point, 4326),
  safety_checks     jsonb not null,
  ended_at          timestamptz,
  end_position      geography(Point, 4326),
  vehicle_condition text check (vehicle_condition in ('good', 'minor_issue', 'needs_repair')),
  end_notes         text,
  -- A shift is either open with no condition report, or closed with one.
  constraint shifts_closed_has_condition
    check ((ended_at is null) = (vehicle_condition is null))
);

create unique index if not exists shifts_one_open_per_rider
  on public.shifts (rider_id) where ended_at is null;

alter table public.shifts enable row level security;
revoke all on public.shifts from public, anon, authenticated;
grant select on public.shifts to authenticated;

drop policy if exists shifts_select_own on public.shifts;
create policy shifts_select_own on public.shifts
  for select using (rider_id = auth.uid());

-- The checks a rider confirms before a shift. Mirrored in packages/core, with a
-- parity test, because the app draws the checklist and the database enforces it.
create or replace function public.shift_check_keys()
returns text[] language sql immutable as $$
  select array['helmets', 'lights', 'brakes', 'tyres', 'fuel', 'phone'];
$$;

create or replace function public.has_open_shift_internal(p_rider_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.shifts where rider_id = p_rider_id and ended_at is null
  );
$$;

create or replace function public.start_shift(
  p_checks jsonb, p_lng double precision, p_lat double precision
) returns public.shifts
language plpgsql security definer set search_path = public as $$
declare
  v_shift   public.shifts;
  v_vehicle uuid;
  v_failed  text[];
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.riders where id = auth.uid() and verification = 'verified'
  ) then
    raise exception 'not_verified' using errcode = '42501';
  end if;

  -- Idempotent: a second tap, or a retry after a dropped response, gets the
  -- shift that is already open rather than an error.
  select * into v_shift from public.shifts
   where rider_id = auth.uid() and ended_at is null;
  if found then
    return v_shift;
  end if;

  select id into v_vehicle from public.vehicles
   where rider_id = auth.uid() and is_active
   order by created_at desc limit 1;
  if v_vehicle is null then
    raise exception 'no_vehicle' using errcode = '23514';
  end if;

  select array_agg(k) into v_failed
    from unnest(public.shift_check_keys()) as k
   where coalesce((p_checks ->> k)::boolean, false) is not true;
  if v_failed is not null then
    raise exception 'safety_check_failed: %', array_to_string(v_failed, ',')
      using errcode = '23514';
  end if;

  insert into public.shifts (rider_id, vehicle_id, start_position, safety_checks)
  values (
    auth.uid(), v_vehicle,
    case when p_lng is not null and p_lat is not null
         then st_point(p_lng, p_lat)::geography end,
    p_checks)
  returning * into v_shift;

  return v_shift;
end;
$$;

-- Closes the shift and says what happened in it. A rider on a live trip cannot
-- end their shift: the passenger on the back does not stop existing.
create or replace function public.end_shift(
  p_condition text, p_notes text, p_lng double precision, p_lat double precision
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_shift public.shifts;
  v_trips integer;
  v_collected integer;
  v_earned integer;
begin
  select * into v_shift from public.shifts
   where rider_id = auth.uid() and ended_at is null
   for update;
  if not found then
    raise exception 'no_open_shift' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.trips
     where rider_id = auth.uid() and state in ('accepted', 'arrived', 'in_progress')
  ) then
    raise exception 'trip_in_progress' using errcode = '23514';
  end if;

  if p_condition not in ('good', 'minor_issue', 'needs_repair') then
    raise exception 'bad_condition' using errcode = '22023';
  end if;

  update public.rider_presence
     set status = 'offline', updated_at = now()
   where rider_id = auth.uid();

  update public.shifts
     set ended_at = now(),
         end_position = case when p_lng is not null and p_lat is not null
                             then st_point(p_lng, p_lat)::geography end,
         vehicle_condition = p_condition,
         end_notes = nullif(trim(p_notes), '')
   where id = v_shift.id
  returning * into v_shift;

  -- A vehicle that needs repair is a report the fleet has to see, not a note
  -- in a shift row nobody reads.
  if p_condition = 'needs_repair' then
    insert into public.rider_reports (rider_id, shift_id, kind, note)
    values (auth.uid(), v_shift.id, 'vehicle_problem',
            coalesce(nullif(trim(p_notes), ''), 'Marked as needing repair at end of shift'));
  end if;

  select count(*)::integer into v_trips
    from public.trip_events e join public.trips t on t.id = e.trip_id
   where t.rider_id = auth.uid() and e.to_state = 'completed'
     and e.created_at between v_shift.started_at and v_shift.ended_at;

  select coalesce(sum(amount_rwf) filter (where kind = 'fare_collected'), 0)::integer,
         coalesce(sum(amount_rwf) filter (where kind = 'trip_earning'), 0)::integer
    into v_collected, v_earned
    from public.ledger_entries
   where rider_id = auth.uid()
     and created_at between v_shift.started_at and v_shift.ended_at;

  return jsonb_build_object(
    'shift_id', v_shift.id,
    'started_at', v_shift.started_at,
    'ended_at', v_shift.ended_at,
    'trips', v_trips,
    'collected_rwf', v_collected,
    'earned_rwf', v_earned,
    'cash_held_rwf', public.rider_cash_held_internal(auth.uid()));
end;
$$;

-- The go-online gate, now three conditions: a vehicle, a clean cash position,
-- and an open shift. The shift is what makes safety checks mandatory rather
-- than a screen a rider can skip.
create or replace function public.can_go_online_internal(p_rider_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    exists (select 1 from public.vehicles v where v.rider_id = p_rider_id and v.is_active)
    and public.has_open_shift_internal(p_rider_id)
    and public.rider_cash_held_internal(p_rider_id)
        <= (select max_cash_held_rwf from public.platform_settings);
$$;

-- ---------------------------------------------------------------------------
-- Reports (NOVA §25, §29).
-- ---------------------------------------------------------------------------
create table if not exists public.rider_reports (
  id          uuid primary key default gen_random_uuid(),
  rider_id    uuid not null references public.riders(id),
  shift_id    uuid references public.shifts(id),
  trip_id     uuid references public.trips(id),
  kind        text not null
              check (kind in ('vehicle_problem', 'safety_issue', 'accident', 'incident')),
  note        text not null check (length(trim(note)) > 0),
  position    geography(Point, 4326),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);

alter table public.rider_reports enable row level security;
revoke all on public.rider_reports from public, anon, authenticated;
grant select on public.rider_reports to authenticated;

drop policy if exists rider_reports_select_own on public.rider_reports;
create policy rider_reports_select_own on public.rider_reports
  for select using (rider_id = auth.uid());

create or replace function public.report_issue(
  p_kind text, p_note text, p_trip_id uuid,
  p_lng double precision, p_lat double precision
) returns public.rider_reports
language plpgsql security definer set search_path = public as $$
declare
  v_report public.rider_reports;
begin
  if not exists (select 1 from public.riders where id = auth.uid()) then
    raise exception 'not_a_rider' using errcode = '42501';
  end if;

  if p_trip_id is not null and not exists (
    select 1 from public.trips where id = p_trip_id and rider_id = auth.uid()
  ) then
    raise exception 'not_your_trip' using errcode = '42501';
  end if;

  insert into public.rider_reports (rider_id, shift_id, trip_id, kind, note, position)
  values (
    auth.uid(),
    (select id from public.shifts where rider_id = auth.uid() and ended_at is null),
    p_trip_id, p_kind, p_note,
    case when p_lng is not null and p_lat is not null
         then st_point(p_lng, p_lat)::geography end)
  returning * into v_report;

  return v_report;
end;
$$;

-- ---------------------------------------------------------------------------
-- Push: say what the passenger actually owes, and tell them about the clock.
-- ---------------------------------------------------------------------------
create or replace function public.push_on_trip_state()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_total integer;
  v_grace integer;
begin
  if new.state = old.state then return new; end if;

  if new.state = 'accepted' then
    perform public.notify_user(new.passenger_id, 'Rider on the way',
      'Your rider is coming to ' || coalesce(new.pickup_label, 'the pickup') || '.',
      jsonb_build_object('kind', 'trip', 'tripId', new.id, 'state', new.state));

  elsif new.state = 'arrived' then
    select wait_grace_seconds into v_grace from public.platform_settings;
    perform public.notify_user(new.passenger_id, 'Your rider is here',
      'They will wait ' || (v_grace / 60) || ' minutes free of charge.',
      jsonb_build_object('kind', 'trip', 'tripId', new.id, 'state', new.state));

  elsif new.state = 'completed' then
    -- The completion event is written before this update, so the real total -
    -- fare, any extra distance and any waiting - is already on it. The quote
    -- alone was wrong whenever either applied.
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
-- Grants. PUBLIC first, every time.
-- ---------------------------------------------------------------------------
revoke execute on function
  public.waiting_charge_rwf(integer, integer, integer),
  public.trip_arrived_at_internal(uuid),
  public.trip_waited_seconds_internal(uuid),
  public.trip_waiting_charge_internal(uuid),
  public.trip_wait_status(uuid),
  public.new_ride_pin(),
  public.trips_issue_pin(),
  public.trip_ride_pin(uuid),
  public.trip_transition(uuid, public.trip_state, text, jsonb),
  public.start_trip(uuid, text, text),
  public.complete_trip(uuid, integer, text),
  public.trip_total_rwf(uuid),
  public.report_no_show(uuid, text, double precision, double precision, text),
  public.shift_check_keys(),
  public.has_open_shift_internal(uuid),
  public.start_shift(jsonb, double precision, double precision),
  public.end_shift(text, text, double precision, double precision),
  public.can_go_online_internal(uuid),
  public.report_issue(text, text, uuid, double precision, double precision),
  public.push_on_trip_state(),
  public.is_terminal(public.trip_state)
from public, anon, authenticated;

grant execute on function
  public.waiting_charge_rwf(integer, integer, integer),
  public.trip_wait_status(uuid),
  public.trip_ride_pin(uuid),
  public.trip_transition(uuid, public.trip_state, text, jsonb),
  public.start_trip(uuid, text, text),
  public.complete_trip(uuid, integer, text),
  public.trip_total_rwf(uuid),
  public.report_no_show(uuid, text, double precision, double precision, text),
  public.shift_check_keys(),
  public.start_shift(jsonb, double precision, double precision),
  public.end_shift(text, text, double precision, double precision),
  public.report_issue(text, text, uuid, double precision, double precision),
  public.is_terminal(public.trip_state)
to authenticated;
