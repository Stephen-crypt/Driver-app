-- The fleet money model, part 2 of 2.

-- ---------------------------------------------------------------------------
-- 1. Settings.
alter table public.platform_settings
  -- The fleet's real control on cash. A rider carrying more than this must
  -- remit before working again; without it, exposure grows quietly with every
  -- shift and the first anyone notices is when somebody stops answering.
  add column if not exists max_cash_held_rwf integer not null default 50000;

-- There is deliberately NO separate rider-share setting. fare_policies already
-- carries commission_pct per vehicle class, and in a fleet that still means
-- exactly what it says: the share the company keeps to cover the vehicle, fuel
-- and overhead. The rider gets the remainder. Two independently configured
-- percentages would be one contradiction away from paying out more than was
-- collected, and per-class granularity is worth keeping - a cab does not cost
-- the company what a moto does.

-- The marketplace float minimum no longer gates anything. Left in place rather
-- than dropped so a rollback has something to read, but nothing consults it.
comment on column public.platform_settings.min_rider_balance_rwf is
  'Retired with the marketplace model. Nothing reads this.';

-- ---------------------------------------------------------------------------
-- 2. The two readings of the ledger.

-- Company cash sitting in a riders pocket. Exposure, not earnings.
create or replace function public.rider_cash_held_internal(p_rider_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(
    case kind
      when 'fare_collected'  then amount_rwf
      when 'cash_remittance' then -amount_rwf
      else 0
    end
  ), 0)::integer
    from public.ledger_entries
   where rider_id = p_rider_id;
$$;

-- What the company owes the rider. Positive means we owe them; negative means
-- they owe us, which happens when deductions outrun earnings.
--
-- The retired marketplace kinds are classified here too, so a rider with rows
-- from both eras still totals correctly rather than silently dropping history:
-- a commission_debit reduced what they were owed, and a topup_credit was money
-- they had already handed us.
create or replace function public.rider_net_owed_internal(p_rider_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(
    case kind
      when 'trip_earning'      then amount_rwf
      when 'bonus'             then amount_rwf
      when 'adjustment_credit' then amount_rwf
      when 'topup_credit'      then amount_rwf
      when 'deduction'         then -amount_rwf
      when 'payout'            then -amount_rwf
      when 'adjustment_debit'  then -amount_rwf
      when 'commission_debit'  then -amount_rwf
      else 0
    end
  ), 0)::integer
    from public.ledger_entries
   where rider_id = p_rider_id;
$$;

revoke all on function public.rider_cash_held_internal(uuid) from public, anon, authenticated;
revoke all on function public.rider_net_owed_internal(uuid) from public, anon, authenticated;
grant execute on function public.rider_cash_held_internal(uuid) to service_role;
grant execute on function public.rider_net_owed_internal(uuid) to service_role;

