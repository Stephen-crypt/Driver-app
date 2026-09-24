-- Phase 2a final review, fix wave. Two Criticals let the money diverge from the
-- price the rider was quoted: a rider could insert their own trip - and so their
-- own price - straight into public.trips, and the trip's own driver could hand
-- complete_trip whatever total and commission they liked.
--
-- This migration reverses the constraint Phase 2a was built on ("all fare and
-- commission arithmetic is authored once, in packages/core, and never
-- duplicated in SQL"). complete_trip is granted to `authenticated`, so
-- PostgREST is a public entry point and the Edge Function is NOT a trust
-- boundary: packages/core is where the arithmetic is authored, but it was never
-- where the arithmetic was decided, and for money only the deciding location
-- counts. A rule the database must enforce has to live in the database.
--
-- The achievable property is not "exists once" - it is "duplicated with a guard
-- that makes drift impossible". That is exactly the shape trip_transition_rules
-- already has against packages/core/src/trip/transitions.ts. Here the guard is
-- packages/core/test/fare/sql-parity.test.ts, which runs both copies over the
-- same table of cases.

-- ---------------------------------------------------------------------------
-- 1. A rider can no longer author their own fare (C1).
-- ---------------------------------------------------------------------------
-- trips_insert_rider (0007) constrained rider_id, state and driver_id. Task 7
-- added quote_id and quoted_amount_rwf to the same table and never revisited
-- the policy, so a rider JWT could insert a trip with quoted_amount_rwf = 100
-- and quote_id = null, bypassing create_trip_from_quote entirely; completion
-- then read that number as the locked price.
--
-- Removing the INSERT privilege is stronger than narrowing the policy: it takes
-- the path away instead of trying to enumerate everything that must not be
-- written through it. create_trip_from_quote is security definer and owned by
-- the migration role, so it keeps working untouched.
revoke insert on public.trips from anon, authenticated;

-- A policy nothing can reach is a lie about how the table is protected: it reads
-- as though direct inserts are allowed-but-constrained, when they are gone.
drop policy if exists trips_insert_rider on public.trips;

-- One quote prices exactly one trip. Without this a rider can spend the same
-- quote N times inside its 120s TTL - N trips at one price, and the price lock
-- stops being a lock. Partial, because trips created before quote_id existed
-- (and any future system-created trip) carry null.
create unique index trips_quote_id_uniq
  on public.trips (quote_id) where quote_id is not null;

-- ---------------------------------------------------------------------------
-- 2. The money is derived in SQL (C2).
-- ---------------------------------------------------------------------------
-- Each function below mirrors one TypeScript function. The comment names its
-- counterpart; packages/core/test/fare/sql-parity.test.ts runs both over the
-- same cases and fails on any divergence.

-- Mirrors roundFareRwf() in packages/core/src/fare/policy.ts.
-- Kept honest by the parity test in packages/core/test/fare/sql-parity.test.ts.
create or replace function public.round_fare_rwf(p_amount numeric)
returns integer
language sql
immutable
as $$
  select (ceil(p_amount / 100.0) * 100)::integer;
$$;

-- Mirrors finalizeFare() in packages/core/src/fare/finalize.ts (OVERAGE_TOLERANCE
-- 0.15). Kept honest by packages/core/test/fare/sql-parity.test.ts.
--
-- The arithmetic is numeric, not double precision, so `round` here is Postgres's
-- half-away-from-zero numeric rounding rather than float8's half-to-even. The
-- former is what JavaScript's Math.round does over this (non-negative) domain.
create or replace function public.final_fare_rwf(
  p_quoted_rwf        integer,
  p_quoted_distance_m integer,
  p_actual_distance_m integer,
  p_per_km_rwf        integer
) returns integer
language sql
immutable
as $$
  select p_quoted_rwf + case
           when band.overage_m = 0 then 0
           else public.round_fare_rwf(band.overage_m / 1000.0 * p_per_km_rwf)
         end
    from (
      select greatest(0, round(p_actual_distance_m - p_quoted_distance_m * 1.15))
               as overage_m
    ) band;
$$;

-- Mirrors commissionFor() in packages/core/src/ledger/commission.ts.
-- Kept honest by the parity test in packages/core/test/fare/sql-parity.test.ts.
create or replace function public.commission_rwf(
  p_fare_rwf integer,
  p_rate_pct numeric
) returns integer
language sql
immutable
as $$
  select round(p_fare_rwf * p_rate_pct / 100.0)::integer;
$$;

revoke all on function public.round_fare_rwf(numeric) from public, anon;
revoke all on function public.final_fare_rwf(integer, integer, integer, integer) from public, anon;
revoke all on function public.commission_rwf(integer, numeric) from public, anon;
grant execute on function public.round_fare_rwf(numeric) to authenticated, service_role;
grant execute on function public.final_fare_rwf(integer, integer, integer, integer)
  to authenticated, service_role;
grant execute on function public.commission_rwf(integer, numeric) to authenticated, service_role;

-- The policy a trip was QUOTED under, recovered through the quote that priced
-- it. fare_quotes.policy_id and trips.quote_id were both written and never read,
-- so completion priced against current_fare_policy() - the policy in force now.
-- An ops rate change between quote and completion silently repriced the trip,
-- against spec 3.4 ("a price change never retroactively alters historical
-- trips"). This is the lookup completion uses instead.
create or replace function public.fare_policy_for_quote(p_quote_id uuid)
returns public.fare_policies
language sql
stable
as $$
  select p.*
    from public.fare_quotes q
    join public.fare_policies p on p.id = q.policy_id
   where q.id = p_quote_id;
$$;

revoke all on function public.fare_policy_for_quote(uuid) from public, anon;
grant execute on function public.fare_policy_for_quote(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. current_fare_policy needs a deterministic winner.
-- ---------------------------------------------------------------------------
-- Redefined from 0010 solely to break the tie when two policies for one class
-- share an effective_from: the winner was undefined, so two ops edits landing in
-- the same transaction (or the same clock tick) could quote either rate. The
-- later-created row wins, which is the one the ops edit meant.
create or replace function public.current_fare_policy(p_class vehicle_class)
returns public.fare_policies
language sql
stable
as $$
  select *
    from public.fare_policies
   where vehicle_class = p_class
     and effective_from <= now()
     and (effective_to is null or effective_to > now())
   order by effective_from desc, created_at desc
   limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 4. Completion derives its own money (C2 + I1).
-- ---------------------------------------------------------------------------
-- The old signature took p_total_rwf and p_commission_rwf from the caller. It is
-- dropped, not merely superseded, so no route to it survives: complete_trip is
-- granted to `authenticated`, and the trip's own driver completed a 1,700 RWF
-- trip with a commission of 0 by calling it directly through PostgREST.
drop function if exists public.complete_trip(uuid, integer, integer, integer, text);

create or replace function public.complete_trip(
  p_trip_id           uuid,
  p_actual_distance_m integer,
  p_idempotency_key   text
) returns public.trips
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip       public.trips;
  v_policy     public.fare_policies;
  v_total      integer;
  v_commission integer;
begin
  -- Argument validation before the lock, as in 0013.
  if p_actual_distance_m is null or p_actual_distance_m < 0 then
    raise exception 'negative_distance' using errcode = '22023';
  end if;

  select * into v_trip from public.trips where id = p_trip_id for update;
  if not found then
    raise exception 'trip_not_found' using errcode = 'P0002';
  end if;

  -- Authorization BEFORE the idempotent early return. An unchecked early return
  -- on a security-definer function hands the whole trip row - rider_id, both
  -- labels, and the free-text pickup_note - to anyone who supplies a trip id and
  -- a used idempotency key. Migration 0006 guards trip_transition() the same way
  -- and for the same reason. Only the driver may complete a trip.
  if v_trip.driver_id is null or v_trip.driver_id <> auth.uid() then
    raise exception 'not_the_driver' using errcode = '42501';
  end if;

  -- Idempotent: a replayed completion must not debit commission twice.
  if exists (
    select 1 from public.trip_events
     where trip_id = p_trip_id and idempotency_key = p_idempotency_key
  ) then
    return v_trip;
  end if;

  -- The locked price is the trip's own, written at creation from the quote. A
  -- trip with no quote has no price to honour, and inventing one is how a rider
  -- gets charged a number nobody quoted them.
  if v_trip.quoted_amount_rwf is null or v_trip.quote_id is null then
    raise exception 'trip_has_no_quote' using errcode = '22023';
  end if;

  -- Priced under the policy the trip was QUOTED under, never the one in force
  -- now: a rate change between quote and completion must not reach this trip.
  select * into v_policy from public.fare_policy_for_quote(v_trip.quote_id);
  if v_policy.id is null then
    raise exception 'quote_policy_not_found' using errcode = '22023';
  end if;

  v_total := public.final_fare_rwf(
    v_trip.quoted_amount_rwf,
    coalesce(v_trip.quoted_distance_m, 0),
    p_actual_distance_m,
    v_policy.per_km_rwf
  );
  v_commission := public.commission_rwf(v_total, v_policy.commission_pct);

  perform set_config('gera.in_transition', '1', true);
  update public.trips
     set actual_distance_m = p_actual_distance_m
   where id = p_trip_id;
  perform set_config('gera.in_transition', '0', true);

  -- Raises if the edge is illegal or the caller is not the driver.
  v_trip := public.trip_transition(
    p_trip_id, 'completed', p_idempotency_key,
    jsonb_build_object(
      'total_rwf', v_total,
      'commission_rwf', v_commission,
      'policy_id', v_policy.id
    )
  );

  insert into public.ledger_entries (driver_id, trip_id, kind, amount_rwf, memo)
  values (v_trip.driver_id, p_trip_id, 'commission_debit', v_commission,
          'commission on trip ' || p_trip_id);

  return v_trip;
end;
$$;

-- No exception handler anywhere above: the state change and its commission debit
-- are one transaction or neither happens. `anon` is named explicitly because
-- Supabase grants execute on new public functions to anon through ALTER DEFAULT
-- PRIVILEGES, which `from public` does not touch.
revoke all on function public.complete_trip(uuid, integer, text) from public, anon;
grant execute on function public.complete_trip(uuid, integer, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Assigning a driver is idempotent, and says who was assigned (I4).
-- ---------------------------------------------------------------------------
-- 0012 wrote driver_id BEFORE delegating to trip_transition_system(), whose own
-- idempotency check then returned early. A replay of the same key therefore
-- reassigned the trip to a different driver and logged nothing: one event, meta
-- {}, the driver silently swapped. Phase 2b's dispatcher calls this under retry,
-- which would turn a benign retry into a stolen offer.
create or replace function public.assign_driver_to_trip(
  p_trip_id         uuid,
  p_driver_id       uuid,
  p_idempotency_key text
) returns public.trips
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip public.trips;
begin
  select * into v_trip from public.trips where id = p_trip_id for update;
  if not found then
    raise exception 'trip_not_found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.drivers
     where id = p_driver_id and verification = 'verified'
  ) then
    raise exception 'driver_not_verified' using errcode = '42501';
  end if;

  -- The replay check has to happen HERE, before the driver_id write, not inside
  -- trip_transition_system() afterwards. The lock taken above is what makes it
  -- race-safe, exactly as in trip_transition().
  if exists (
    select 1 from public.trip_events
     where trip_id = p_trip_id and idempotency_key = p_idempotency_key
  ) then
    return v_trip;
  end if;

  perform set_config('gera.in_transition', '1', true);
  update public.trips set driver_id = p_driver_id where id = p_trip_id;
  perform set_config('gera.in_transition', '0', true);

  -- The driver goes into the event meta: an offer log that does not record who
  -- was offered the trip cannot answer the one question it exists to answer.
  return public.trip_transition_system(
    p_trip_id, 'offered', p_idempotency_key,
    jsonb_build_object('driver_id', p_driver_id)
  );
end;
$$;

revoke all on function public.assign_driver_to_trip(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.assign_driver_to_trip(uuid, uuid, text) to service_role;
