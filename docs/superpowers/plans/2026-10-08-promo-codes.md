# Promo Codes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Passengers add promo codes that make an eligible ride cheaper; staff create, batch and pause codes in the dashboard; riders collect the lower amount while earning on the full fare.

**Architecture:** Three Postgres migrations hold the rules (tables, discount arithmetic, eligibility, a booking trigger, the completion change, staff functions). The `quote` edge function attaches the best eligible code to each quote; a BEFORE INSERT trigger on `trips` carries it onto the trip after re-checking; `complete_trip` records cash net of the discount. The data package, dashboard and both apps read and display it.

**Tech Stack:** Postgres 17 + PostGIS on Supabase (pgTAP tests), Deno edge functions, TypeScript packages (`@nova/data`, vitest), Vite + React dashboard, Expo SDK 57 apps.

**Spec:** `docs/superpowers/specs/2026-10-08-promo-codes-design.md`

## Global Constraints

- Nova covers the discount: `trip_earning` is always computed on the full `fare + wait`; only `fare_collected` is reduced.
- The discount applies to the ride fare only, never the waiting charge, and never exceeds the fare.
- Percentage discounts round DOWN to whole hundreds (fares are whole hundreds); amount discounts are used as given.
- A use = a trip with the code in `requested`, `offered`, `accepted`, `arrived`, `in_progress`, `completed` or `scheduled`. Counted, never stored.
- Codes match case-insensitively ignoring everything but letters and digits (`nova 50` = `NOVA50`, `nv7kq2` = `NV-7KQ2`).
- Lock-out: more than 10 failed adds in an hour refuses further adds for that hour.
- Generated codes: `NV-` + 4 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`.
- Batches: 1–200 codes, each single-use (per passenger 1, total 1).
- Regular (recurring) trips never carry a promo.
- Staff: `admin` and `operations` create and pause; `finance` reads. Every create and pause is audited.
- Revoke from `public, anon, authenticated` explicitly on every new table and function (Supabase default privileges grant `authenticated`).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Two passengers booking the last use of a total-limited code at the same moment: exactly one booking gets it, the other gets `promo_unavailable` (the trigger locks the code row) — pinned in Task 2.
2. A final fare that differs from the quote (longer route, waiting time): the percent discount is recomputed on the final fare, the waiting charge is untouched, cash collected never goes negative — pinned in Task 2.
3. A passenger who turns promos off for a ride: the quote carries no code and the trip carries none even though they own an eligible one — pinned in Tasks 2 and 4.
4. A code typed with lower case, spaces or a unicode dash (`nv–7kq2`): matches — pinned in Task 1.
5. A client trying to set `promo_id` / `promo_discount_rwf` on a trip directly: refused — pinned in Task 2.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/0064_promo_codes.sql` | promo tables, normalisation, discount and eligibility functions, `add_promo_code`, `my_promos`, `promo_for_quote` |
| `supabase/migrations/0065_promo_trips.sql` | quote/trip columns, booking trigger, `complete_trip` net cash, `trip_total_rwf` with promo |
| `supabase/migrations/0066_promo_staff.sql` | staff create, batch, pause, list, trips |
| `supabase/tests/047_promo_codes.test.sql` | Task 1 tests |
| `supabase/tests/048_promo_trips.test.sql` | Task 2 tests |
| `supabase/tests/049_promo_staff.test.sql` | Task 3 tests |
| `supabase/functions/quote/promo.ts` (+ `_test`) | parse the `promo` choice from a quote request |
| `supabase/functions/quote/index.ts` | attach the code to the quote |
| `supabase/functions/complete-trip/index.ts` | promo line and paid amount on the receipt |
| `packages/data/src/promos.ts` (+ test) | add, list, labels, error words |
| `packages/data/src/trips.ts`, `shift.ts`, `rider.ts` | quote, total and active-trip fields |
| `apps/dashboard/src/pages/Promotions.tsx` | the Promotions page |
| `apps/passenger/app/promotions.tsx` | Account → Promotions |
| `apps/passenger/src/ride/PromoLine.tsx` | the promo line and picker on the ride sheet |
| `apps/passenger/app/ride.tsx`, `src/ride/Choose.tsx`, `src/ride/Completed.tsx`, `app/trip/[id].tsx`, `app/(tabs)/account.tsx` | wiring and receipts |
| `apps/rider/src/today/TripPanel.tsx`, `ReceiptSheet.tsx` | the amount to collect |

---

### Task 1: Promo codes in the database

**Files:**
- Create: `supabase/migrations/0064_promo_codes.sql`
- Test: `supabase/tests/047_promo_codes.test.sql`

