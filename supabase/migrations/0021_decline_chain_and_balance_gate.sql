-- Phase 2b re-review, second fix wave. 0020 closed the timeout door and left
-- four others open - one of them the same Critical, reached a different way,
-- and one of them a permissiveness regression 0020 itself introduced.
--
-- C1 (again): DECLINING an offer strands the trip exactly as a timeout used to.
--     decline_offer set outcome = 'declined' and stopped. expire_stale_offers
--     only ever looks at offers with `outcome is null`, so the sweeper never saw
--     that trip again, and offer_next_candidate had exactly one caller - the
--     sweeper. The trip sat in `offered` with driver_id on the decliner forever,
--     and find_candidate_drivers excludes drivers committed to an `offered`
--     trip, so the decliner was permanently unmatchable.
--
--     This is worse than the timeout it mirrors. A timeout is an edge case.
--     Declining is NORMAL driver behaviour, granted to every authenticated
--     driver: every decline stranded a trip and burned a driver.
--
-- I1: 0020 split "go online" from "report position" and left the online->online
--     branch ungated. find_candidate_drivers filters on verification and a
--     30-second heartbeat but NOT on balance, so an underfunded driver already
--     online stayed dispatchable indefinitely - where the old policy froze their
--     heartbeat out of the index within thirty seconds - and a stale `online`
--     row from a dead session could re-enter dispatch by pinging position
--     alone, never writing `status`, never crossing the funding gate. The
--     comment in 0020 claiming "the eligibility filters that matter are enforced
--     where they actually bite" was factually wrong about funding. It is true
--     now, because this migration makes it true.
--
-- I2: the chain runs inside expire_stale_offers' transaction, so one trip whose
--     advance raised discarded the `timed_out` marks for every other trip in
--     that tick.
--
-- I3: create_trip_offer's idempotency select ignored expires_at, so a retry
--     could hand back an already-expired offer as though it were live.

-- ---------------------------------------------------------------------------
-- 1. The wallet guard moves to the front door, so the arithmetic can be reused.
-- ---------------------------------------------------------------------------
-- 0020 put the caller check INSIDE driver_balance() and can_go_online(). That
-- is right for the public entry points and wrong for internal callers:
-- find_candidate_drivers has to ask about somebody else's wallet by definition,
-- and it can be reached with a driver's own auth.uid() set (decline_offer is
-- called by a driver and now advances the chain in the same transaction), which
-- would have made every candidate search raise `not_your_balance`.
--
-- The fix is structural rather than a carve-out: the guard belongs on the
-- function clients can call, the arithmetic belongs somewhere only definer
-- context can reach. Splitting them keeps ONE copy of the arithmetic - the copy
-- packages/core/test/ledger/sql-parity.test.ts checks against balanceOf().

-- Mirrors balanceOf() in packages/core/src/ledger/commission.ts.
-- Kept honest by packages/core/test/ledger/sql-parity.test.ts, through the
-- guarded wrapper below.
-- Credits are topup_credit and adjustment_credit; everything else is a debit.
--
-- NO caller check, and therefore no grant to anyone: this is callable only from
-- inside another security definer function. Revoking it from `authenticated` is
-- what stops it being the leak driver_balance() was.
create or replace function public.driver_balance_internal(p_driver_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(
    case when kind in ('topup_credit', 'adjustment_credit')
         then amount_rwf else -amount_rwf end
  ), 0)::integer
    from public.ledger_entries
   where driver_id = p_driver_id;
$$;

