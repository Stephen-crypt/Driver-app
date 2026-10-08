-- Promo codes, part 1 of 3: the codes and what a passenger can do with them.
-- Design: docs/superpowers/specs/2026-10-08-promo-codes-design.md.
--
-- Nova pays for every discount. A code takes money off the ride fare only
-- (never the waiting charge), and the rider still earns on the full fare;
-- part 2 (0065) does that at completion. Part 3 (0066) is the staff side.

do $$ begin
  create type public.promo_kind as enum ('amount', 'percent');
exception when duplicate_object then null; end $$;

create table if not exists public.promo_codes (
  id                  uuid primary key default gen_random_uuid(),
  -- As staff wrote it, shown to passengers.
  code                text not null,
  -- What a typed code is matched on: letters and digits only, upper case.
  code_key            text not null unique,
  kind                public.promo_kind not null,
  amount_rwf          integer check (amount_rwf > 0),
  percent             integer check (percent between 1 and 100),
  max_discount_rwf    integer check (max_discount_rwf > 0),
  min_fare_rwf        integer check (min_fare_rwf >= 0),
  -- Null means every vehicle type.
  vehicle_classes     public.vehicle_class[],
  per_passenger_limit integer not null default 1 check (per_passenger_limit >= 1),
  total_limit         integer check (total_limit >= 1),
  starts_at           timestamptz not null default now(),
  ends_at             timestamptz,
  paused              boolean not null default false,
  -- Staff only; passengers never see it.
  note                text,
  batch_id            uuid,
  created_by          uuid references auth.users (id),
  created_at          timestamptz not null default now(),
  constraint promo_kind_fields check (
    (kind = 'amount' and amount_rwf is not null and percent is null and max_discount_rwf is null)
    or (kind = 'percent' and percent is not null and amount_rwf is null)
  )
);

-- The codes a passenger has added.
create table if not exists public.passenger_promos (
  passenger_id uuid not null references auth.users (id) on delete cascade,
  promo_id     uuid not null references public.promo_codes (id),
  added_at     timestamptz not null default now(),
  primary key (passenger_id, promo_id)
);

-- Every add, right or wrong, for the lock-out on guessing.
create table if not exists public.promo_attempts (
  id           bigint generated always as identity primary key,
  passenger_id uuid not null references auth.users (id) on delete cascade,
  ok           boolean not null,
  at           timestamptz not null default now()
);
create index if not exists promo_attempts_recent on public.promo_attempts (passenger_id, at desc);

-- Which code a trip used and what it took off. Here rather than in part 2
-- because counting a code's uses needs it; part 2 fills it in.
alter table public.trips add column if not exists promo_id uuid references public.promo_codes (id);
alter table public.trips add column if not exists promo_discount_rwf integer check (promo_discount_rwf >= 0);
create index if not exists trips_promo on public.trips (promo_id) where promo_id is not null;

alter table public.promo_codes enable row level security;
alter table public.passenger_promos enable row level security;
alter table public.promo_attempts enable row level security;
revoke all on public.promo_codes, public.passenger_promos, public.promo_attempts from public, anon, authenticated;
grant select on public.passenger_promos to authenticated;
drop policy if exists passenger_promos_own on public.passenger_promos;
create policy passenger_promos_own on public.passenger_promos for select using (passenger_id = auth.uid());

-- "nv–7kq2 " and "NV-7KQ2" are the same code.
create or replace function public.promo_key(p text)
returns text language sql immutable set search_path = public as $$
  select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

-- What a code takes off a fare: never more than the fare, never negative.
-- Percentages round down to whole hundreds, as fares are.
create or replace function public.promo_discount_rwf(p public.promo_codes, p_fare integer)
returns integer language sql immutable set search_path = public as $$
  select greatest(0, least(coalesce(p_fare, 0),
    case p.kind
      when 'amount' then p.amount_rwf
      else least(coalesce(p.max_discount_rwf, 2147483647),
                 (floor(coalesce(p_fare, 0) * p.percent / 100.0 / 100.0) * 100)::integer)
    end));
$$;

-- A use is a trip that is happening, happened, or is booked ahead. Counted,
-- never stored, so a cancelled ride gives its use back by construction.
create or replace function public.promo_uses(p_promo_id uuid, p_passenger uuid default null)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::integer from public.trips t
   where t.promo_id = p_promo_id
     and (p_passenger is null or t.passenger_id = p_passenger)
     and t.state in ('requested', 'offered', 'accepted', 'arrived', 'in_progress', 'completed', 'scheduled');
$$;

-- Null when the code can be used; otherwise why not. Class and fare are
-- optional: adding a code checks only what does not depend on a ride.
create or replace function public.promo_problem(
  p public.promo_codes, p_passenger uuid, p_class public.vehicle_class, p_fare integer
) returns text language sql stable security definer set search_path = public as $$
  select case
    when p.paused then 'paused'
    when p.starts_at > now() then 'not_started'
    when p.ends_at is not null and p.ends_at <= now() then 'ended'
    when p.total_limit is not null and public.promo_uses(p.id) >= p.total_limit then 'used_up'
    when public.promo_uses(p.id, p_passenger) >= p.per_passenger_limit then 'already_used'
    when p_class is not null and p.vehicle_classes is not null and not (p_class = any (p.vehicle_classes)) then 'vehicle'
    when p_fare is not null and p.min_fare_rwf is not null and p_fare < p.min_fare_rwf then 'min_fare'
  end;