**Interfaces:**
- Produces: type `promo_kind`; tables `promo_codes`, `passenger_promos`, `promo_attempts`; functions
  `promo_key(text) → text`, `promo_discount_rwf(promo_codes, integer) → integer`,
  `promo_uses(uuid, uuid default null) → integer`,
  `promo_problem(promo_codes, uuid, vehicle_class, integer) → text`,
  `add_promo_code(p_code text) → table(result text, promo_id uuid, code text, kind promo_kind, amount_rwf int, percent int, max_discount_rwf int, ends_at timestamptz, uses_left int)`,
  `my_promos() → table(promo_id uuid, code text, kind promo_kind, amount_rwf int, percent int, max_discount_rwf int, min_fare_rwf int, vehicle_classes vehicle_class[], ends_at timestamptz, uses_left int, status text)`,
  `promo_for_quote(p_passenger uuid, p_class vehicle_class, p_fare int, p_choice text) → table(promo_id uuid, code text, discount_rwf int)`.
  Statuses from `my_promos`: `ready`, `used`, `used_up`, `ended`, `paused`, `not_started`. Results from `add_promo_code`: `added`, `already_added`, `not_found`, `ended`, `used_up`, `already_used`, `paused`, `not_started`, `too_many_tries`.
  Note: `trips.promo_id` is added in Task 1 too (needed by `promo_uses`).

- [ ] **Step 1: Write the failing test** — `supabase/tests/047_promo_codes.test.sql`

```sql
begin;
select plan(17);

insert into auth.users (instance_id, id, aud, role, email)
select '00000000-0000-0000-0000-000000000000', ('e4700000-0000-4000-8000-00000000000' || n)::uuid,
       'authenticated', 'authenticated', 'u' || n || '.e47@test.local' from generate_series(1, 2) n;
insert into public.profiles (id, role, first_name, phone) values
  ('e4700000-0000-4000-8000-000000000001', 'passenger', 'Aline', '+250788994701'),
  ('e4700000-0000-4000-8000-000000000002', 'passenger', 'Eric', '+250788994702');

insert into public.promo_codes (id, code, code_key, kind, amount_rwf, percent, max_discount_rwf, per_passenger_limit, total_limit, ends_at, paused) values
  ('e47c0000-0000-4000-8000-000000000001', 'NOVA50', 'NOVA50', 'amount', 500, null, null, 1, null, null, false),
  ('e47c0000-0000-4000-8000-000000000002', 'NV-7KQ2', 'NV7KQ2', 'percent', null, 30, 1000, 2, 5, null, false),
  ('e47c0000-0000-4000-8000-000000000003', 'OLD', 'OLD', 'amount', 300, null, null, 1, null, now() - interval '1 day', false),
  ('e47c0000-0000-4000-8000-000000000004', 'RESTING', 'RESTING', 'amount', 300, null, null, 1, null, null, true);

-- Arithmetic.
select is(public.promo_discount_rwf((select p from public.promo_codes p where code = 'NOVA50'), 1400), 500, 'a fixed amount comes off');
select is(public.promo_discount_rwf((select p from public.promo_codes p where code = 'NOVA50'), 300), 300, 'never more than the fare');
select is(public.promo_discount_rwf((select p from public.promo_codes p where code = 'NV-7KQ2'), 1400), 400, 'a percentage rounds down to whole hundreds');
select is(public.promo_discount_rwf((select p from public.promo_codes p where code = 'NV-7KQ2'), 9000), 1000, 'and stops at its cap');

-- Matching.
select is(public.promo_key('  nv–7kq2 '), 'NV7KQ2', 'case, spaces and dashes do not matter');

set local role authenticated;
set local request.jwt.claims to '{"sub":"e4700000-0000-4000-8000-000000000001","role":"authenticated"}';

select is((select result from public.add_promo_code('nova 50')), 'added', 'a passenger adds a code');
select is((select result from public.add_promo_code('NOVA50')), 'already_added', 'adding it twice is harmless');
select is((select result from public.add_promo_code('OLD')), 'ended', 'an ended code is refused with its reason');
select is((select result from public.add_promo_code('RESTING')), 'paused', 'a paused code says so');
select is((select uses_left from public.add_promo_code('nv-7kq2')), 2, 'and says how many uses are left');
select is((select count(*)::int from public.my_promos()), 2, 'my_promos lists the two saved codes');
select is((select status from public.my_promos() where code = 'NOVA50'), 'ready', 'ready to use');

-- Lock-out: ten wrong tries in an hour.
select public.add_promo_code('WRONG' || n) from generate_series(1, 10) n;
select is((select result from public.add_promo_code('NOVA50')), 'too_many_tries', 'the eleventh try within the hour is refused');

reset role;
-- The picker: the code saving most wins; "none" picks nothing; a code that does not fit is skipped.
select is((select code from public.promo_for_quote('e4700000-0000-4000-8000-000000000001', 'moto', 1400, 'best')), 'NOVA50',
  '500 off beats 30% of 1,400 (400)');
select is((select count(*)::int from public.promo_for_quote('e4700000-0000-4000-8000-000000000001', 'moto', 1400, 'none')), 0,
  'none means no code');
select is((select code from public.promo_for_quote('e4700000-0000-4000-8000-000000000001', 'moto', 1400, 'e47c0000-0000-4000-8000-000000000002')), 'NV-7KQ2',
  'a chosen code is used when it fits');

select ok(not has_table_privilege('authenticated', 'public.promo_codes', 'SELECT'), 'codes are not readable from the app');

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx supabase test db`
Expected: `047_promo_codes.test.sql` fails (`relation "public.promo_codes" does not exist`).

