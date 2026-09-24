-- Two gaps in the state machine, closed together because the fix for the second
-- has to be threaded through the first.
--
-- 1. trip_transition() resolves its actor from auth.uid(), so it can only ever
--    act as 'rider' or 'driver'. Four edges in the rule table belong to
--    'system' - requested->offered, offered->expired, offered->no_drivers and
--    accepted->offered - and those are precisely the dispatch edges. Phase 2's
--    dispatcher had no sanctioned path to any of them, which would have pushed
--    it into writing trips.state directly on day one.
--
-- 2. Nothing bound trips.state to trip_events. The spec calls state a
--    projection and the event log the source of truth, but that was convention,
--    not structure: RLS denies clients an UPDATE on trips, yet service_role
--    bypasses RLS entirely and both the dispatcher and the ops console run as
--    service_role. One stray `update trips set state = ...` and the invariant
--    would have stopped holding with no test noticing.

-- The system actor's entry point. Deliberately a SEPARATE FUNCTION rather than
-- an actor parameter on trip_transition(): a parameter is a branch a caller can
-- steer, and the one thing that must never be caller-controlled is which actor
-- the event log records. There is no branch here to steer - v_actor is a
-- constant - so the only lever left is who may execute the function at all,
-- which is an access-control question the grants at the bottom answer.
create or replace function public.trip_transition_system(
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
  v_actor trip_actor := 'system';
begin
  -- Lock first, exactly as in trip_transition(): the lock is what makes the
  -- idempotency check below race-safe. Checking before the lock lets two
  -- concurrent callers with the same key both pass, and the loser then collides
  -- with the unique constraint instead of returning a no-op. Dispatch retries
  -- are the likeliest source of that race, so this matters more here, not less.
  select * into v_trip from public.trips where id = p_trip_id for update;
  if not found then
    raise exception 'trip_not_found' using errcode = 'P0002';
  end if;

  -- No actor guard, because there is no actor to resolve: reaching this
  -- function at all IS the authorisation. Unlike trip_transition(), the
  -- idempotent replay may therefore return early without leaking anything -
  -- every caller who can execute this already holds service_role.
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

  -- actor_id is null by design: 'system' is not a person, and trip_events.actor_id
  -- references profiles. A dispatcher run id belongs in p_meta, not here.
  insert into public.trip_events
    (trip_id, from_state, to_state, actor, actor_id, idempotency_key, meta)
  values
    (p_trip_id, v_trip.state, p_to, v_actor, null, p_idempotency_key, p_meta);

  -- Unlock the projection for exactly one statement (see trips_guard_state
  -- below), then lock it again. The re-lock is not decoration: set_config's
  -- third argument scopes the value to the TRANSACTION, not the statement, so
  -- leaving it set would silently exempt every later update to trips in the
  -- same transaction - including ones this function knows nothing about.
  perform set_config('gera.in_transition', '1', true);

  update public.trips
     set state = p_to, updated_at = now()
   where id = p_trip_id
  returning * into v_trip;

  perform set_config('gera.in_transition', '0', true);

  return v_trip;
end;
$$;

-- Redefined from 0006 solely to add the two set_config calls around its update.
-- The body is otherwise unchanged; see 0006 for the reasoning on lock ordering
-- and on why the actor guard runs before the idempotent early return.
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
  select * into v_trip from public.trips where id = p_trip_id for update;
  if not found then
    raise exception 'trip_not_found' using errcode = 'P0002';
  end if;

  if v_trip.rider_id = auth.uid() then
    v_actor := 'rider';
  elsif v_trip.driver_id = auth.uid() then
    v_actor := 'driver';
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

-- The structural half of the fix. RLS already denies clients an UPDATE on
-- trips, but RLS is not the boundary that matters here: service_role bypasses
-- it, and service_role is what the dispatcher and the ops console run as. This
-- trigger is a table-level rule that holds for superusers too, so the only way
-- trips.state moves is through a function that journalled the move first.
--
-- current_setting(..., true) takes the missing_ok argument: unset, it returns
-- null rather than raising, which is the normal state of the world.
create or replace function public.trips_guard_state()
returns trigger
language plpgsql
as $$
begin
  if new.state is distinct from old.state
     and coalesce(current_setting('gera.in_transition', true), '') <> '1' then
    raise exception
      'trips.state may only be changed through trip_transition() or trip_transition_system()'
      using errcode = '42501';
  end if;

  -- Only a STATE change is gated. Everything else about a trip - the actual
  -- distance written at completion, a corrected label - stays an ordinary
  -- update, and gets its updated_at maintained here rather than relying on
  -- every caller to remember it, which is why it went stale before.
  new.updated_at := now();
  return new;
end;
$$;

create trigger trips_guard_state_trg
  before update on public.trips
  for each row
  execute function public.trips_guard_state();

-- `authenticated` is revoked here, unlike every other function in this schema.
-- trip_transition() is granted to authenticated because a rider cancelling or a
-- driver arriving IS an end-user action; no system edge ever is. `anon` is
-- named explicitly because Supabase grants execute on new public functions to
-- anon and authenticated through ALTER DEFAULT PRIVILEGES, which `from public`
-- does not touch.
revoke all on function public.trip_transition_system(uuid, trip_state, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.trip_transition_system(uuid, trip_state, text, jsonb)
  to service_role;

-- The guard is reachable only as a trigger; PostgreSQL checks EXECUTE on a
-- trigger function at CREATE TRIGGER time, not at fire time, so revoking it
-- from everyone afterwards costs nothing and removes a direct-call target.
revoke all on function public.trips_guard_state() from public, anon, authenticated;
