-- Phase 2b final review, fix wave. Two Criticals, both confirmed live.
--
-- C1: dispatch did not terminate, and it stranded the driver.
--     expire_stale_offers() set trip_offers.outcome = 'timed_out' and nothing
--     else. trips.state stayed 'offered' and trips.driver_id stayed on the
--     driver who ignored the offer; nothing re-dispatched - not cron, not
--     decline_offer, not the sweeper. find_candidate_drivers excludes drivers
--     committed to a trip in 'offered', so that driver was excluded from all
--     future matching, permanently. requested->no_drivers, offered->expired and
--     offered->no_drivers all existed in trip_transition_rules with zero
--     callers.
--
-- C2: one driver could hold - and accept - two live offers.
--     trip_offers_one_live_per_trip is unique on trip_id ONLY, and
--     trip_offers_open_idx on (driver_id, expires_at) is not unique. The "not
--     already committed" filter in find_candidate_drivers is a snapshot read in
--     a different transaction from the insert, so two concurrent dispatches
--     could both pick driver D and both insert without conflict.
--
-- I1: driver_balance() and can_go_online() are security definer and granted to
--     `authenticated` with no caller check, so they launder around the RLS that
--     protects ledger_entries.
--
-- ---------------------------------------------------------------------------
-- DESIGN NOTE: the offer chain lives in SQL, driven by the existing sweeper.
--
-- The alternative was installing pg_net so cron could call the dispatch Edge
-- Function over HTTP. That was rejected: it puts a service-role key inside the
-- database to solve a problem SQL can solve directly.
--
-- The consequence is a deliberate asymmetry between the two offer paths, and it
-- must not be papered over:
--
--   * The FIRST offer is ranked by ETA. supabase/functions/dispatch calls
--     find_candidates_for_trip, ranks the shortlist through an EtaProvider
--     (rankByEta / straightLineEta in packages/core) and offers the best ETA.
--
--   * A RE-OFFER after a timeout is ordered by STRAIGHT-LINE DISTANCE. The
--     sweeper runs inside Postgres and has no ETA provider; find_candidate_drivers
--     already returns its rows ordered by st_distance, so the nearest remaining
--     candidate wins. For a re-offer fifteen seconds after the first that is a
--     defensible degradation - the candidate set is the same one the dispatcher
--     would have ranked - but it is a degradation, not the same path.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Dispatch terminates (C1).
-- ---------------------------------------------------------------------------

-- How many drivers a trip is offered to before it is declared undispatchable.
-- Without a bound the chain walks the whole city and never reaches a terminal
-- state, which is the half of C1 that leaves the RIDER waiting forever.
alter table public.trips
  add column dispatch_attempts integer not null default 0;

comment on column public.trips.dispatch_attempts is
  'Offers made for this trip so far. Bounded by offer_next_candidate(); that bound is what makes dispatch terminate.';

-- Mirrors OFFER_TTL_SECONDS in packages/core/src/dispatch/eta.ts.
-- Kept honest by packages/core/test/trip/parity.test.ts.
--
-- The TTL has to exist in SQL because the sweeper creates offers now, and the
-- sweeper never sees a TypeScript constant. 017_dispatch_chain.test.sql also
-- asserts the cron sweep interval is strictly shorter than this value, so
-- dropping the TTL below the sweep period fails a test instead of silently
-- leaving offers alive past their window.
create or replace function public.offer_ttl_seconds()
returns integer
language sql
immutable
as $$
  select 15;
$$;

revoke all on function public.offer_ttl_seconds() from public, anon;
grant execute on function public.offer_ttl_seconds() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. One live offer per DRIVER, not just per trip (C2).
-- ---------------------------------------------------------------------------
-- One live offer per DRIVER, not just per trip. Without this the "not already
-- committed" filter in find_candidate_drivers is only advisory: it is read in a
-- different transaction from the insert, so two concurrent dispatches can both
-- pick the same driver.
create unique index trip_offers_one_live_per_driver
  on public.trip_offers (driver_id)
  where outcome is null;