- [ ] **Step 3: Write the migration** — `supabase/migrations/0064_promo_codes.sql`

```sql
-- Promo codes, part 1 of 3: the codes themselves and what a passenger can do
-- with them. Design: docs/superpowers/specs/2026-10-08-promo-codes-design.md.

do $$ begin
  create type public.promo_kind as enum ('amount', 'percent');
exception when duplicate_object then null; end $$;

create table if not exists public.promo_codes (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null,
  -- What a typed code is matched on: letters and digits only, upper case.
  code_key            text not null unique,
  kind                public.promo_kind not null,
  amount_rwf          integer check (amount_rwf > 0),
  percent             integer check (percent between 1 and 100),
  max_discount_rwf    integer check (max_discount_rwf > 0),
  min_fare_rwf        integer check (min_fare_rwf >= 0),
  vehicle_classes     public.vehicle_class[],
  per_passenger_limit integer not null default 1 check (per_passenger_limit >= 1),
  total_limit         integer check (total_limit >= 1),
  starts_at           timestamptz not null default now(),
  ends_at             timestamptz,
  paused              boolean not null default false,
  note                text,
  batch_id            uuid,
  created_by          uuid references auth.users (id),
  created_at          timestamptz not null default now(),
  constraint promo_kind_fields check (
    (kind = 'amount' and amount_rwf is not null and percent is null and max_discount_rwf is null)
    or (kind = 'percent' and percent is not null and amount_rwf is null)
  )
);

create table if not exists public.passenger_promos (
  passenger_id uuid not null references auth.users (id) on delete cascade,
  promo_id     uuid not null references public.promo_codes (id),
  added_at     timestamptz not null default now(),
  primary key (passenger_id, promo_id)
);

create table if not exists public.promo_attempts (
  id           bigint generated always as identity primary key,
  passenger_id uuid not null references auth.users (id) on delete cascade,
  ok           boolean not null,
  at           timestamptz not null default now()
);
create index if not exists promo_attempts_recent on public.promo_attempts (passenger_id, at desc);

-- Which code a trip used. Here rather than in part 2 because counting uses
-- needs it; part 2 fills it in.
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

-- A use is a trip that is happening, happened, or is booked ahead.
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
-- lock-out.
create or replace function public.add_promo_code(p_code text)
returns table (result text, promo_id uuid, code text, kind public.promo_kind, amount_rwf integer,
               percent integer, max_discount_rwf integer, ends_at timestamptz, uses_left integer)
language plpgsql security definer set search_path = public as $$
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
    return query select 'too_many_tries', null::uuid, null::text, null::public.promo_kind, null::int, null::int, null::int, null::timestamptz, null::int;
    return;
  end if;

  select * into v_code from public.promo_codes c where c.code_key = public.promo_key(p_code);
  if not found then
    insert into public.promo_attempts (passenger_id, ok) values (v_me, false);
    return query select 'not_found', null::uuid, null::text, null::public.promo_kind, null::int, null::int, null::int, null::timestamptz, null::int;
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

create or replace function public.my_promos()
returns table (promo_id uuid, code text, kind public.promo_kind, amount_rwf integer, percent integer,
               max_discount_rwf integer, min_fare_rwf integer, vehicle_classes public.vehicle_class[],
               ends_at timestamptz, uses_left integer, status text)
language sql stable security definer set search_path = public as $$
  select c.id, c.code, c.kind, c.amount_rwf, c.percent, c.max_discount_rwf, c.min_fare_rwf, c.vehicle_classes,
         c.ends_at,
         greatest(0, c.per_passenger_limit - public.promo_uses(c.id, auth.uid())),
         case coalesce(public.promo_problem(c, auth.uid(), null, null), 'ready')
           when 'already_used' then 'used'
           else coalesce(public.promo_problem(c, auth.uid(), null, null), 'ready')
         end
    from public.passenger_promos pp
    join public.promo_codes c on c.id = pp.promo_id
   where pp.passenger_id = auth.uid()
   order by pp.added_at desc;
$$;

-- For the quote function: which of the passenger's saved codes to apply.
-- p_choice is 'best', 'none', or a code id.
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
  public.promo_uses(uuid, uuid), public.promo_problem(public.promo_codes, uuid, public.vehicle_class, integer) to service_role;
```

- [ ] **Step 4: Apply and run** — `npx supabase migration up && npx supabase test db`. Expected: all pass, including 047.