$$;

-- A passenger adds a code. Returns a result rather than raising, so a wrong
-- try is recorded (a raise would roll the record back) and counts toward the
-- lock-out: more than ten wrong tries in an hour and adding stops for the hour.
create or replace function public.add_promo_code(p_code text)
returns table (result text, promo_id uuid, code text, kind public.promo_kind, amount_rwf integer,
               percent integer, max_discount_rwf integer, ends_at timestamptz, uses_left integer)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_me   uuid := auth.uid();
  v_code public.promo_codes;
  v_why  text;
begin
  if v_me is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  if (select count(*) from public.promo_attempts a
       where a.passenger_id = v_me and not a.ok and a.at > now() - interval '1 hour') >= 10 then
    return query select 'too_many_tries'::text, null::uuid, null::text, null::public.promo_kind,
                        null::integer, null::integer, null::integer, null::timestamptz, null::integer;
    return;
  end if;

  select * into v_code from public.promo_codes c where c.code_key = public.promo_key(p_code);
  if not found then
    insert into public.promo_attempts (passenger_id, ok) values (v_me, false);
    return query select 'not_found'::text, null::uuid, null::text, null::public.promo_kind,
                        null::integer, null::integer, null::integer, null::timestamptz, null::integer;
    return;
  end if;

  insert into public.promo_attempts (passenger_id, ok) values (v_me, true);
  v_why := public.promo_problem(v_code, v_me, null, null);
  if v_why is null then
    if exists (select 1 from public.passenger_promos pp where pp.passenger_id = v_me and pp.promo_id = v_code.id) then
      v_why := 'already_added';
    else
      insert into public.passenger_promos (passenger_id, promo_id) values (v_me, v_code.id);
      v_why := 'added';
    end if;
  end if;

  return query select v_why, v_code.id, v_code.code, v_code.kind, v_code.amount_rwf, v_code.percent,
                      v_code.max_discount_rwf, v_code.ends_at,
                      greatest(0, v_code.per_passenger_limit - public.promo_uses(v_code.id, v_me));
end;
$$;

-- The passenger's saved codes, newest first, each with a status:
-- ready, used, used_up, ended, paused or not_started.
create or replace function public.my_promos()
returns table (promo_id uuid, code text, kind public.promo_kind, amount_rwf integer, percent integer,
               max_discount_rwf integer, min_fare_rwf integer, vehicle_classes public.vehicle_class[],
               ends_at timestamptz, uses_left integer, status text)
language sql stable security definer set search_path = public as $$
  select c.id, c.code, c.kind, c.amount_rwf, c.percent, c.max_discount_rwf, c.min_fare_rwf, c.vehicle_classes,
         c.ends_at,
         greatest(0, c.per_passenger_limit - public.promo_uses(c.id, auth.uid())),
         case x.problem when 'already_used' then 'used' else coalesce(x.problem, 'ready') end
    from public.passenger_promos pp
    join public.promo_codes c on c.id = pp.promo_id
    cross join lateral (select public.promo_problem(c, auth.uid(), null, null) as problem) x
   where pp.passenger_id = auth.uid()
   order by pp.added_at desc;
$$;

-- For the quote function: which of the passenger's saved codes a ride gets.
-- p_choice is 'best' (the one saving most), 'none', or a code's id.
create or replace function public.promo_for_quote(
  p_passenger uuid, p_class public.vehicle_class, p_fare integer, p_choice text
) returns table (promo_id uuid, code text, discount_rwf integer)
language sql stable security definer set search_path = public as $$
  select c.id, c.code, public.promo_discount_rwf(c, p_fare)
    from public.passenger_promos pp
    join public.promo_codes c on c.id = pp.promo_id
   where pp.passenger_id = p_passenger
     and coalesce(p_choice, 'best') <> 'none'
     and (coalesce(p_choice, 'best') = 'best' or c.id::text = p_choice)
     and public.promo_problem(c, p_passenger, p_class, p_fare) is null
     and public.promo_discount_rwf(c, p_fare) > 0
   order by public.promo_discount_rwf(c, p_fare) desc, c.created_at
   limit 1;
$$;

revoke all on function public.promo_key(text) from public, anon, authenticated;
revoke all on function public.promo_discount_rwf(public.promo_codes, integer) from public, anon, authenticated;
revoke all on function public.promo_uses(uuid, uuid) from public, anon, authenticated;
revoke all on function public.promo_problem(public.promo_codes, uuid, public.vehicle_class, integer) from public, anon, authenticated;
revoke all on function public.add_promo_code(text) from public, anon;
revoke all on function public.my_promos() from public, anon;
revoke all on function public.promo_for_quote(uuid, public.vehicle_class, integer, text) from public, anon, authenticated;
grant execute on function public.add_promo_code(text) to authenticated;
grant execute on function public.my_promos() to authenticated;
grant execute on function public.promo_for_quote(uuid, public.vehicle_class, integer, text) to service_role;
grant execute on function public.promo_key(text), public.promo_discount_rwf(public.promo_codes, integer),
  public.promo_uses(uuid, uuid), public.promo_problem(public.promo_codes, uuid, public.vehicle_class, integer)
  to service_role;