-- Mirrors canGoOnline() in packages/core/src/ledger/commission.ts.
create or replace function public.can_go_online_internal(p_driver_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.driver_balance_internal(p_driver_id)
         >= (select min_driver_balance_rwf from public.platform_settings);
$$;

revoke all on function public.driver_balance_internal(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.can_go_online_internal(uuid)
  from public, anon, authenticated, service_role;

-- The public entry points keep the guard 0020 gave them; only the body moves.
-- security definer bypasses the RLS on ledger_entries, so the caller check has
-- to live here. auth.uid() is null for service_role, which legitimately needs
-- to read any driver's balance.
create or replace function public.driver_balance(p_driver_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_driver_id <> auth.uid() and auth.uid() is not null then
    raise exception 'not_your_balance' using errcode = '42501';
  end if;

  return public.driver_balance_internal(p_driver_id);
end;
$$;

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

  return public.can_go_online_internal(p_driver_id);
end;
$$;

revoke all on function public.driver_balance(uuid) from public, anon;
revoke all on function public.can_go_online(uuid) from public, anon;
grant execute on function public.driver_balance(uuid) to authenticated, service_role;
grant execute on function public.can_go_online(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Eligibility is enforced where it actually bites (I1).
-- ---------------------------------------------------------------------------
-- Redefined from 0017 to add the funding predicate. Spec 3.5 says a driver below
-- the minimum cannot be online; until now that was enforced ONLY by the presence
-- policy's with-check, which 0020 correctly stopped applying to position pings -
-- and which never applied to a row that was already online and simply stayed
-- that way. Dispatch is the place the rule has to hold, because dispatch is what
-- the rule is for: it decides whether a driver in arrears gets sent a passenger.
--
-- can_go_online_internal, not can_go_online: this function is reached with a
-- driver's own auth.uid() set (decline_offer advances the chain in the same
-- transaction), and asking the guarded version about a DIFFERENT driver's wallet
-- would raise. Cost is one indexed sum per candidate over
-- ledger_entries_driver_idx, on a set already narrowed to online, in-class,
-- in-radius drivers - a handful of rows, not the table.
create or replace function public.find_candidate_drivers(
  p_pickup   geography(Point, 4326),
  p_class    vehicle_class,
  p_radius_m integer,
  p_limit    integer
) returns table (driver_id uuid, distance_m double precision)
language sql
stable
security definer
set search_path = public
as $$
  select p.driver_id,
         st_distance(p.position, p_pickup) as distance_m
    from public.driver_presence p
    join public.drivers d on d.id = p.driver_id
   where p.status = 'online'
     and p.vehicle_class = p_class
     and p.position is not null
     -- A driver whose app died must not be offered a trip. Spec 6: the server
     -- decides a driver is gone, never the client.
     and p.heartbeat_at > now() - interval '30 seconds'
     and d.verification = 'verified'
     -- Spec 3.5, enforced at the point of dispatch rather than only at the
     -- moment of going online. A driver whose wallet fell below the minimum
     -- mid-shift stops being dispatchable immediately, whether or not they ever
     -- write `status` again.
     and public.can_go_online_internal(p.driver_id)
     and st_dwithin(p.position, p_pickup, p_radius_m)
     -- Not already committed to another live trip.
     and not exists (
       select 1 from public.trips t
        where t.driver_id = p.driver_id
          and t.state in ('offered', 'accepted', 'arrived', 'in_progress')
     )
   order by st_distance(p.position, p_pickup)
   limit p_limit;
$$;

revoke all on function public.find_candidate_drivers(geography, vehicle_class, integer, integer)
  from public, anon, authenticated;
grant execute on function public.find_candidate_drivers(geography, vehicle_class, integer, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3. A decline advances the chain (C1).
-- ---------------------------------------------------------------------------
-- Redefined from 0020. The UPDATE is unchanged and stays a single statement:
-- `driver_id = auth.uid()` inside it IS the authorization, and splitting the
-- check out of the statement that performs the write is how that guarantee gets
-- lost.
--
-- What is new is the line after it. The sweeper cannot rescue a declined offer -
-- expire_stale_offers only ever looks at `outcome is null` - so waiting for a
-- sweep means waiting forever. Advancing inline is also better for the rider
-- than waiting would have been even if it worked: a decline is a definite
-- answer, and the next driver can be asked immediately instead of fifteen
-- seconds later.
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

  -- No exception handler: if the advance cannot happen the decline must not
  -- stand either, because a recorded decline with the trip left in `offered` is
  -- precisely the corruption this migration exists to remove. The driver
  -- retries; nothing is stranded in the meantime.
  perform public.offer_next_candidate(v_offer.trip_id);

  return v_offer;
end;
$$;

revoke all on function public.decline_offer(uuid) from public, anon;
grant execute on function public.decline_offer(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. One bad trip no longer rolls back a whole sweep tick (I2).
-- ---------------------------------------------------------------------------
-- Redefined from 0020. Before 0020 the sweeper was a single UPDATE and could not
-- raise; now it runs the chain, and create_trip_offer's commitment checks take a
-- fresh statement snapshot, so a dispatch committing mid-sweep can raise
-- driver_already_offered, 23505 or driver_not_verified. Without the sub-block
-- that discards the `timed_out` marks for every OTHER trip in the same tick.
--
-- The handler is deliberately narrow in effect and loud in the log: it swallows
-- the transaction-abort, not the information. The next tick retries the trip ten
-- seconds later, because its offer is still marked timed_out by then.
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
    begin
      perform public.offer_next_candidate(v_trip_id);
    exception when others then
      -- One trip's advance must not discard the whole tick's expiries.
      raise warning 'expire_stale_offers: advancing trip % failed: %',
        v_trip_id, sqlerrm;
    end;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.expire_stale_offers() from public, anon, authenticated;
grant execute on function public.expire_stale_offers() to service_role;

-- ---------------------------------------------------------------------------
-- 5. A retry cannot be handed a dead offer (I3).
-- ---------------------------------------------------------------------------
-- Redefined from 0020 for one predicate. The idempotency select matched any
-- unresolved offer, expired or not, so a dispatch retry landing in the window
-- between an offer lapsing and the sweeper reaching it got that offer back and
-- reported it as live - to a driver who could no longer accept it, because
-- accept_offer requires expires_at > now(). The caller now learns there is a
-- conflict instead of being told a lie; ten seconds later the sweep has cleared
-- it and the chain moves on.
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

  perform 1 from public.trips where id = p_trip_id for update;
  if not found then
    raise exception 'trip_not_found' using errcode = 'P0002';
  end if;

  -- Idempotent: a retried dispatch must not create a second live offer. LIVE,
  -- not merely unresolved - see the note above.
  select * into v_offer from public.trip_offers
   where trip_id = p_trip_id and outcome is null and expires_at > now();
  if found then
    return v_offer;
  end if;

  if exists (
    select 1 from public.trip_offers
     where driver_id = p_driver_id and outcome is null
  ) then
    raise exception 'driver_already_offered' using errcode = '42501';
  end if;

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