- [ ] **Step 5: Commit** — `git add supabase/migrations/0064_promo_codes.sql supabase/tests/047_promo_codes.test.sql && git commit -m "feat(db): promo codes - tables, discount maths, eligibility, add and list"`

---

### Task 2: Promos on quotes, bookings and completed trips

**Files:**
- Create: `supabase/migrations/0065_promo_trips.sql` (generated: copies the current `complete_trip` body from the live database with the promo changes applied)
- Test: `supabase/tests/048_promo_trips.test.sql`

**Interfaces:**
- Consumes: Task 1 functions.
- Produces: `fare_quotes.promo_id`, `fare_quotes.promo_discount_rwf`; trigger `trips_apply_promo` (raises `promo_unavailable`, errcode 22023); `complete_trip` meta keys `promo_discount_rwf`, `paid_rwf`; `trip_total_rwf(uuid) → table(total_rwf int, fare_rwf int, waiting_charge_rwf int, promo_discount_rwf int, paid_rwf int)`.

- [ ] **Step 1: Write the failing test** — `supabase/tests/048_promo_trips.test.sql`. Fixtures follow `046_no_offer_to_own_trip.test.sql` (users, profiles, a verified rider with vehicle and shift) plus a fare policy row from the seed. Assertions:

```sql
-- (fixture: passenger P e4800...01, rider R e4800...02, codes as in 047, P has saved NOVA50 and NV-7KQ2)
-- quote Q1: moto 1400, promo NOVA50 / 500; quote Q2: same, no promo
select lives_ok($$ insert into public.trips (passenger_id, vehicle_class, state, pickup, pickup_label, dropoff, dropoff_label,
  quote_id, quoted_amount_rwf) values ('e4800000-0000-4000-8000-000000000001', 'moto', 'requested',
  st_point(30.06, -1.94)::geography, 'A', st_point(30.09, -1.95)::geography, 'B', 'e48a0000-0000-4000-8000-000000000001', 1400) $$,
  'a booking from a quote with a code goes through');
select is((select promo_discount_rwf from public.trips where quote_id = 'e48a0000-0000-4000-8000-000000000001'), 500, 'and carries the code');
select is((select promo_id from public.trips where quote_id = 'e48a0000-0000-4000-8000-000000000002'), null, 'a quote without a code books without one');  -- review focus 3
select throws_ok(/* booking from a quote whose code is now paused */ , '22023', 'promo_unavailable', 'a code paused after the quote refuses the booking');
select throws_ok(/* second passenger's booking of a total_limit=1 code already used */, '22023', 'promo_unavailable', 'the last use goes to one booking only');  -- review focus 1
select is(public.promo_uses('<code>'), 0, 'a cancelled ride gives the use back');  -- after setting the trip to cancelled_by_passenger
-- complete_trip as the rider on a 30% code trip whose final fare grew to 2000 with 200 waiting:
select is((select (meta->>'promo_discount_rwf')::int from public.trip_events where trip_id = '<t>' and to_state = 'completed'), 600, 'the percentage is recomputed on the final fare');  -- review focus 2
select is((select amount_rwf from public.ledger_entries where trip_id = '<t>' and kind = 'fare_collected'), 1600, 'cash collected is fare + wait - discount');
select is((select amount_rwf from public.ledger_entries where trip_id = '<t>' and kind = 'trip_earning'), public.rider_earning_rwf(2200, <commission>), 'the rider earns on the full total');
select is((select paid_rwf from public.trip_total_rwf('<t>')), 1600, 'the receipt says what was paid');
select ok(not has_column_privilege('authenticated', 'public.trips', 'promo_id', 'UPDATE'), 'the app cannot set a code on a trip');  -- review focus 5
```

The executor writes the full fixture (ids `e48...`), the concrete placeholders above, and drives `complete_trip` with `set local request.jwt.claims` for the rider after moving the trip to `in_progress` with `set_config('gera.in_transition','1',true)`.

- [ ] **Step 2: Run** `npx supabase test db` — expect 048 to fail (`column "promo_id" of relation "fare_quotes" does not exist`).

- [ ] **Step 3: Write the migration** — build `0065_promo_trips.sql` from these pieces:

```sql
alter table public.fare_quotes add column if not exists promo_id uuid references public.promo_codes (id);
alter table public.fare_quotes add column if not exists promo_discount_rwf integer check (promo_discount_rwf >= 0);
revoke update (promo_id, promo_discount_rwf) on public.trips from public, anon, authenticated;
revoke insert (promo_id, promo_discount_rwf) on public.trips from public, anon, authenticated;

-- Carries a quote's code onto the trip booked from it, after checking it
-- again: limits and pauses may have changed since the quote. The code row is
-- locked so two bookings racing for its last use cannot both get it.
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
  if public.promo_problem(p, new.passenger_id, new.vehicle_class, new.quoted_amount_rwf) is not null then
    raise exception 'promo_unavailable' using errcode = '22023';
  end if;
  new.promo_id := p.id;
  new.promo_discount_rwf := public.promo_discount_rwf(p, new.quoted_amount_rwf);
  return new;
end;
$$;
drop trigger if exists trips_apply_promo on public.trips;
create trigger trips_apply_promo before insert on public.trips
  for each row execute function public.trips_apply_promo();
```