-- Owner-scoped wrappers. A rider reads their own figures and nobody else's -
-- the old rider_balance leaked every wallet in Phase 2b before it was scoped
-- exactly this way.
-- These RAISE rather than returning null, matching can_go_online. A null is
-- indistinguishable from "no ledger rows yet", so a caller cannot tell a
-- refusal from an empty ledger - and a security boundary that answers
-- ambiguously is one somebody will misread. service_role has no auth.uid(),
-- and the dispatcher needs to read any rider's figures.
create or replace function public.rider_cash_held(p_rider_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_rider_id <> auth.uid() and auth.uid() is not null then
    raise exception 'not_your_ledger' using errcode = '42501';
  end if;
  return public.rider_cash_held_internal(p_rider_id);
end;
$$;

create or replace function public.rider_net_owed(p_rider_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_rider_id <> auth.uid() and auth.uid() is not null then
    raise exception 'not_your_ledger' using errcode = '42501';
  end if;
  return public.rider_net_owed_internal(p_rider_id);
end;
$$;

revoke all on function public.rider_cash_held(uuid) from public, anon;
revoke all on function public.rider_net_owed(uuid) from public, anon;
grant execute on function public.rider_cash_held(uuid) to authenticated, service_role;
grant execute on function public.rider_net_owed(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Going online.
--
-- A fleet rider needs a vehicle and must not be carrying too much of our cash.
-- The old test - "has a positive float" - was a marketplace rule and is gone.
create or replace function public.can_go_online_internal(p_rider_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- A vehicle they are actually assigned. In a fleet the company owns it, so
    -- "no vehicle" means "not working today", not "bring your own".
    exists (
      select 1 from public.vehicles v
       where v.rider_id = p_rider_id and v.is_active
    )
    and public.rider_cash_held_internal(p_rider_id)
        <= (select max_cash_held_rwf from public.platform_settings);
$$;

-- ---------------------------------------------------------------------------
-- 4. Completion writes both sides.

-- The remainder after commission, NOT an independent percentage of the fare.
-- Subtracting guarantees earning + commission = total exactly; two separate
-- roundings would leak a franc either way on most fares, and a rider who can
-- add up their own trips will find it.
create or replace function public.rider_earning_rwf(p_fare_rwf integer, p_commission_pct numeric)
returns integer
language sql
immutable
as $$
  select p_fare_rwf - public.commission_rwf(p_fare_rwf, p_commission_pct);
$$;

revoke all on function public.rider_earning_rwf(integer, numeric) from public, anon;
grant execute on function public.rider_earning_rwf(integer, numeric) to authenticated, service_role;

create or replace function public.complete_trip(
  p_trip_id uuid,
  p_actual_distance_m integer,
  p_idempotency_key text
)
returns public.trips
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip    public.trips;
  v_policy  record;
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

  v_total := public.final_fare_rwf(
    v_trip.quoted_amount_rwf,
    coalesce(v_trip.quoted_distance_m, 0),
    p_actual_distance_m,
    v_policy.per_km_rwf
  );

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

revoke all on function public.complete_trip(uuid, integer, text) from public, anon;
grant execute on function public.complete_trip(uuid, integer, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Money movements, service_role only.

-- A rider hands cash in. Reduces what they are carrying, not what they earn.
create or replace function public.record_remittance(
  p_rider_id uuid,
  p_amount_rwf integer,
  p_reference text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_amount_rwf is null or p_amount_rwf <= 0 then
    raise exception 'amount_must_be_positive' using errcode = '22023';
  end if;
  if p_reference is null or length(btrim(p_reference)) = 0 then
    -- Cash with no reference is indistinguishable from cash that never arrived.
    raise exception 'reference_required' using errcode = '22023';
  end if;

  insert into public.ledger_entries (rider_id, kind, amount_rwf, memo)
  values (p_rider_id, 'cash_remittance', p_amount_rwf, p_reference);

  return public.rider_cash_held_internal(p_rider_id);
end;
$$;

-- The company pays the rider. Reduces what we owe, not what they carry.
create or replace function public.pay_rider(
  p_rider_id uuid,
  p_amount_rwf integer,
  p_reference text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_amount_rwf is null or p_amount_rwf <= 0 then
    raise exception 'amount_must_be_positive' using errcode = '22023';
  end if;
  if p_reference is null or length(btrim(p_reference)) = 0 then
    raise exception 'reference_required' using errcode = '22023';
  end if;

  insert into public.ledger_entries (rider_id, kind, amount_rwf, memo)
  values (p_rider_id, 'payout', p_amount_rwf, p_reference);

  return public.rider_net_owed_internal(p_rider_id);
end;
$$;

-- Bonuses and deductions, kept separate from payouts so reporting can say why.
create or replace function public.adjust_rider_earnings(
  p_rider_id uuid,
  p_amount_rwf integer,
  p_kind ledger_entry_kind,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_kind not in ('bonus', 'deduction') then
    raise exception 'kind_must_be_bonus_or_deduction' using errcode = '22023';
  end if;
  if p_amount_rwf is null or p_amount_rwf <= 0 then
    raise exception 'amount_must_be_positive' using errcode = '22023';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    -- A deduction nobody can explain to the rider is a dispute waiting.
    raise exception 'reason_required' using errcode = '22023';
  end if;

  insert into public.ledger_entries (rider_id, kind, amount_rwf, memo)
  values (p_rider_id, p_kind, p_amount_rwf, p_reason);

  return public.rider_net_owed_internal(p_rider_id);
end;
$$;

revoke all on function public.record_remittance(uuid, integer, text)
  from public, anon, authenticated;
revoke all on function public.pay_rider(uuid, integer, text)
  from public, anon, authenticated;
revoke all on function public.adjust_rider_earnings(uuid, integer, ledger_entry_kind, text)
  from public, anon, authenticated;

grant execute on function public.record_remittance(uuid, integer, text) to service_role;
grant execute on function public.pay_rider(uuid, integer, text) to service_role;
grant execute on function public.adjust_rider_earnings(uuid, integer, ledger_entry_kind, text)
  to service_role;

-- The marketplace top-up has no meaning in a fleet: a rider does not buy a
-- float to work. Dropped rather than left as a trap for whoever reads the CLI
-- next and assumes it still means something.
drop function if exists public.credit_rider_wallet(uuid, integer, text);

-- rider_balance was the marketplace's single number. Replaced by the two
-- readings above, which do not lie about exposure.
drop function if exists public.rider_balance(uuid);
drop function if exists public.rider_balance_internal(uuid);

-- ---------------------------------------------------------------------------
-- 6. The review queue reported a wallet balance, which no longer exists. It now
-- reports the two numbers a desk actually acts on: what the rider is carrying
-- (chase it) and what we owe them (pay it).
drop function if exists public.review_queue();

create or replace function public.review_queue()
returns table (
  rider_id      uuid,
  first_name    text,
  phone         text,
  verification  text,
  vehicle_class text,
  plate         text,
  cash_held_rwf integer,
  net_owed_rwf  integer,
  documents     jsonb,
  submitted_at  timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select d.id,
         p.first_name,
         p.phone,
         d.verification::text,
         v.class::text,
         v.plate,
         public.rider_cash_held_internal(d.id),
         public.rider_net_owed_internal(d.id),
         coalesce(
           (select jsonb_object_agg(dd.kind::text,
                     jsonb_build_object('status', dd.status, 'path', dd.storage_path))
              from public.rider_documents dd
             where dd.rider_id = d.id),
           '{}'::jsonb),
         d.created_at
    from public.riders d
    join public.profiles p on p.id = d.id
    left join public.vehicles v on v.rider_id = d.id and v.is_active
   where d.verification <> 'verified'
   order by d.created_at;
$$;

revoke all on function public.review_queue() from public, anon, authenticated;
grant execute on function public.review_queue() to service_role;
