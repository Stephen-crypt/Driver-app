-- Mirror of TRANSITIONS in packages/core/src/trip/transitions.ts.
-- Kept honest by packages/core/test/trip/parity.test.ts.
create table public.trip_transition_rules (
  from_state trip_state not null,
  to_state   trip_state not null,
  actor      trip_actor not null,
  primary key (from_state, to_state, actor)
);

insert into public.trip_transition_rules (from_state, to_state, actor) values
  ('requested',   'offered',            'system'),
  ('requested',   'no_drivers',         'system'),
  ('requested',   'cancelled_by_rider', 'rider'),
  ('offered',     'offered',            'system'),
  ('offered',     'accepted',           'driver'),
  ('offered',     'expired',            'system'),
  ('offered',     'no_drivers',         'system'),
  ('offered',     'cancelled_by_rider', 'rider'),
  ('accepted',    'arrived',            'driver'),
  ('accepted',    'cancelled_by_rider', 'rider'),
  ('accepted',    'cancelled_by_driver','driver'),
  ('accepted',    'offered',            'system'),
  ('arrived',     'in_progress',        'driver'),
  ('arrived',     'cancelled_by_rider', 'rider'),
  ('arrived',     'cancelled_by_driver','driver'),
  ('in_progress', 'completed',          'driver');

create or replace function public.is_terminal(p_state trip_state)
returns boolean
language sql
immutable
as $$
  select p_state in (
    'completed', 'cancelled_by_rider', 'cancelled_by_driver', 'expired', 'no_drivers'
  );
$$;

create or replace function public.is_legal_transition(
  p_from  trip_state,
  p_to    trip_state,
  p_actor trip_actor
) returns boolean
language sql
stable
as $$
  select not public.is_terminal(p_from)
     and exists (
       select 1 from public.trip_transition_rules r
        where r.from_state = p_from
          and r.to_state   = p_to
          and r.actor      = p_actor
     );
$$;

-- The only sanctioned way to change a trip's state.
create or replace function public.trip_transition(
  p_trip_id         uuid,
  p_to              trip_state,
  p_idempotency_key text,
  p_meta            jsonb default '{}'::jsonb
) returns public.trips
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip  public.trips;
  v_actor trip_actor;
begin
  -- Lock first: the lock is what makes the idempotency check below race-safe.
  -- Checking before the lock lets two concurrent callers with the same key both
  -- pass, and the loser then collides with the unique constraint instead of
  -- returning a no-op.
  select * into v_trip from public.trips where id = p_trip_id for update;
  if not found then
    raise exception 'trip_not_found' using errcode = 'P0002';
  end if;

  -- Idempotent replay: a key already recorded for this trip is a no-op.
  if exists (
    select 1 from public.trip_events
     where trip_id = p_trip_id and idempotency_key = p_idempotency_key
  ) then
    return v_trip;
  end if;

  if v_trip.rider_id = auth.uid() then
    v_actor := 'rider';
  elsif v_trip.driver_id = auth.uid() then
    v_actor := 'driver';
  else
    raise exception 'not_a_participant' using errcode = '42501';
  end if;

  if not public.is_legal_transition(v_trip.state, p_to, v_actor) then
    raise exception 'illegal_transition: % -> % by %', v_trip.state, p_to, v_actor
      using errcode = '23514';
  end if;

  insert into public.trip_events
    (trip_id, from_state, to_state, actor, actor_id, idempotency_key, meta)
  values
    (p_trip_id, v_trip.state, p_to, v_actor, auth.uid(), p_idempotency_key, p_meta);

  update public.trips
     set state = p_to, updated_at = now()
   where id = p_trip_id
  returning * into v_trip;

  return v_trip;
end;
$$;

revoke all on function public.trip_transition(uuid, trip_state, text, jsonb) from public;
grant execute on function public.trip_transition(uuid, trip_state, text, jsonb) to authenticated;

revoke all on function public.is_terminal(trip_state) from public;
revoke all on function public.is_legal_transition(trip_state, trip_state, trip_actor) from public;
grant execute on function public.is_terminal(trip_state) to authenticated;
grant execute on function public.is_legal_transition(trip_state, trip_state, trip_actor) to authenticated;