Then `complete_trip`: generate with a script that reads `pg_get_functiondef('public.complete_trip(uuid,integer,text)'::regprocedure)` and applies exactly these replacements (assert each matches once):
1. declare: add `v_discount integer := 0;` and `v_promo public.promo_codes;` after `v_measured double precision;`.
2. after `v_earning := public.rider_earning_rwf(v_total, v_policy.commission_pct);` insert:
   ```sql
   -- Nova covers a promo: the rider earns on the full total above; only the
   -- cash they collect is less. Recomputed on the final fare, never the wait.
   if v_trip.promo_id is not null then
     select * into v_promo from public.promo_codes where id = v_trip.promo_id;
     if found then v_discount := public.promo_discount_rwf(v_promo, v_fare); end if;
   end if;
   ```
3. `set actual_distance_m = v_actual` → `set actual_distance_m = v_actual, promo_discount_rwf = case when v_trip.promo_id is null then null else v_discount end`
4. meta: after `'waiting_charge_rwf', v_wait,` add `'promo_discount_rwf', v_discount, 'paid_rwf', v_total - v_discount,`
5. ledger: `(v_trip.rider_id, p_trip_id, 'fare_collected', v_total,` → `(v_trip.rider_id, p_trip_id, 'fare_collected', v_total - v_discount,`

And `trip_total_rwf`: `drop function if exists public.trip_total_rwf(uuid);` then recreate with the two extra columns:

```sql
create or replace function public.trip_total_rwf(p_trip_id uuid)
returns table (total_rwf integer, fare_rwf integer, waiting_charge_rwf integer, promo_discount_rwf integer, paid_rwf integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.trips t
     where t.id = p_trip_id and (t.passenger_id = auth.uid() or t.rider_id = auth.uid())
  ) then
    raise exception 'not_a_participant' using errcode = '42501';
  end if;
  return query
  select (e.meta->>'total_rwf')::integer,
         coalesce((e.meta->>'fare_rwf')::integer, (e.meta->>'total_rwf')::integer),
         coalesce((e.meta->>'waiting_charge_rwf')::integer, 0),
         coalesce((e.meta->>'promo_discount_rwf')::integer, 0),
         coalesce((e.meta->>'paid_rwf')::integer, (e.meta->>'total_rwf')::integer)
    from public.trip_events e
   where e.trip_id = p_trip_id and e.to_state = 'completed'
   order by e.created_at desc
   limit 1;
end;
$$;
revoke all on function public.trip_total_rwf(uuid) from public, anon;
grant execute on function public.trip_total_rwf(uuid) to authenticated;
```

- [ ] **Step 4: Apply and run** — all db tests pass (also the existing complete_trip and trip_total tests, unchanged).
- [ ] **Step 5: Commit** — `feat(db): promos ride on quotes into trips; Nova covers the discount at completion`

---

### Task 3: Staff functions

**Files:**
- Create: `supabase/migrations/0066_promo_staff.sql`
- Test: `supabase/tests/049_promo_staff.test.sql`

**Interfaces:**
- Produces:
  `staff_create_promo(p_code text, p_kind promo_kind, p_amount_rwf int, p_percent int, p_max_discount_rwf int, p_min_fare_rwf int, p_vehicle_classes vehicle_class[], p_per_passenger_limit int, p_total_limit int, p_starts_at timestamptz, p_ends_at timestamptz, p_note text) → promo_codes`;
  `staff_create_promo_batch(p_count int, p_kind promo_kind, p_amount_rwf int, p_percent int, p_max_discount_rwf int, p_min_fare_rwf int, p_vehicle_classes vehicle_class[], p_starts_at timestamptz, p_ends_at timestamptz, p_note text) → table(code text)`;
  `staff_set_promo_paused(p_id uuid, p_paused boolean) → void`;
  `staff_promos() → table(id, code, kind, amount_rwf, percent, max_discount_rwf, min_fare_rwf, vehicle_classes, per_passenger_limit, total_limit, starts_at, ends_at, paused, note, batch_id, created_at, uses int, cost_rwf int, status text)` with status in `active|paused|used_up|ended|not_started`;
  `staff_promo_trips(p_id uuid) → table(trip_id uuid, created_at timestamptz, state trip_state, passenger_name text, phone_tail text, discount_rwf int)`.
  Errors: `promo_code_taken`, `invalid_promo` (bad kind fields or count), `not_permitted`.

