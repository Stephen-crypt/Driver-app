-- Promo codes, part 2 of 3: a code rides on a quote into the trip booked from
-- it, and completion records the cash the rider actually collects.
-- Design: docs/superpowers/specs/2026-10-08-promo-codes-design.md.

-- The code a quote was priced with, and the discount shown.
alter table public.fare_quotes add column if not exists promo_id uuid references public.promo_codes (id);
alter table public.fare_quotes add column if not exists promo_discount_rwf integer check (promo_discount_rwf >= 0);

-- Carries a quote's code onto the trip booked from it, after checking it
-- again: limits and pauses may have changed since the quote. The code's row
-- is locked, so two bookings racing for its last use cannot both have it:
-- the second waits, and the checks after the lock run on a fresh READ
-- COMMITTED snapshot that sees the first one's trip. That needs this
-- function to stay VOLATILE (the default) and callers to stay at READ
-- COMMITTED, as PostgREST is.
-- Whatever the insert itself put in the promo columns is replaced: only the
-- quote decides. Regular trips never carry a promo.
create or replace function public.trips_apply_promo()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  q public.fare_quotes;
  p public.promo_codes;
begin
  new.promo_id := null;
  new.promo_discount_rwf := null;
  if new.quote_id is null or new.recurring_schedule_id is not null then
    return new;
  end if;
  select * into q from public.fare_quotes where id = new.quote_id;
  if not found or q.promo_id is null then
    return new;
  end if;
  select * into p from public.promo_codes where id = q.promo_id for update;
  if not found or public.promo_problem(p, new.passenger_id, new.vehicle_class, new.quoted_amount_rwf) is not null then
    raise exception 'promo_unavailable' using errcode = '22023';
  end if;
  new.promo_id := p.id;
  new.promo_discount_rwf := public.promo_discount_rwf(p, new.quoted_amount_rwf);
  return new;
end;
$$;
revoke all on function public.trips_apply_promo() from public, anon, authenticated;
drop trigger if exists trips_apply_promo on public.trips;
create trigger trips_apply_promo before insert on public.trips
  for each row execute function public.trips_apply_promo();

-- Completion: as 0055, plus the promo. The rider earns on the full total;
-- fare_collected is the cash taken, fare + waiting - discount.
create or replace function public.complete_trip(p_trip_id uuid, p_actual_distance_m integer, p_idempotency_key text)
 RETURNS trips
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_trip    public.trips;
  v_policy  record;
  v_fare    integer;
  v_wait    integer;
  v_total   integer;
  v_earning integer;
  v_actual  integer;
  v_measured double precision;
  v_discount integer := 0;
  v_promo    public.promo_codes;
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

  -- The distance billed. The rider's phone reports it, but the rider earns a
  -- share of the fare, so the phone is not trusted alone: the server measured
  -- the ride itself from accurate GPS fixes (trip_progress, 0047). The claim is
  -- capped at that plus a margin for gaps between fixes; with no measurement
  -- at all, at the quoted distance - no extra charge without evidence.
  select travelled_m into v_measured from public.trip_progress where trip_id = p_trip_id;
  v_actual := least(
    greatest(p_actual_distance_m, 0),
    case when v_measured is not null and v_measured > 0
         then round(v_measured * 1.1 + 300)::integer
         else coalesce(v_trip.quoted_distance_m, 0) end);

  v_fare := public.final_fare_rwf(
    v_trip.quoted_amount_rwf,
    coalesce(v_trip.quoted_distance_m, 0),
    v_actual,
    v_policy.per_km_rwf
  );
  v_wait := public.trip_waiting_charge_internal(p_trip_id);
  v_total := v_fare + v_wait;

  v_earning := public.rider_earning_rwf(v_total, v_policy.commission_pct);

  -- Nova covers a promo: the rider earns on the full total above, and only
  -- the cash they collect is less. Worked out again on the final fare, never
  -- on the waiting charge.
  if v_trip.promo_id is not null then
    select * into v_promo from public.promo_codes where id = v_trip.promo_id;
    if found then
      v_discount := public.promo_discount_rwf(v_promo, v_fare);
    end if;
  end if;

  perform set_config('gera.in_transition', '1', true);
  update public.trips
     set actual_distance_m = v_actual,
         promo_discount_rwf = case when v_trip.promo_id is null then null else v_discount end
   where id = p_trip_id;
  perform set_config('gera.in_transition', '0', true);

  v_trip := public.trip_transition(
    p_trip_id, 'completed', p_idempotency_key,
    jsonb_build_object(
      'total_rwf', v_total,
      'fare_rwf', v_fare,
      'waiting_charge_rwf', v_wait,
      'promo_discount_rwf', v_discount,
      'paid_rwf', v_total - v_discount,
      'rider_earning_rwf', v_earning,
      'policy_id', v_policy.id
    )
  );

  -- Two rows, not one, and this is the point of the whole model. The rider now
  -- holds the cash the passenger paid AND is owed v_earning. Netting
  -- them into a single entry would hide the exposure, which is the number that
  -- decides whether they work tomorrow.
  insert into public.ledger_entries (rider_id, trip_id, kind, amount_rwf, memo)
  values
    (v_trip.rider_id, p_trip_id, 'fare_collected', v_total - v_discount,
     'cash taken on trip ' || p_trip_id),
    (v_trip.rider_id, p_trip_id, 'trip_earning', v_earning,
     'earning on trip ' || p_trip_id);

  return v_trip;
end;
$function$
;

-- The receipt's figures, now with the promo (its code and what it took off)
-- and what was paid. Trips that finished before promos read 0 off and
-- paid = total.
drop function if exists public.trip_total_rwf(uuid);
create function public.trip_total_rwf(p_trip_id uuid)
returns table (total_rwf integer, fare_rwf integer, waiting_charge_rwf integer,
               promo_discount_rwf integer, paid_rwf integer, promo_code text)
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
         coalesce((e.meta->>'waiting_charge_rwf')::integer, 0),
         coalesce((e.meta->>'promo_discount_rwf')::integer, 0),
         coalesce((e.meta->>'paid_rwf')::integer, (e.meta->>'total_rwf')::integer),
         (select c.code from public.trips t join public.promo_codes c on c.id = t.promo_id
           where t.id = p_trip_id)
    from public.trip_events e
   where e.trip_id = p_trip_id and e.to_state = 'completed'
   order by e.created_at desc
   limit 1;
end;
$$;
revoke all on function public.trip_total_rwf(uuid) from public, anon;
grant execute on function public.trip_total_rwf(uuid) to authenticated;