-- ---------------------------------------------------------------------------
-- 3. create_trip_offer re-checks commitment under the lock (C2).
-- ---------------------------------------------------------------------------
-- Redefined from 0018 to add the trip row lock and the commitment re-check.
-- The index above already makes a double-booking impossible; the re-check is
-- what makes the refusal LEGIBLE - a named error instead of a raw 23505 the
-- caller has to pattern-match on. The two are not redundant: the re-check is a
-- snapshot read and can be raced, the index cannot.
create or replace function public.create_trip_offer(
  p_trip_id         uuid,
  p_driver_id       uuid,
  p_rank            integer,
  p_eta_seconds     integer,
  p_ttl_seconds     integer,
  p_idempotency_key text
) returns public.trip_offers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer public.trip_offers;
begin
  if p_ttl_seconds <= 0 then
    raise exception 'ttl_must_be_positive' using errcode = '22023';
  end if;

  -- Lock the trip before reading its live offer, the same way trip_transition()
  -- locks before its idempotency check: without the lock two concurrent
  -- dispatches of the SAME trip both pass the check below, and the loser hits
  -- trip_offers_one_live_per_trip instead of returning the existing offer.
  perform 1 from public.trips where id = p_trip_id for update;
  if not found then
    raise exception 'trip_not_found' using errcode = 'P0002';
  end if;

  -- Idempotent: a retried dispatch must not create a second live offer.
  select * into v_offer from public.trip_offers
   where trip_id = p_trip_id and outcome is null;
  if found then
    return v_offer;
  end if;

  -- The commitment re-check (C2). find_candidate_drivers filtered on this, but
  -- it did so in a different transaction and a different snapshot; by the time
  -- execution reaches here the driver may already have been offered something
  -- else.
  if exists (
    select 1 from public.trip_offers
     where driver_id = p_driver_id and outcome is null
  ) then
    raise exception 'driver_already_offered' using errcode = '42501';
  end if;

  -- `id <> p_trip_id` matters: re-offering THIS trip to a driver who is still
  -- attached to it (a decline followed by a retry) must not be blocked by the
  -- trip itself. Any OTHER live trip is a genuine double-booking.
  if exists (
    select 1 from public.trips
     where driver_id = p_driver_id
       and id <> p_trip_id
       and state in ('offered', 'accepted', 'arrived', 'in_progress')
  ) then
    raise exception 'driver_already_committed' using errcode = '42501';
  end if;

  insert into public.trip_offers (trip_id, driver_id, rank, eta_seconds, expires_at)
  values (p_trip_id, p_driver_id, p_rank, p_eta_seconds,
          now() + make_interval(secs => p_ttl_seconds))
  returning * into v_offer;

  perform public.assign_driver_to_trip(p_trip_id, p_driver_id, p_idempotency_key);

  return v_offer;
end;
$$;