- [ ] **Step 1: Write the failing test** — staff fixture as in `040_staff_trip_messages.test.sql` (an `operations` and a `finance` staff member). Assertions: operations creates `NOVA50` (code stored, code_key `NOVA50`, audit row `promo.create`); creating `nova 50` again raises `promo_code_taken`; a blank code generates one matching `^NV-[A-HJKMNP-Z2-9]{4}$`; a batch of 5 returns 5 distinct codes each with `per_passenger_limit = 1` and `total_limit = 1`; `p_count = 201` raises `invalid_promo`; finance reading `staff_promos()` works but finance creating raises `not_permitted`; pausing writes `promo.pause`; a passenger calling `staff_promos()` raises `not_permitted`; `cost_rwf` sums `promo_discount_rwf` over completed trips.

- [ ] **Step 2: Run** — fails (`function public.staff_create_promo does not exist`).

- [ ] **Step 3: Write the migration** — functions `security definer set search_path = public`, each starting with `perform public.require_staff(array['operations']::public.staff_role[]);` (create, batch, pause) or `array['operations','finance']` (list, trips). Generation helper:

```sql
create or replace function public.promo_new_code()
returns text language plpgsql volatile set search_path = public as $$
declare
  chars constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v text;
begin
  loop
    v := 'NV-' || (select string_agg(substr(chars, 1 + floor(random() * length(chars))::int, 1), '')
                     from generate_series(1, 4));
    exit when not exists (select 1 from public.promo_codes where code_key = public.promo_key(v));
  end loop;
  return v;
end;
$$;
```

`staff_create_promo` normalises the display code to `upper(btrim(p_code))`, rejects keys shorter than 4 or longer than 20 with `invalid_promo`, raises `promo_code_taken` (errcode 23505) when the key exists, inserts with `created_by = auth.uid()`, and calls `public.audit_internal('promo.create', 'promo', id::text, jsonb_build_object('code', code))`. The batch shares one `gen_random_uuid()` as `batch_id`, loops `p_count` times calling `promo_new_code()`, audits once as `promo.batch` with the count. `staff_promos` computes `uses = promo_uses(id)` and `cost_rwf = coalesce(sum(t.promo_discount_rwf) filter (where t.state = 'completed'), 0)`. Revoke all from `public, anon` and grant to `authenticated` (the role check is inside).

- [ ] **Step 4: Apply and run** — all pass.
- [ ] **Step 5: Commit** — `feat(db): staff create, batch, pause and review promo codes`

---

### Task 4: Edge functions

**Files:**
- Create: `supabase/functions/quote/promo.ts`, `supabase/functions/quote/promo_test.ts`
- Modify: `supabase/functions/quote/index.ts`, `supabase/functions/complete-trip/index.ts`

**Interfaces:**
- Consumes: `promo_for_quote` (service role), `trips.promo_discount_rwf`.
- Produces: quote request field `promo?: "best" | "none" | <uuid>`; response adds `promo: { id: string; code: string; discountRwf: number } | null` and `payRwf: number`. complete-trip response `receipt` adds `promoRwf: number` and `paidRwf: number`, and a line `{ label: "Promo", amountRwf: -discount }` when there is one.

- [ ] **Step 1: Write the failing test** — `supabase/functions/quote/promo_test.ts`

```ts
import { assertEquals } from "jsr:@std/assert@1";
import { promoChoice } from "./promo.ts";

Deno.test("no choice means the best saved code", () => assertEquals(promoChoice(undefined), "best"));
Deno.test("none and best pass through", () => {
  assertEquals(promoChoice("none"), "none");
  assertEquals(promoChoice("best"), "best");
});
Deno.test("a code id passes through; anything else means best", () => {
  assertEquals(promoChoice("e47c0000-0000-4000-8000-000000000001"), "e47c0000-0000-4000-8000-000000000001");
  assertEquals(promoChoice("'; drop table"), "best");
  assertEquals(promoChoice(42), "best");
});
```

- [ ] **Step 2: Run** `pnpm test:functions` — fails (module not found).

- [ ] **Step 3: Implement**

```ts
// supabase/functions/quote/promo.ts
// Which saved code a quote should use: "best" (the default), "none", or one
// code by id. Anything else is treated as "best" rather than trusted.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function promoChoice(raw: unknown): string {
  if (raw === "none" || raw === "best") return raw;
  if (typeof raw === "string" && UUID.test(raw)) return raw;
  return "best";
}
```

In `quote/index.ts`: add `promo?: unknown` to the body type; after `const amountRwf = quoteFare(...)`:

```ts
  const { data: promoRows } = await svc.rpc("promo_for_quote", {
    p_passenger: auth.user.id,
    p_class: vehicleClass,
    p_fare: amountRwf,
    p_choice: promoChoice(body.promo),
  });
  const promo = (promoRows as { promo_id: string; code: string; discount_rwf: number }[] | null)?.[0] ?? null;
```

insert `promo_id: promo?.promo_id ?? null, promo_discount_rwf: promo?.discount_rwf ?? null` into `fare_quotes`, and return `promo: promo ? { id: promo.promo_id, code: promo.code, discountRwf: promo.discount_rwf } : null, payRwf: amountRwf - (promo?.discount_rwf ?? 0)`.

In `complete-trip/index.ts`: select `promo_discount_rwf` in the `.select(...)` of `completed` is not possible (RPC returns the row) — read `(completed as { promo_discount_rwf?: number | null }).promo_discount_rwf ?? 0` as `promoRwf`; build `lines = [...receipt.lines, ...(promoRwf > 0 ? [{ label: "Promo", amountRwf: -promoRwf }] : [])]`; return `receipt: { lines, totalRwf: receipt.totalRwf, promoRwf, paidRwf: receipt.totalRwf - promoRwf }`.

- [ ] **Step 4: Run** `pnpm test:functions` and `deno check` on both functions — pass.
- [ ] **Step 5: Commit** — `feat(functions): quotes carry the best promo; receipts show it and what was paid`

---

### Task 5: Data package

**Files:**
- Create: `packages/data/src/promos.ts`, `packages/data/test/promos.test.ts`
- Modify: `packages/data/src/index.ts`, `trips.ts`, `shift.ts`, `rider.ts`, `client.ts`

**Interfaces:**
- Produces:
  ```ts
  export type PromoKind = "amount" | "percent";
  export type PromoStatus = "ready" | "used" | "used_up" | "ended" | "paused" | "not_started";
  export interface MyPromo { id: string; code: string; kind: PromoKind; amountRwf: number | null; percent: number | null; maxDiscountRwf: number | null; minFareRwf: number | null; vehicleClasses: string[] | null; endsAt: string | null; usesLeft: number; status: PromoStatus }
  export type AddPromoResult = { ok: true; promo: MyPromo; already: boolean } | { ok: false; message: string };
  export function promoLabel(p: { kind: PromoKind; amountRwf: number | null; percent: number | null; maxDiscountRwf: number | null }): string;
  export async function addPromoCode(client: NovaClient, code: string): Promise<AddPromoResult>;
  export async function listMyPromos(client: NovaClient): Promise<MyPromo[]>;
  // trips.ts
  QuoteRequest.promo?: "best" | "none" | string;
  QuoteResult.promo: { id: string; code: string; discountRwf: number } | null; QuoteResult.payRwf: number;
  // shift.ts
  TripTotal.promoDiscountRwf: number; TripTotal.paidRwf: number;
  // rider.ts
  ActiveTrip.promoDiscountRwf: number;
  // client.ts friendlyError: /promo_unavailable/ -> "That promo code has just run out. The prices are updated without it."
  ```
- `promoLabel`: amount → `"500 RWF off"`; percent without cap → `"30% off"`; with cap → `"30% off, up to 1,000 RWF"`. Numbers use `toLocaleString("en-US")`.
- `addPromoCode` maps results: `added`/`already_added` → ok; `not_found` → "That code isn't right. Check it and try again."; `ended` → "That code has ended."; `used_up` → "That code has been used up."; `already_used` → "You've already used that code."; `paused` → "That code isn't active right now."; `not_started` → "That code isn't active yet."; `too_many_tries` → "Too many tries. Wait an hour and try again."

- [ ] **Step 1: Write the failing tests** — `packages/data/test/promos.test.ts` covering each label form, each result mapping, `listMyPromos` row mapping, `requestQuote` passing `promo`, and `getTripTotal` reading `promo_discount_rwf`/`paid_rwf` (defaults 0 and total when absent), using the fake-client style of `places.test.ts`.
- [ ] **Step 2: Run** `cd packages/data && npx vitest run` — fails.
- [ ] **Step 3: Implement** the interfaces above; `rider.ts` selects `promo_discount_rwf` with `quoted_amount_rwf` and maps `promoDiscountRwf: r.promo_discount_rwf ?? 0`.
- [ ] **Step 4: Run** tests and `npx tsc --noEmit` in data, passenger, rider — pass.
- [ ] **Step 5: Commit** — `feat(data): promo codes, quotes with a promo, totals with what was paid`

---

### Task 6: Dashboard Promotions page

**Files:**
- Create: `apps/dashboard/src/pages/Promotions.tsx`
- Modify: `apps/dashboard/src/App.tsx` (nav entry `{ to: "/promotions", label: "Promotions", roles: ["operations", "finance"], icon: "tag", group: "Money and records" }` and route), `apps/dashboard/src/components/kit.tsx` (icon `tag`: `["M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z", "M7.5 7.5h.01"]`)

**Interfaces:** Consumes Task 3 staff functions via `rpc()` from `lib/supabase`.