revoke all on function public.create_trip_offer(uuid, uuid, integer, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.create_trip_offer(uuid, uuid, integer, integer, integer, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 4. The chain itself (C1).
-- ---------------------------------------------------------------------------
-- Advances one trip to its next candidate, or to a terminal state. This is the
-- function that was missing: the sweeper marked offers timed_out and left the
-- trip sitting in `offered`, attached to the driver who ignored it.
create or replace function public.offer_next_candidate(p_trip_id uuid)
returns public.trip_offers
language plpgsql
security definer
set search_path = public
as $$
declare
  -- The bound that makes dispatch terminate. Three offers at a 15s TTL is about
  -- as long as a rider will sit watching a spinner before they give up anyway;
  -- telling them `no_drivers` is the honest answer.
  v_max_attempts constant integer := 3;
  -- The widest stage of DISPATCH_RADII_M. The sweeper does not walk the stages
  -- the way supabase/functions/dispatch does: a re-offer is already late, so it
  -- looks as far as dispatch ever would, in one pass.
  v_radius_m     constant integer := 4000;
  -- Deep enough that skipping the drivers who already saw this trip still
  -- leaves someone to offer it to.
  v_scan_limit   constant integer := 10;
  v_trip      public.trips;
  v_driver_id uuid;
  v_attempt   integer;
begin
  -- Lock first. A slow sweep overlapping the next cron tick must not let both
  -- advance the same trip.
  select * into v_trip from public.trips where id = p_trip_id for update;
  if not found then
    raise exception 'trip_not_found' using errcode = 'P0002';
  end if;

  -- Anything else is no longer dispatch's to touch: accepted, cancelled,
  -- completed, or already terminal.
  if v_trip.state not in ('requested', 'offered') then
    return null;
  end if;

  -- A live offer means the previous one has not actually lapsed. Advancing now
  -- would revoke an offer a driver is still looking at.
  if exists (
    select 1 from public.trip_offers
     where trip_id = p_trip_id and outcome is null
  ) then
    return null;
  end if;

  -- dispatch_attempts is not trips.state, so trips_guard_state_trg does not
  -- gate it and no in_transition flag is needed for this write.
  --
  -- The counter is seeded from the offers that actually exist, not taken on
  -- trust: the FIRST offer is made by supabase/functions/dispatch, which never
  -- passes through here, so counting only what this function did would make
  -- that offer free and hand the rank it already used to a second driver. With
  -- the seed, dispatch_attempts is exactly "offers made for this trip", however
  -- they were made, and `rank` below reads as the Nth offer.
  update public.trips
     set dispatch_attempts = greatest(
           dispatch_attempts,
           (select count(*) from public.trip_offers where trip_id = p_trip_id)
         ) + 1
   where id = p_trip_id
  returning dispatch_attempts into v_attempt;

  if v_attempt > v_max_attempts then
    perform public.trip_transition_system(
      p_trip_id, 'no_drivers',
      'dispatch-exhausted-' || p_trip_id::text,
      jsonb_build_object('reason', 'max_attempts', 'attempts', v_attempt));
    return null;
  end if;

  -- Clear the outgoing driver BEFORE searching. find_candidate_drivers excludes
  -- anyone committed to a trip in 'offered', and this trip is still 'offered'
  -- with driver_id set to the driver who just let the offer lapse - leaving it
  -- set is precisely what made that driver permanently unmatchable.
  --
  -- set_config's third argument scopes the flag to the TRANSACTION, not the
  -- statement, so it is lowered to '0' immediately: leaving it raised would
  -- exempt every later write in this transaction from trips_guard_state_trg,
  -- including ones this function knows nothing about.
  if v_trip.driver_id is not null then
    perform set_config('gera.in_transition', '1', true);
    update public.trips set driver_id = null where id = p_trip_id;
    perform set_config('gera.in_transition', '0', true);
  end if;

  -- Ordered by straight-line distance, not ETA - see the DESIGN NOTE at the top
  -- of this migration. Skipping drivers who already had an offer for THIS trip
  -- is what makes the chain advance; without it the nearest driver is re-offered
  -- the trip they just ignored, on every tick, until the attempt bound fires.
  select c.driver_id into v_driver_id
    from public.find_candidate_drivers(
           v_trip.pickup, v_trip.vehicle_class, v_radius_m, v_scan_limit) c
   where not exists (
     select 1 from public.trip_offers o
      where o.trip_id = p_trip_id and o.driver_id = c.driver_id
   )
   -- Belt and braces against the sweeper ever raising: a driver holding a live
   -- offer is refused by create_trip_offer, and a raise inside the sweep rolls
   -- back the timed_out marks for every other trip in the same tick.
   and not exists (
     select 1 from public.trip_offers o2
      where o2.driver_id = c.driver_id and o2.outcome is null
   )
   order by c.distance_m
   limit 1;

  if v_driver_id is null then
    perform public.trip_transition_system(
      p_trip_id, 'no_drivers',
      'dispatch-no-candidates-' || p_trip_id::text || '-' || v_attempt::text,
      jsonb_build_object('reason', 'no_candidates', 'attempts', v_attempt));
    return null;
  end if;

  -- eta_seconds is null by design on this path: the sweeper has no ETA
  -- provider, and inventing one here would be a second, silent copy of
  -- AVERAGE_SPEED_MPS living in SQL. A null eta is honest about which path
  -- created the offer.
  return public.create_trip_offer(
    p_trip_id, v_driver_id, v_attempt, null,
    public.offer_ttl_seconds(),
    'reoffer-' || p_trip_id::text || '-' || v_attempt::text);
end;
$$;

revoke all on function public.offer_next_candidate(uuid)
  from public, anon, authenticated;
grant execute on function public.offer_next_candidate(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. The sweeper drives the chain (C1).
-- ---------------------------------------------------------------------------
-- Redefined from 0019. Marking the offer timed_out was only ever half the job;
-- the trip it belonged to has to move too. The return value is unchanged - the
-- count of offers expired, which is what the cron log reads.
create or replace function public.expire_stale_offers()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count   integer;
  v_trips   uuid[];
  v_trip_id uuid;
begin
  -- The affected trips have to be captured by the same statement that expires
  -- the offers. Re-reading them afterwards would also pick up trips whose
  -- offers an earlier tick expired and already advanced.
  with expired as (
    update public.trip_offers
       set outcome = 'timed_out'
     where outcome is null
       and expires_at <= now()
    returning trip_id
  )
  select count(*)::integer, coalesce(array_agg(distinct trip_id), '{}'::uuid[])
    into v_count, v_trips
    from expired;

  foreach v_trip_id in array v_trips loop
    perform public.offer_next_candidate(v_trip_id);
  end loop;

  return v_count;
end;
$$;

revoke all on function public.expire_stale_offers() from public, anon, authenticated;
grant execute on function public.expire_stale_offers() to service_role;

-- ---------------------------------------------------------------------------
-- 6. decline_offer only declines a LIVE offer (I2).
-- ---------------------------------------------------------------------------
-- Redefined from 0018 to add the `expires_at > now()` predicate accept_offer
-- already had. Without it a driver whose offer had already lapsed - but which
-- the sweeper had not reached yet - recorded 'declined' instead of 'timed_out',
-- corrupting the reliability signal the outcome column exists to carry: a
-- driver who never opened the app looked like a driver who actively refused.
create or replace function public.decline_offer(p_offer_id uuid)
returns public.trip_offers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer public.trip_offers;
begin
  update public.trip_offers
     set outcome = 'declined'
   where id = p_offer_id
     and driver_id = auth.uid()
     and outcome is null
     and expires_at > now()
  returning * into v_offer;

  if not found then
    raise exception 'offer_not_available' using errcode = '42501';
  end if;

  return v_offer;
end;
$$;

revoke all on function public.decline_offer(uuid) from public, anon;
grant execute on function public.decline_offer(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. driver_balance() and can_go_online() stop leaking (I1).
-- ---------------------------------------------------------------------------
-- Both are security definer, which is what lets can_go_online() be called from
-- inside the presence RLS policy - and that grant cannot simply be dropped,
-- because presence_owner_all calls it as the caller. So the caller check has to
-- live in the body.
--
-- Confirmed live before this fix: as `authenticated` with an unrelated sub,
-- driver_balance('<another driver>') returned 5000 while a direct
-- ledger_entries read under RLS returned 0 rows.
--
-- The arithmetic is unchanged - packages/core/test/ledger/sql-parity.test.ts
-- compares it against balanceOf() case by case - only the language changes,
-- because `language sql` has nowhere to put a guard.
create or replace function public.driver_balance(p_driver_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_balance integer;
begin
  -- security definer bypasses the RLS on ledger_entries, so the caller check has
  -- to live here. auth.uid() is null for service_role, which legitimately needs
  -- to read any driver's balance.
  if p_driver_id <> auth.uid() and auth.uid() is not null then
    raise exception 'not_your_balance' using errcode = '42501';
  end if;

  select coalesce(sum(
    case when kind in ('topup_credit', 'adjustment_credit')
         then amount_rwf else -amount_rwf end
  ), 0)::integer
    into v_balance
    from public.ledger_entries
   where driver_id = p_driver_id;

  return v_balance;
end;
$$;

-- Same leak, same guard: can_go_online() answers "is this driver's wallet above
-- the minimum", which is a fact about someone else's money.
create or replace function public.can_go_online(p_driver_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_driver_id <> auth.uid() and auth.uid() is not null then
    raise exception 'not_your_balance' using errcode = '42501';
  end if;

  return public.driver_balance(p_driver_id)
         >= (select min_driver_balance_rwf from public.platform_settings);
end;
$$;

revoke all on function public.driver_balance(uuid) from public, anon;
revoke all on function public.can_go_online(uuid) from public, anon;
grant execute on function public.driver_balance(uuid) to authenticated, service_role;
grant execute on function public.can_go_online(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Going online and reporting a position are different acts (I3).
-- ---------------------------------------------------------------------------
-- presence_owner_all gated every write that left status = 'online', so a driver
-- whose balance dipped below the minimum mid-shift got 42501 on every position
-- ping until they went offline. In Phase 3 that same write feeds the rider's
-- live map, so a rider watching a moto approach would simply see it stop.
--
-- WITH CHECK sees only the NEW row, so "did this update change status?" needs
-- the old one. A subquery on driver_presence from inside its own policy is
-- infinite recursion; a security definer reader is not. It is STABLE, so it
-- runs on the UPDATE statement's snapshot and returns the PRE-update status.
create or replace function public.presence_status_now(p_driver_id uuid)
returns driver_status
language sql
stable
security definer
set search_path = public
as $$
  select status from public.driver_presence where driver_id = p_driver_id;
$$;

revoke all on function public.presence_status_now(uuid) from public, anon;
grant execute on function public.presence_status_now(uuid) to authenticated, service_role;

drop policy if exists presence_owner_all on public.driver_presence;

create policy presence_owner_all on public.driver_presence
  for all
  using (driver_id = auth.uid())
  with check (
    driver_id = auth.uid()
    and (
      -- Going offline, or staying offline. Never gated: a driver who cannot go
      -- offline sits in driver_presence_dispatchable_idx being matched to real
      -- passengers.
      status <> 'online'
      -- Already online: this write reports a position, it grants nothing. The
      -- eligibility filters that matter are enforced where they actually bite -
      -- find_candidate_drivers requires verification = 'verified' and a
      -- heartbeat inside 30 seconds - so this does not make an ineligible
      -- driver dispatchable, it only stops their map from freezing.
      or public.presence_status_now(auth.uid()) = 'online'
      -- A genuine transition INTO online. This is the act being gated, and the
      -- only one.
      or (
        exists (
          select 1 from public.drivers d
           where d.id = auth.uid() and d.verification = 'verified'
        )
        and public.can_go_online(auth.uid())
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 9. Repair the stranded rows (C1).
-- ---------------------------------------------------------------------------
-- A migration that fixes the code and leaves the corrupted rows has not fixed
-- the incident. Every trip sitting in `offered` with no live offer is a rider
-- waiting on an offer nobody holds and a driver who cannot be matched to
-- anything else; each one gets exactly the advance the sweeper would now give
-- it - the next candidate, or a terminal `no_drivers`.
do $$
declare
  r record;
begin
  for r in
    select t.id
      from public.trips t
     where t.state = 'offered'
       and not exists (
         select 1 from public.trip_offers o
          where o.trip_id = t.id and o.outcome is null
       )
  loop
    perform public.offer_next_candidate(r.id);
  end loop;
end;
$$;