- [ ] **Step 1: Build the page** following `Pricing.tsx`: page head band; a KPI row (active codes, uses this month, cost this month); the table (code, discount via a local `label()` mirroring `promoLabel`, uses "23 / 100" or "23", cost `money()`, ends `kigaliDateTime` or "No end", status pill, Pause/Resume button for `can(staff.role, "operations")`); **New code** form (code input + Generate button that leaves it blank for the server, kind toggle, amount or percent + cap, uses per person default 1, total uses, starts, ends, minimum fare, vehicle checkboxes, note) calling `staff_create_promo`; **Make a batch** form calling `staff_create_promo_batch` then showing the returned codes in a `<textarea readOnly>` with a **Copy all** button (`navigator.clipboard.writeText`); clicking a row expands it to `staff_promo_trips`. Errors show through the page's `Flash`.
- [ ] **Step 2: Check** `cd apps/dashboard && npx tsc --noEmit && npx vite build` — pass; screenshot the page against the local stack with an `operations` login.
- [ ] **Step 3: Commit** — `feat(dashboard): Promotions page - codes, batches, pause, uses and cost`

---

### Task 7: Passenger app

**Files:**
- Create: `apps/passenger/app/promotions.tsx`, `apps/passenger/src/ride/PromoLine.tsx`
- Modify: `apps/passenger/app/(tabs)/account.tsx`, `apps/passenger/app/ride.tsx`, `apps/passenger/src/ride/Choose.tsx`, `apps/passenger/src/ride/Completed.tsx`, `apps/passenger/app/trip/[id].tsx`

**Interfaces:** Consumes Task 5.

- [ ] **Step 1: Account → Promotions** — `promotions.tsx` modelled on `payment.tsx`: a `Field` + `Button "Add"` calling `addPromoCode`; success toast `"${code} added: ${promoLabel(promo)}"`; failure `Banner tone="bad"` with the message; list from `listMyPromos` split into "Ready to use" (status `ready`) and a faded "Used and ended" group, each row titled with the code, subtitle `promoLabel` + uses left + "Ends 30 Oct". In `account.tsx` add, in the Payments group, `<Row title="Promotions" subtitle={count ? "N codes ready" : "Add a promo code"} icon="pricetag" onPress={() => router.push("/promotions")} />`.
- [ ] **Step 2: Promo line** — `PromoLine.tsx` renders under the vehicle options: with `quote.promo` → "**CODE** · 500 RWF off" + "Change"; else "Add a promo code". Tapping opens a `ModalSheet` listing `listMyPromos` codes with status `ready` (radio, the current one checked), "Don't use a promo for this ride", and an inline add field. It reports `onChoose("best" | "none" | id)`.
- [ ] **Step 3: Ride screen** — `ride.tsx`: state `promoChoice` default `"best"`; pass `promo: promoChoice` to every `requestQuote`; add `promoChoice` to the quote effect's dependencies; `book` catches an error whose message matches the promo run-out words, sets the error banner, and resets `promoChoice` to `"best"` with a re-quote. `Choose.tsx`: each option shows `quote.payRwf` with `quote.amountRwf` struck through when `quote.promo`; the Book label uses `payRwf`; renders `PromoLine` above the payment row.
- [ ] **Step 4: Receipts** — `Completed.tsx` and `trip/[id].tsx`: after the fare lines, when `total.promoDiscountRwf > 0` add `<Line label="Promo" value={-total.promoDiscountRwf} />` and show "You paid" with `total.paidRwf`.
- [ ] **Step 5: Check** `npx tsc --noEmit` in the passenger app; browser run-through on port 8084 against the local stack: add a code, see the struck-through price, book, finish the trip from the rider side, see the receipt.
- [ ] **Step 6: Commit** — `feat(passenger): promo codes in Account, on the ride sheet and on receipts`

---

### Task 8: Rider app

**Files:**
- Modify: `apps/rider/src/today/TripPanel.tsx`, `apps/rider/src/today/ReceiptSheet.tsx`

- [ ] **Step 1** — `TripPanel.tsx`: the collect figure becomes `trip.fareRwf - trip.promoDiscountRwf` (null stays null); under it, when `trip.promoDiscountRwf > 0`, a caption "Promo applied: Nova covers {money(promoDiscountRwf)}". `ReceiptSheet.tsx`: the big total becomes `result.receipt.paidRwf ?? result.receipt.totalRwf`; the Promo line renders from the lines list (negative amount shown as "−500").
- [ ] **Step 2: Check** `npx tsc --noEmit` in the rider app; screenshot the trip panel for a promo trip.
- [ ] **Step 3: Commit** — `feat(rider): collect the amount after a promo; Nova covers the rest`

---

### Task 9: Live rollout

- [ ] **Step 1** — `pnpm verify`, `npx supabase test db`, dashboard build: all green.
- [ ] **Step 2** — `npx supabase db push --linked --dry-run` (expect 0064–0066), then `--yes`; `npx supabase functions deploy quote complete-trip --project-ref iwlolxlaxotooqvfvuvy`.
- [ ] **Step 3** — live smoke test with a throwaway passenger: create a code with the service key, add it, quote with it (expect `payRwf` = amount − discount), clean up the user, quotes and code.
- [ ] **Step 4** — push the branch; EAS preview builds for both apps (version 4); send the two APK links.
