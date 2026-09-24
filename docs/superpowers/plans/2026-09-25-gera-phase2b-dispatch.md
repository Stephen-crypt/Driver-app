# Gera — Phase 2b: Dispatch, Offers & the Simulation Harness

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A requested trip finds a driver on its own — candidates narrowed by PostGIS, ranked by ETA, offered one at a time with a 15-second exclusive window, expired offers swept automatically — and a simulation harness proves it end to end without a single real driver.

**Architecture:** A dispatcher Edge Function runs as `service_role` but reaches the database only through narrow, purpose-built RPCs, never raw tables — because `service_role` bypasses RLS, so its constraint has to come from a small surface rather than from trust. Candidate narrowing is PostGIS; ranking is TypeScript behind an `EtaProvider` interface so Google Distance Matrix drops in later without touching dispatch logic. Offers are sequential and race-safe by construction.

**Tech Stack:** Postgres 15 + PostGIS 3.3.7 + pg_cron 1.6.4, Supabase Edge Functions (Deno), TypeScript, Vitest, pgTAP.

**Spec:** `docs/superpowers/specs/2026-09-24-gera-core-trip-loop-design.md` (sections 3.2 location pipeline, 3.3 matching and dispatch)

**Builds on:** `feat/phase2a-fare-trips-ledger` (22 commits, green: `pnpm verify` 0, pgTAP 12 files / 126 assertions, `pnpm e2e` 15 checks).

## Global Constraints

- **Money is integer RWF.** No circulating subunit. `commission_pct` is the sanctioned `numeric` exception.
- **Spatial columns are `geography(Point, 4326)`** — never `geometry`. Distances come out in metres with no projection choice.
- **Timestamps are `timestamptz`**, server-generated.
- **`trips.state` changes only through `trip_transition()` or `trip_transition_system()`.** `trips_guard_state_trg` rejects anything else, and clients hold no INSERT/UPDATE/DELETE on `trips` at all as of migration `0015`.
- **`ledger_entries` is append-only**, enforced by triggers and revokes.
- **A rule the database enforces lives in the database, mirrored in TypeScript only with a parity test.** Established for the transition table (Phase 1) and the fare maths (Phase 2a). Any new rule expressed in both languages gets a parity test in the same task that creates it — no exceptions.
- **Grants must name `anon` explicitly.** `revoke ... from public` does NOT remove it under Supabase's `ALTER DEFAULT PRIVILEGES`. This has been a Critical finding three times in this project.
- **The Supabase CLI prints JSON errors and still exits 0.** Judge by output text; `"_tag":"Error"` means failure.
- TypeScript `strict: true`, no `any`. `packages/core` keeps zero runtime dependencies.
- **`pnpm bundle:core` must be re-run whenever `packages/core` changes.** `pnpm verify` runs the freshness test and will catch a stale bundle.
- Commit messages use Conventional Commits and end with:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

---

## File Structure

| Path | Responsibility |
|---|---|
| `supabase/migrations/0016_platform_settings.sql` | Single-row settings; `driver_balance()`; go-online gate |
| `supabase/migrations/0017_matching.sql` | Class-aware dispatch index; `find_candidate_drivers()` |
| `supabase/migrations/0018_offers.sql` | `create_trip_offer()`, `accept_offer()`, `decline_offer()` |
| `supabase/migrations/0019_offer_sweeper.sql` | `expire_stale_offers()` + the pg_cron schedule |
| `packages/core/src/dispatch/eta.ts` | `EtaProvider`, straight-line implementation, offer constants |
| `supabase/functions/dispatch/index.ts` | Orchestration: narrow → rank → offer next |
| `scripts/simulate-drivers.mjs` | Virtual drivers moving on Kigali geometry |
| `scripts/e2e-dispatch.mjs` | End-to-end: request → auto-dispatch → accept → complete |

---

## Task 1: Platform settings, the SQL balance function, and the go-online gate

Spec 3.5 requires a driver below a minimum wallet balance to be unable to go online. `canGoOnline` and `balanceOf` exist in `packages/core`, are unit-tested, and are imported by nothing. The final review also flagged that the credit/debit classification is now written three times (`packages/core`, `008_ledger_immutable.test.sql`, `e2e-trip-loop.mjs`) with nothing guarding it — this gate would be the fourth copy.

**Files:**
- Create: `supabase/migrations/0016_platform_settings.sql`
- Create: `supabase/tests/013_balance_gate.test.sql`
- Create: `packages/core/test/ledger/sql-parity.test.ts`

**Interfaces:**
- Consumes: `ledger_entries`, `driver_presence`, `balanceOf`/`canGoOnline` from `packages/core`
- Produces:
  - `public.platform_settings` — single row, `min_driver_balance_rwf integer`
  - `public.driver_balance(p_driver_id uuid) returns integer`
  - `public.can_go_online(p_driver_id uuid) returns boolean`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0016_platform_settings.sql`:

```sql
-- Single-row settings table. A magic number buried in a function is a number
-- nobody can change without a migration; this is the smallest thing that is
-- both explicit and adjustable by ops.
create table public.platform_settings (
  id                     boolean primary key default true check (id),
  min_driver_balance_rwf integer not null check (min_driver_balance_rwf >= 0),
  updated_at             timestamptz not null default now()
);

insert into public.platform_settings (min_driver_balance_rwf) values (500);

alter table public.platform_settings enable row level security;

create policy platform_settings_read_all on public.platform_settings
  for select using (true);

revoke insert, update, delete, truncate on public.platform_settings
  from anon, authenticated;

-- Mirrors balanceOf() in packages/core/src/ledger/commission.ts.
-- Kept honest by packages/core/test/ledger/sql-parity.test.ts.
-- Credits are topup_credit and adjustment_credit; everything else is a debit.
create or replace function public.driver_balance(p_driver_id uuid)
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
create or replace function public.can_go_online(p_driver_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.driver_balance(p_driver_id)
         >= (select min_driver_balance_rwf from public.platform_settings);
$$;

revoke all on function public.driver_balance(uuid) from public, anon;
revoke all on function public.can_go_online(uuid) from public, anon;
grant execute on function public.driver_balance(uuid) to authenticated, service_role;
grant execute on function public.can_go_online(uuid) to authenticated, service_role;

-- Spec 3.5: below the minimum, a driver cannot go online. The presence policy
-- already required `verified`; this adds the wallet condition to the same
-- with-check, so reads stay owner-scoped and only writes are gated.
drop policy if exists presence_owner_all on public.driver_presence;

create policy presence_owner_all on public.driver_presence
  for all
  using (driver_id = auth.uid())
  with check (
    driver_id = auth.uid()
    and exists (
      select 1 from public.drivers d
       where d.id = auth.uid() and d.verification = 'verified'
    )
    and public.can_go_online(auth.uid())
  );
```

- [ ] **Step 2: Apply and read the output**

Run: `pnpm dlx supabase@latest db reset`
Expected: 16 migrations apply, no `"_tag":"Error"`.

- [ ] **Step 3: Write the pgTAP test**

Create `supabase/tests/013_balance_gate.test.sql`:

```sql
begin;
select plan(6);

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000','b0000000-0000-4000-8000-000000000001',
   'authenticated','authenticated','poor.driver@test.local'),
  ('00000000-0000-0000-0000-000000000000','b0000000-0000-4000-8000-000000000002',
   'authenticated','authenticated','rich.driver@test.local');

insert into public.profiles (id, role, first_name, phone) values
  ('b0000000-0000-4000-8000-000000000001','driver','Poor','+250788930001'),
  ('b0000000-0000-4000-8000-000000000002','driver','Rich','+250788930002');

insert into public.drivers (id, verification) values
  ('b0000000-0000-4000-8000-000000000001','verified'),
  ('b0000000-0000-4000-8000-000000000002','verified');

-- Poor: 400 credited then 100 debited = 300, below the 500 minimum.
insert into public.ledger_entries (driver_id, kind, amount_rwf) values
  ('b0000000-0000-4000-8000-000000000001','topup_credit',400),
  ('b0000000-0000-4000-8000-000000000001','commission_debit',100),
  ('b0000000-0000-4000-8000-000000000002','topup_credit',5000);

select is(public.driver_balance('b0000000-0000-4000-8000-000000000001'), 300,
  'credits add and debits subtract');

select is(public.driver_balance('b0000000-0000-4000-8000-000000000002'), 5000,
  'a driver with only a top-up has that balance');

select is(public.driver_balance('b0000000-0000-4000-8000-000000000002'), 5000,
  'balance is derived, never stored');

select ok(not public.can_go_online('b0000000-0000-4000-8000-000000000001'),
  'a driver below the minimum cannot go online');

select ok(public.can_go_online('b0000000-0000-4000-8000-000000000002'),
  'a driver above the minimum can go online');

set local role authenticated;
set local request.jwt.claims to
  '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}';

select throws_ok(
  $$ insert into public.driver_presence (driver_id, status, vehicle_class, position)
     values ('b0000000-0000-4000-8000-000000000001','online','moto',
             st_point(30.0619,-1.9441)::geography) $$,
  '42501', null,
  'an underfunded driver is refused entry to the dispatch index'
);

select * from finish();
rollback;
```

- [ ] **Step 4: Run the database tests**

Run: `pnpm dlx supabase@latest test db`
Expected: 13 files, all pass. Report the assertion count you actually see.

- [ ] **Step 5: Write the parity test**

Create `packages/core/test/ledger/sql-parity.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { balanceOf, canGoOnline, type LedgerEntry } from "../../src/ledger/commission";

const DB_CONTAINER = process.env.GERA_DB_CONTAINER ?? "supabase_db_driver_app";

function sql(query: string): string {
  return execFileSync("docker", [
    "exec", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-c", query,
  ]).toString().trim();
}

/**
 * The credit/debit classification exists in TypeScript (for the apps) and in
 * SQL (for the go-online gate, which the database must enforce). Duplication is
 * deliberate; this test is what makes drift between them impossible.
 */
describe("driver_balance SQL mirrors balanceOf", () => {
  const cases: { label: string; entries: LedgerEntry[] }[] = [
    { label: "empty", entries: [] },
    { label: "single top-up", entries: [{ kind: "topup_credit", amountRwf: 5000 }] },
    {
      label: "top-up minus commission",
      entries: [
        { kind: "topup_credit", amountRwf: 5000 },
        { kind: "commission_debit", amountRwf: 255 },
      ],
    },
    {
      label: "all four kinds",
      entries: [
        { kind: "topup_credit", amountRwf: 1000 },
        { kind: "adjustment_credit", amountRwf: 100 },
        { kind: "commission_debit", amountRwf: 400 },
        { kind: "adjustment_debit", amountRwf: 50 },
      ],
    },
    {
      label: "in arrears",
      entries: [
        { kind: "topup_credit", amountRwf: 100 },
        { kind: "commission_debit", amountRwf: 300 },
      ],
    },
  ];

  for (const { label, entries } of cases) {
    it(`agrees with SQL: ${label}`, () => {
      const rows = entries
        .map((e) => `('11111111-2222-4333-8444-555555555555','${e.kind}',${e.amountRwf})`)
        .join(",");

      const insert = rows
        ? `insert into public.ledger_entries (driver_id, kind, amount_rwf) values ${rows};`
        : "";

      const out = sql(`
        begin;
        insert into auth.users (instance_id,id,aud,role,email) values
          ('00000000-0000-0000-0000-000000000000',
           '11111111-2222-4333-8444-555555555555',
           'authenticated','authenticated','parity@test.local');
        insert into public.profiles (id,role,first_name,phone) values
          ('11111111-2222-4333-8444-555555555555','driver','P','+250788999001');
        insert into public.drivers (id,verification) values
          ('11111111-2222-4333-8444-555555555555','verified');
        ${insert}
        select public.driver_balance('11111111-2222-4333-8444-555555555555');
        rollback;
      `);

      const sqlBalance = Number(out.split("\n").filter(Boolean).pop());
      expect(sqlBalance).toBe(balanceOf(entries));
    });
  }

  it("agrees with SQL on the go-online threshold", () => {
    const out = sql(`select min_driver_balance_rwf from public.platform_settings;`);
    const minimum = Number(out);
    expect(canGoOnline(minimum, minimum)).toBe(true);
    expect(canGoOnline(minimum - 1, minimum)).toBe(false);
  });
});
```

- [ ] **Step 6: Run it and commit**

Run: `pnpm --filter @gera/core test`
Expected: the six new parity tests pass alongside the existing suite.

```bash
git add supabase packages/core
git commit -m "feat(db): gate going online on the driver wallet balance

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Class-aware dispatch index and candidate matching

**Files:**
- Create: `supabase/migrations/0017_matching.sql`
- Create: `supabase/tests/014_matching.test.sql`

**Interfaces:**
- Consumes: `driver_presence`, `drivers`
- Produces:
  - `public.find_candidate_drivers(p_pickup geography, p_class vehicle_class, p_radius_m integer, p_limit integer) returns table (driver_id uuid, distance_m double precision)`
  - `public.find_candidates_for_trip(p_trip_id uuid, p_radius_m integer, p_limit integer) returns table (driver_id uuid, distance_m double precision)` — the trip-keyed wrapper the dispatcher actually calls

**Why the index changes:** the existing `driver_presence_dispatchable_idx` is GiST on `position` filtered to `status = 'online'`, but matching also filters on `vehicle_class`, so the index does not cover the query it exists for. A moto request would scan cab drivers too.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0017_matching.sql`:

```sql
-- The old index filtered on status only, so a moto request still walked every
-- online cab. Including vehicle_class in the index makes the partial index
-- actually cover the dispatch query.
drop index if exists public.driver_presence_dispatchable_idx;

create index driver_presence_dispatchable_idx
  on public.driver_presence
  using gist (position, vehicle_class)
  where status = 'online';

-- Stage one of dispatch (spec 3.3): narrow by geography. Straight-line distance
-- misranks in Kigali because of the hills and one-way streets, so this returns
-- a CANDIDATE SET for the caller to rank by real ETA - it is not the answer.
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

-- Trip-keyed wrapper. The dispatcher must never read a geography column out of
-- PostgREST and hand it back as a parameter - the text round-trip is a format
-- guess waiting to fail. It passes a trip id; the pickup never leaves the
-- database.
create or replace function public.find_candidates_for_trip(
  p_trip_id  uuid,
  p_radius_m integer,
  p_limit    integer
) returns table (driver_id uuid, distance_m double precision)
language sql
stable
security definer
set search_path = public
as $$
  select c.driver_id, c.distance_m
    from public.trips t
    cross join lateral public.find_candidate_drivers(
      t.pickup, t.vehicle_class, p_radius_m, p_limit) c
   where t.id = p_trip_id;
$$;

revoke all on function public.find_candidates_for_trip(uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.find_candidates_for_trip(uuid, integer, integer)
  to service_role;
```

- [ ] **Step 2: Apply**

Run: `pnpm dlx supabase@latest db reset`
Expected: 17 migrations apply cleanly.

- [ ] **Step 3: Write the pgTAP test**

Create `supabase/tests/014_matching.test.sql`:

```sql
begin;
select plan(7);

-- Kimironko market as the pickup.
-- near      : ~300m away, moto, online, verified, fresh heartbeat  -> candidate
-- far       : ~5km away                                            -> outside radius
-- cab       : next to `near` but a cab                             -> wrong class
-- stale     : next to `near`, heartbeat 2 minutes old              -> app is dead
-- unverified: next to `near`, verification 'submitted'             -> not vetted
-- busy      : next to `near`, already on a trip                    -> committed
insert into auth.users (instance_id, id, aud, role, email)
select '00000000-0000-0000-0000-000000000000',
       ('d0000000-0000-4000-8000-00000000000' || n)::uuid,
       'authenticated','authenticated','m' || n || '@test.local'
  from generate_series(1,7) n;

insert into public.profiles (id, role, first_name, phone)
select ('d0000000-0000-4000-8000-00000000000' || n)::uuid,
       case when n = 7 then 'rider' else 'driver' end,
       'D' || n, '+25078894000' || n
  from generate_series(1,7) n;

insert into public.drivers (id, verification)
select ('d0000000-0000-4000-8000-00000000000' || n)::uuid,
       case when n = 5 then 'submitted'::verification_status else 'verified'::verification_status end
  from generate_series(1,6) n;

insert into public.ledger_entries (driver_id, kind, amount_rwf)
select ('d0000000-0000-4000-8000-00000000000' || n)::uuid, 'topup_credit', 5000
  from generate_series(1,6) n;

insert into public.driver_presence (driver_id, status, vehicle_class, position, heartbeat_at) values
  ('d0000000-0000-4000-8000-000000000001','online','moto', st_point(30.0650,-1.9441)::geography, now()),
  ('d0000000-0000-4000-8000-000000000002','online','moto', st_point(30.1200,-1.9441)::geography, now()),
  ('d0000000-0000-4000-8000-000000000003','online','cab',  st_point(30.0650,-1.9441)::geography, now()),
  ('d0000000-0000-4000-8000-000000000004','online','moto', st_point(30.0650,-1.9441)::geography, now() - interval '2 minutes'),
  ('d0000000-0000-4000-8000-000000000005','online','moto', st_point(30.0650,-1.9441)::geography, now()),
  ('d0000000-0000-4000-8000-000000000006','online','moto', st_point(30.0650,-1.9441)::geography, now());

insert into public.trips (id, rider_id, driver_id, vehicle_class, state,
                          pickup, pickup_label, dropoff, dropoff_label)
values ('d1000000-0000-4000-8000-000000000001',
        'd0000000-0000-4000-8000-000000000007','d0000000-0000-4000-8000-000000000006',
        'moto','accepted',
        st_point(30.0619,-1.9441)::geography,'X',
        st_point(30.0588,-1.9536)::geography,'Y');

select is(
  (select count(*)::int from public.find_candidate_drivers(
     st_point(30.0619,-1.9441)::geography, 'moto', 2000, 10)),
  1,
  'exactly one driver survives every filter'
);

select is(
  (select driver_id from public.find_candidate_drivers(
     st_point(30.0619,-1.9441)::geography, 'moto', 2000, 10)),
  'd0000000-0000-4000-8000-000000000001'::uuid,
  'and it is the near, fresh, verified, idle moto'
);

select ok(
  (select distance_m from public.find_candidate_drivers(
     st_point(30.0619,-1.9441)::geography, 'moto', 2000, 10)) < 500,
  'the reported distance is in metres, not degrees'
);

select is(
  (select count(*)::int from public.find_candidate_drivers(
     st_point(30.0619,-1.9441)::geography, 'moto', 20000, 10)),
  2,
  'widening the radius reaches the far driver'
);

select is(
  (select count(*)::int from public.find_candidate_drivers(
     st_point(30.0619,-1.9441)::geography, 'cab', 2000, 10)),
  1,
  'a cab request matches the cab, not the motos'
);

select is(
  (select count(*)::int from public.find_candidate_drivers(
     st_point(30.0619,-1.9441)::geography, 'moto', 20000, 1)),
  1,
  'the limit is respected'
);

select ok(
  not has_function_privilege('authenticated',
    'public.find_candidate_drivers(geography,vehicle_class,integer,integer)', 'EXECUTE'),
  'riders cannot enumerate nearby drivers'
);

-- The wrapper must agree with the function it wraps, or the dispatcher and the
-- tests are measuring different things.
select is(
  (select count(*)::int from public.find_candidates_for_trip(
     'd1000000-0000-4000-8000-000000000001', 20000, 10)),
  (select count(*)::int from public.find_candidate_drivers(
     st_point(30.0619,-1.9441)::geography, 'moto', 20000, 10)),
  'the trip-keyed wrapper returns what the geography form returns'
);

select * from finish();
rollback;
```

Note the wrapper assertion reuses the busy driver's trip, whose pickup is the same point — so both calls must see the same candidate set. Raise `plan(7)` to `plan(8)`.

- [ ] **Step 4: Run and commit**

Run: `pnpm dlx supabase@latest test db`
Expected: 14 files, all pass.

```bash
git add supabase
git commit -m "feat(db): narrow dispatch candidates with a class-aware PostGIS index

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: ETA estimation behind a provider interface

**Files:**
- Create: `packages/core/src/dispatch/eta.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/dispatch/eta.test.ts`

**Interfaces:**
- Consumes: `VehicleClass` from `packages/core/src/fare/policy.ts`
- Produces:
  - `OFFER_TTL_SECONDS = 15`
  - `DISPATCH_RADII_M = [1000, 2000, 4000] as const`
  - `CANDIDATE_SHORTLIST = 5`
  - `AVERAGE_SPEED_MPS: Record<VehicleClass, number>`
  - `EtaProvider = { estimate(distanceMetres: number, vehicleClass: VehicleClass): Promise<number> }`
  - `straightLineEta: EtaProvider`
  - `rankByEta<T extends { driverId: string; distanceM: number }>(candidates, vehicleClass, provider): Promise<(T & { etaSeconds: number })[]>`

**Why an interface:** spec 3.3 wants real road ETAs from Google Distance Matrix for the top five candidates, because straight-line distance misranks in Kigali. There is no Google key yet, so the straight-line implementation ships now and Google drops in behind the same interface — exactly as `PaymentProvider` defers MTN MoMo. The cost-control rule (ETAs for five candidates, not fifty) lives in `CANDIDATE_SHORTLIST` so it survives the swap.

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/dispatch/eta.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  OFFER_TTL_SECONDS,
  DISPATCH_RADII_M,
  CANDIDATE_SHORTLIST,
  straightLineEta,
  rankByEta,
} from "../../src/dispatch/eta";

describe("dispatch constants", () => {
  it("offers are exclusive for fifteen seconds", () => {
    expect(OFFER_TTL_SECONDS).toBe(15);
  });

  it("the search widens 1km, 2km, 4km", () => {
    expect([...DISPATCH_RADII_M]).toEqual([1000, 2000, 4000]);
  });

  it("only five candidates get a real ETA lookup", () => {
    expect(CANDIDATE_SHORTLIST).toBe(5);
  });
});

describe("straightLineEta", () => {
  it("is longer for a cab than a moto over the same distance", async () => {
    const moto = await straightLineEta.estimate(4000, "moto");
    const cab = await straightLineEta.estimate(4000, "cab");
    expect(cab).toBeGreaterThan(moto);
  });

  it("returns whole seconds", async () => {
    const eta = await straightLineEta.estimate(3333, "moto");
    expect(Number.isInteger(eta)).toBe(true);
  });

  it("is zero for a zero-distance trip", async () => {
    expect(await straightLineEta.estimate(0, "moto")).toBe(0);
  });

  it("rejects a negative distance", async () => {
    await expect(straightLineEta.estimate(-1, "moto")).rejects.toThrow(
      "distanceMetres must be >= 0",
    );
  });
});

describe("rankByEta", () => {
  it("orders by ETA, not by the order it was given", async () => {
    const ranked = await rankByEta(
      [
        { driverId: "far", distanceM: 3000 },
        { driverId: "near", distanceM: 500 },
        { driverId: "mid", distanceM: 1500 },
      ],
      "moto",
      straightLineEta,
    );
    expect(ranked.map((r) => r.driverId)).toEqual(["near", "mid", "far"]);
  });

  it("attaches the eta it ranked on", async () => {
    const ranked = await rankByEta([{ driverId: "a", distanceM: 1000 }], "moto", straightLineEta);
    expect(ranked[0]?.etaSeconds).toBeGreaterThan(0);
  });

  it("returns an empty list unchanged", async () => {
    expect(await rankByEta([], "moto", straightLineEta)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gera/core test`
Expected: FAIL — cannot resolve `../../src/dispatch/eta`.

- [ ] **Step 3: Implement**

Create `packages/core/src/dispatch/eta.ts`:

```ts
import type { VehicleClass } from "../fare/policy";

/** A driver holds an exclusive offer for this long before it passes on. */
export const OFFER_TTL_SECONDS = 15;

/** The search widens only when a stage finds nobody (spec 3.3). */
export const DISPATCH_RADII_M = [1000, 2000, 4000] as const;

/**
 * Only this many candidates get a real ETA lookup. Straight-line narrowing is
 * free; road ETAs are billed per call, so the shortlist is the cost control.
 */
export const CANDIDATE_SHORTLIST = 5;

/**
 * Rough Kigali averages including stops. A moto filters through traffic a car
 * cannot, which is most of why motos dominate the city.
 */
export const AVERAGE_SPEED_MPS: Record<VehicleClass, number> = {
  moto: 7.5,
  cab: 5.5,
  cab_xl: 5.0,
};

export interface EtaProvider {
  estimate(distanceMetres: number, vehicleClass: VehicleClass): Promise<number>;
}

/**
 * Distance over an average speed. Deliberately crude: spec 3.3 calls for Google
 * Distance Matrix on the shortlist, because terrain and one-way streets make
 * straight-line ranking wrong in Kigali. This ships until a key exists, and the
 * real provider replaces it without dispatch logic changing.
 */
export const straightLineEta: EtaProvider = {
  estimate(distanceMetres: number, vehicleClass: VehicleClass): Promise<number> {
    if (distanceMetres < 0) {
      return Promise.reject(new Error("distanceMetres must be >= 0"));
    }
    return Promise.resolve(Math.round(distanceMetres / AVERAGE_SPEED_MPS[vehicleClass]));
  },
};

export async function rankByEta<T extends { driverId: string; distanceM: number }>(
  candidates: readonly T[],
  vehicleClass: VehicleClass,
  provider: EtaProvider,
): Promise<(T & { etaSeconds: number })[]> {
  const withEta = await Promise.all(
    candidates.map(async (c) => ({
      ...c,
      etaSeconds: await provider.estimate(c.distanceM, vehicleClass),
    })),
  );
  return withEta.sort((a, b) => a.etaSeconds - b.etaSeconds);
}
```

- [ ] **Step 4: Export from the package AND from the Deno surface**

Add to `packages/core/src/index.ts`:

```ts
export * from "./dispatch/eta";
```

**`supabase/functions/_shared/core.ts` re-exports an explicit list, not a wildcard, so new symbols do not appear there on their own.** Task 6's dispatcher imports these from it, and will fail to resolve without this step. Add the runtime values to its export block:

```ts
  OFFER_TTL_SECONDS,
  DISPATCH_RADII_M,
  CANDIDATE_SHORTLIST,
  AVERAGE_SPEED_MPS,
  straightLineEta,
  rankByEta,
```

and the types to its `export type` block:

```ts
  EtaProvider,
```

Then add matching declarations to `supabase/functions/_shared/core.bundle.d.ts` — it is hand-written, so new exports must be declared there too or the Deno typecheck fails. Mirror the signatures from `eta.ts` exactly; the mutual-assignability guard in `core_test.ts` is what catches a mismatch.

Run: `pnpm --filter @gera/core test && pnpm --filter @gera/core typecheck`
Expected: both PASS.

Run: `pnpm bundle:core`
This is required — the Edge Function consumes `packages/core` through the generated bundle, and `pnpm verify` fails on a stale one.

Run: `pnpm verify`
Expected: exit 0.

```bash
git add packages/core supabase/functions/_shared/core.bundle.js
git commit -m "feat(core): estimate driver ETAs behind a provider interface

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Offers — create, accept, decline

**Files:**
- Create: `supabase/migrations/0018_offers.sql`
- Create: `supabase/tests/015_offers.test.sql`

**Interfaces:**
- Consumes: `trip_offers`, `assign_driver_to_trip()`, `trip_transition()`
- Produces:
  - `public.create_trip_offer(p_trip_id uuid, p_driver_id uuid, p_rank integer, p_eta_seconds integer, p_ttl_seconds integer, p_idempotency_key text) returns public.trip_offers`
  - `public.accept_offer(p_offer_id uuid, p_idempotency_key text) returns public.trips`
  - `public.decline_offer(p_offer_id uuid) returns public.trip_offers`

**The race that must be impossible (spec 3.3):** acceptance is a conditional UPDATE inside a transaction. Two drivers cannot both win, and a driver cannot accept an offer that has expired or already been resolved. Broadcasting one trip to twenty drivers produces one winner and nineteen irritated drivers — sequential offers exist to protect the supply side the whole strategy depends on.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0018_offers.sql`:

```sql
-- One live offer per trip at a time. The partial unique index is what makes
-- "sequential" a property of the schema rather than a property of the caller.
create unique index trip_offers_one_live_per_trip
  on public.trip_offers (trip_id)
  where outcome is null;

create index trip_offers_expiry_idx on public.trip_offers (expires_at)
  where outcome is null;

-- Dispatcher-only. Creates the offer row and moves the trip to `offered`,
-- attaching the driver via the existing seam.
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

  -- Idempotent: a retried dispatch must not create a second live offer.
  select * into v_offer from public.trip_offers
   where trip_id = p_trip_id and outcome is null;
  if found then
    return v_offer;
  end if;

  insert into public.trip_offers (trip_id, driver_id, rank, eta_seconds, expires_at)
  values (p_trip_id, p_driver_id, p_rank, p_eta_seconds,
          now() + make_interval(secs => p_ttl_seconds))
  returning * into v_offer;

  perform public.assign_driver_to_trip(p_trip_id, p_driver_id, p_idempotency_key);

  return v_offer;
end;
$$;

-- Called by the driver. The conditional UPDATE is the whole race protection:
-- it matches only an unresolved, unexpired offer belonging to this caller.
create or replace function public.accept_offer(
  p_offer_id        uuid,
  p_idempotency_key text
) returns public.trips
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer public.trip_offers;
begin
  update public.trip_offers
     set outcome = 'accepted'
   where id = p_offer_id
     and driver_id = auth.uid()
     and outcome is null
     and expires_at > now()
  returning * into v_offer;

  if not found then
    raise exception 'offer_not_available' using errcode = '42501';
  end if;

  return public.trip_transition(v_offer.trip_id, 'accepted', p_idempotency_key,
                                jsonb_build_object('offer_id', p_offer_id));
end;
$$;

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
  returning * into v_offer;

  if not found then
    raise exception 'offer_not_available' using errcode = '42501';
  end if;

  return v_offer;
end;
$$;

revoke all on function public.create_trip_offer(uuid, uuid, integer, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.create_trip_offer(uuid, uuid, integer, integer, integer, text)
  to service_role;

revoke all on function public.accept_offer(uuid, text) from public, anon;
grant execute on function public.accept_offer(uuid, text) to authenticated;

revoke all on function public.decline_offer(uuid) from public, anon;
grant execute on function public.decline_offer(uuid) to authenticated;

-- NOTE: `trip_offers_select_own` already exists from migration 0007 and grants
-- exactly this read. Do not add a second select policy - policies OR together,
-- so a duplicate adds no protection and hides which one is load-bearing.
revoke insert, update, delete, truncate on public.trip_offers
  from anon, authenticated;
```

- [ ] **Step 2: Apply**

Run: `pnpm dlx supabase@latest db reset`
Expected: 18 migrations apply cleanly.

- [ ] **Step 3: Write the pgTAP test**

Create `supabase/tests/015_offers.test.sql`:

```sql
begin;
select plan(9);

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000','e0000000-0000-4000-8000-000000000001',
   'authenticated','authenticated','o.rider@test.local'),
  ('00000000-0000-0000-0000-000000000000','e0000000-0000-4000-8000-000000000002',
   'authenticated','authenticated','o.driver1@test.local'),
  ('00000000-0000-0000-0000-000000000000','e0000000-0000-4000-8000-000000000003',
   'authenticated','authenticated','o.driver2@test.local');

insert into public.profiles (id, role, first_name, phone) values
  ('e0000000-0000-4000-8000-000000000001','rider','Aline','+250788950001'),
  ('e0000000-0000-4000-8000-000000000002','driver','Eric','+250788950002'),
  ('e0000000-0000-4000-8000-000000000003','driver','Jean','+250788950003');

insert into public.drivers (id, verification) values
  ('e0000000-0000-4000-8000-000000000002','verified'),
  ('e0000000-0000-4000-8000-000000000003','verified');

insert into public.trips (id, rider_id, vehicle_class, state,
                          pickup, pickup_label, dropoff, dropoff_label)
values ('e1000000-0000-4000-8000-000000000001',
        'e0000000-0000-4000-8000-000000000001','moto','requested',
        st_point(30.0619,-1.9441)::geography,'Kimironko',
        st_point(30.0588,-1.9536)::geography,'Heights');

select lives_ok(
  $$ select public.create_trip_offer('e1000000-0000-4000-8000-000000000001',
       'e0000000-0000-4000-8000-000000000002', 1, 120, 15, 'offer-1') $$,
  'the dispatcher creates an offer'
);

select is(
  (select state::text from public.trips where id='e1000000-0000-4000-8000-000000000001'),
  'offered',
  'creating an offer moves the trip to offered'
);

select is(
  (select count(*)::int from public.trip_offers
    where trip_id='e1000000-0000-4000-8000-000000000001' and outcome is null),
  1,
  'exactly one live offer exists'
);

select lives_ok(
  $$ select public.create_trip_offer('e1000000-0000-4000-8000-000000000001',
       'e0000000-0000-4000-8000-000000000003', 2, 90, 15, 'offer-2') $$,
  'a retried dispatch does not raise'
);

select is(
  (select driver_id from public.trip_offers
    where trip_id='e1000000-0000-4000-8000-000000000001' and outcome is null),
  'e0000000-0000-4000-8000-000000000002'::uuid,
  'and it does NOT steal the live offer from the first driver'
);

set local role authenticated;
set local request.jwt.claims to
  '{"sub":"e0000000-0000-4000-8000-000000000003","role":"authenticated"}';

select throws_ok(
  $$ select public.accept_offer(
       (select id from public.trip_offers
         where trip_id='e1000000-0000-4000-8000-000000000001' and outcome is null),
       'accept-wrong') $$,
  '42501', null,
  'a driver cannot accept an offer addressed to someone else'
);

set local request.jwt.claims to
  '{"sub":"e0000000-0000-4000-8000-000000000002","role":"authenticated"}';

select is(
  (select state::text from public.accept_offer(
     (select id from public.trip_offers
       where trip_id='e1000000-0000-4000-8000-000000000001' and outcome is null),
     'accept-1')),
  'accepted',
  'the offered driver accepts and the trip advances'
);

select is(
  (select outcome from public.trip_offers
    where trip_id='e1000000-0000-4000-8000-000000000001'),
  'accepted',
  'the offer records its outcome'
);

select throws_ok(
  $$ select public.accept_offer(
       (select id from public.trip_offers
         where trip_id='e1000000-0000-4000-8000-000000000001'),
       'accept-again') $$,
  '42501', null,
  'an already-resolved offer cannot be accepted twice'
);

select * from finish();
rollback;
```

- [ ] **Step 4: Run and commit**

Run: `pnpm dlx supabase@latest test db`
Expected: 15 files, all pass.

```bash
git add supabase
git commit -m "feat(db): sequential trip offers with race-safe acceptance

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: The expiry sweeper

**Files:**
- Create: `supabase/migrations/0019_offer_sweeper.sql`
- Create: `supabase/tests/016_sweeper.test.sql`

**Interfaces:**
- Consumes: `trip_offers`
- Produces: `public.expire_stale_offers() returns integer` plus a pg_cron schedule

**Why a sweeper and not a timer:** an offer that nobody accepts must free the trip for the next candidate even if the dispatcher process died. Expiry belongs to the database, not to whoever happened to create the offer.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0019_offer_sweeper.sql`:

```sql
-- Marks every offer whose window has closed. Returns the count so the caller
-- (and the cron job log) can see whether dispatch is healthy.
create or replace function public.expire_stale_offers()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.trip_offers
     set outcome = 'timed_out'
   where outcome is null
     and expires_at <= now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.expire_stale_offers() from public, anon, authenticated;
grant execute on function public.expire_stale_offers() to service_role;

-- Every ten seconds: the offer window is fifteen, so a timed-out offer frees
-- its trip well inside the rider's patience.
select cron.schedule(
  'gera-expire-stale-offers',
  '10 seconds',
  $$ select public.expire_stale_offers(); $$
);
```

- [ ] **Step 2: Apply and confirm the job exists**

Run: `pnpm dlx supabase@latest db reset`
Then: `docker exec supabase_db_driver_app psql -U postgres -d postgres -c "select jobname, schedule from cron.job;"`
Expected: the migration applies and `gera-expire-stale-offers` is listed. If `cron.schedule` fails with a `10 seconds` interval on this pg_cron version, fall back to `'* * * * *'` (once a minute), say so in your report, and note that the offer window is then swept less promptly than it expires.

- [ ] **Step 3: Write the pgTAP test**

Create `supabase/tests/016_sweeper.test.sql`:

```sql
begin;
select plan(4);

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000','f0000000-0000-4000-8000-000000000001',
   'authenticated','authenticated','s.rider@test.local'),
  ('00000000-0000-0000-0000-000000000000','f0000000-0000-4000-8000-000000000002',
   'authenticated','authenticated','s.driver@test.local');

insert into public.profiles (id, role, first_name, phone) values
  ('f0000000-0000-4000-8000-000000000001','rider','Aline','+250788960001'),
  ('f0000000-0000-4000-8000-000000000002','driver','Eric','+250788960002');

insert into public.drivers (id, verification)
values ('f0000000-0000-4000-8000-000000000002','verified');

insert into public.trips (id, rider_id, vehicle_class, state,
                          pickup, pickup_label, dropoff, dropoff_label)
values ('f1000000-0000-4000-8000-000000000001',
        'f0000000-0000-4000-8000-000000000001','moto','requested',
        st_point(30.0619,-1.9441)::geography,'A',
        st_point(30.0588,-1.9536)::geography,'B');

-- One already past its window, written directly so the test does not sleep.
insert into public.trip_offers (id, trip_id, driver_id, rank, eta_seconds, expires_at)
values ('f2000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001',
        'f0000000-0000-4000-8000-000000000002', 1, 120, now() - interval '1 second');

select is(public.expire_stale_offers(), 1, 'the sweeper reports what it expired');

select is(
  (select outcome from public.trip_offers where id='f2000000-0000-4000-8000-000000000001'),
  'timed_out',
  'the stale offer is marked timed_out'
);

select is(public.expire_stale_offers(), 0, 'a second sweep finds nothing to do');

select ok(
  not has_function_privilege('authenticated', 'public.expire_stale_offers()', 'EXECUTE'),
  'drivers cannot expire their own offers'
);

select * from finish();
rollback;
```

- [ ] **Step 4: Run and commit**

Run: `pnpm dlx supabase@latest test db`
Expected: 16 files, all pass.

```bash
git add supabase
git commit -m "feat(db): sweep expired offers on a schedule

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: The dispatcher

**Files:**
- Create: `supabase/functions/dispatch/index.ts`
- Create: `supabase/functions/dispatch/index_test.ts`

**Interfaces:**
- Consumes: `find_candidate_drivers()`, `create_trip_offer()`, `rankByEta`, `straightLineEta`, `DISPATCH_RADII_M`, `CANDIDATE_SHORTLIST`, `OFFER_TTL_SECONDS`
- Produces: `POST /functions/v1/dispatch` taking `{ tripId }` and returning `{ tripId, offered: boolean, driverId?, rank?, etaSeconds?, radiusM?, reason? }`

**It runs as `service_role`, so it must earn that.** The narrow RPCs are the boundary: it never touches `trips`, `driver_presence` or `ledger_entries` directly. Add no table access to this function.

- [ ] **Step 1: Write the function**

Create `supabase/functions/dispatch/index.ts`:

```ts
import {
  rankByEta,
  straightLineEta,
  DISPATCH_RADII_M,
  CANDIDATE_SHORTLIST,
  OFFER_TTL_SECONDS,
} from "../_shared/core.ts";
import type { VehicleClass } from "../_shared/core.ts";
import { serviceClient, json } from "../_shared/supabase.ts";

interface Candidate {
  driver_id: string;
  distance_m: number;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: { tripId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const tripId = body.tripId;
  if (!tripId) return json({ error: "missing_trip_id" }, 400);

  const svc = serviceClient();

  const { data: trip, error: tripError } = await svc
    .from("trips")
    .select("id, state, vehicle_class")
    .eq("id", tripId)
    .single();

  if (tripError || !trip) return json({ error: "trip_not_found" }, 404);
  if (trip.state !== "requested" && trip.state !== "offered") {
    return json({ error: "trip_not_dispatchable", state: trip.state }, 409);
  }

  // Widen only when a stage finds nobody (spec 3.3). The trip-keyed wrapper
  // keeps the pickup geography inside the database - reading it out and handing
  // it back as a parameter is a text-format guess waiting to fail.
  for (const radiusM of DISPATCH_RADII_M) {
    const { data: candidates, error: matchError } = await svc.rpc("find_candidates_for_trip", {
      p_trip_id: tripId,
      p_radius_m: radiusM,
      p_limit: CANDIDATE_SHORTLIST,
    });

    if (matchError) return json({ error: matchError.message }, 500);

    const rows = (candidates ?? []) as Candidate[];
    if (rows.length === 0) continue;

    const ranked = await rankByEta(
      rows.map((c) => ({ driverId: c.driver_id, distanceM: Number(c.distance_m) })),
      trip.vehicle_class as VehicleClass,
      straightLineEta,
    );

    const best = ranked[0];
    if (!best) continue;

    const { data: offer, error: offerError } = await svc
      .rpc("create_trip_offer", {
        p_trip_id: tripId,
        p_driver_id: best.driverId,
        p_rank: 1,
        p_eta_seconds: best.etaSeconds,
        p_ttl_seconds: OFFER_TTL_SECONDS,
        p_idempotency_key: `offer-${tripId}-${best.driverId}-${Date.now()}`,
      })
      .single();

    if (offerError) return json({ error: offerError.message }, 409);

    return json({
      tripId,
      offered: true,
      offerId: (offer as { id?: string } | null)?.id,
      driverId: best.driverId,
      rank: 1,
      etaSeconds: best.etaSeconds,
      radiusM,
    });
  }

  return json({ tripId, offered: false, reason: "no_drivers_available" });
});
```

- [ ] **Step 2: Write the unit tests**

Create `supabase/functions/dispatch/index_test.ts`:

```ts
import { assertEquals } from "jsr:@std/assert@1";
import {
  rankByEta,
  straightLineEta,
  DISPATCH_RADII_M,
  CANDIDATE_SHORTLIST,
  OFFER_TTL_SECONDS,
} from "../_shared/core.ts";

Deno.test("the shortlist bounds how many ETA lookups dispatch will pay for", () => {
  assertEquals(CANDIDATE_SHORTLIST, 5);
});

Deno.test("the search widens rather than starting wide", () => {
  assertEquals([...DISPATCH_RADII_M], [1000, 2000, 4000]);
});

Deno.test("an offer is exclusive for fifteen seconds", () => {
  assertEquals(OFFER_TTL_SECONDS, 15);
});

Deno.test("the nearest driver is offered first", async () => {
  const ranked = await rankByEta(
    [
      { driverId: "far", distanceM: 3800 },
      { driverId: "near", distanceM: 400 },
    ],
    "moto",
    straightLineEta,
  );
  assertEquals(ranked[0]?.driverId, "near");
});
```

- [ ] **Step 3: Run the tests**

Run: `deno test --allow-read --config supabase/functions/deno.json supabase/functions/dispatch/index_test.ts`
Expected: 4 tests pass.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions
git commit -m "feat(functions): dispatch a trip to its nearest available driver

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: The simulation harness

**Files:**
- Create: `scripts/simulate-drivers.mjs`
- Modify: root `package.json` (add `simulate`)

**Interfaces:**
- Consumes: the running stack, `driver_presence`
- Produces: `pnpm simulate -- --drivers 20 --minutes 2` — N verified, funded drivers going online and moving around Kigali, heartbeating every 5 seconds

**Why it exists (spec 7.4):** matching, dispatch timing and the location firehose cannot be exercised before real drivers exist. This is also the demo environment.

- [ ] **Step 1: Write the harness**

Create `scripts/simulate-drivers.mjs`:

```js
// Spawns virtual drivers around Kigali, sets them online, and moves them on a
// heartbeat so dispatch has something real to match against.
// Local stack only - it writes directly to the database.
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const DB = process.env.GERA_DB_CONTAINER ?? "supabase_db_driver_app";

function psql(sql) {
  return execFileSync("docker", [
    "exec", DB, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-c", sql,
  ]).toString().trim();
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(process.argv[i + 1]);
}

const DRIVERS = arg("drivers", 10);
const MINUTES = arg("minutes", 1);
const TICK_MS = 5000;

// Roughly the built-up area of Kigali.
const LNG_MIN = 30.03, LNG_MAX = 30.13;
const LAT_MIN = -1.99, LAT_MAX = -1.91;

const rand = (lo, hi) => lo + Math.random() * (hi - lo);

const drivers = Array.from({ length: DRIVERS }, (_, i) => ({
  id: crypto.randomUUID(),
  phone: `+2507889${String(700000 + i).slice(-6)}`,
  lng: rand(LNG_MIN, LNG_MAX),
  lat: rand(LAT_MIN, LAT_MAX),
  bearing: rand(0, 2 * Math.PI),
  class: Math.random() < 0.7 ? "moto" : "cab",
}));

console.log(`seeding ${DRIVERS} drivers…`);

const values = drivers
  .map((d) => `('00000000-0000-0000-0000-000000000000','${d.id}','authenticated','authenticated','sim.${d.id}@test.local')`)
  .join(",");

psql(`insert into auth.users (instance_id,id,aud,role,email) values ${values};`);
psql(`insert into public.profiles (id,role,first_name,phone) values ${
  drivers.map((d) => `('${d.id}','driver','Sim','${d.phone}')`).join(",")};`);
psql(`insert into public.drivers (id,verification) values ${
  drivers.map((d) => `('${d.id}','verified')`).join(",")};`);
// Funded above the go-online minimum.
psql(`insert into public.ledger_entries (driver_id,kind,amount_rwf) values ${
  drivers.map((d) => `('${d.id}','topup_credit',5000)`).join(",")};`);
psql(`insert into public.driver_presence (driver_id,status,vehicle_class,position,heartbeat_at) values ${
  drivers.map((d) => `('${d.id}','online','${d.class}',st_point(${d.lng},${d.lat})::geography,now())`).join(",")};`);

console.log(`${DRIVERS} drivers online. Moving for ${MINUTES} minute(s); Ctrl-C to stop.`);

const until = Date.now() + MINUTES * 60_000;

const timer = setInterval(() => {
  if (Date.now() > until) {
    clearInterval(timer);
    console.log("simulation finished. Drivers left online and funded.");
    console.log("Run `supabase db reset` to clear them.");
    return;
  }

  for (const d of drivers) {
    // ~7.5 m/s for a tick, with a small random turn.
    d.bearing += rand(-0.4, 0.4);
    const metres = 7.5 * (TICK_MS / 1000);
    d.lat += (metres * Math.cos(d.bearing)) / 111_320;
    d.lng += (metres * Math.sin(d.bearing)) / (111_320 * Math.cos((d.lat * Math.PI) / 180));
    d.lng = Math.min(Math.max(d.lng, LNG_MIN), LNG_MAX);
    d.lat = Math.min(Math.max(d.lat, LAT_MIN), LAT_MAX);
  }

  const updates = drivers
    .map((d) => `('${d.id}'::uuid, st_point(${d.lng},${d.lat})::geography)`)
    .join(",");

  psql(`update public.driver_presence p
           set position = v.pos, heartbeat_at = now(), updated_at = now()
          from (values ${updates}) as v(id, pos)
         where p.driver_id = v.id;`);

  process.stdout.write(".");
}, TICK_MS);
```

- [ ] **Step 2: Add the script**

In the ROOT `package.json` scripts:

```json
"simulate": "node scripts/simulate-drivers.mjs"
```

- [ ] **Step 3: Run it**

Run: `pnpm simulate -- --drivers 20 --minutes 1`
Expected: 20 drivers seeded and moving. Then confirm they are dispatchable:

```bash
docker exec supabase_db_driver_app psql -U postgres -d postgres -c \
 "select count(*) from public.find_candidate_drivers(st_point(30.08,-1.95)::geography,'moto',4000,10);"
```

Expected: a non-zero count. Paste the real output.

- [ ] **Step 4: Commit**

```bash
git add scripts package.json
git commit -m "test: simulate drivers moving around Kigali

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: End-to-end dispatch

**Files:**
- Create: `scripts/e2e-dispatch.mjs`
- Modify: root `package.json` (add `e2e:dispatch`)

**Interfaces:**
- Consumes: everything above, plus `quote`, `create_trip_from_quote` and `complete-trip` from Phase 2a
- Produces: `pnpm e2e:dispatch` — exits 0 only if a trip is dispatched, offered, accepted and completed without anyone naming a driver

**This is the exit criterion.** Phase 2a's e2e had to hand-pick the driver. This one must not: the dispatcher chooses, or the test fails.

- [ ] **Step 1: Write the script**

Create `scripts/e2e-dispatch.mjs`:

```js
// The full loop with nobody choosing the driver. Local stack only.
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const API = "http://127.0.0.1:54321";
const JWT_SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";
const DB = process.env.GERA_DB_CONTAINER ?? "supabase_db_driver_app";
const ANON = process.env.GERA_ANON_KEY;
const SERVICE = process.env.GERA_SERVICE_KEY;
if (!ANON || !SERVICE) {
  console.error("Set GERA_ANON_KEY and GERA_SERVICE_KEY from `supabase status`.");
  process.exit(1);
}

const RIDER = crypto.randomUUID();
const DRIVER = crypto.randomUUID();
const suffix = String(Math.floor(Math.random() * 1e6)).padStart(6, "0");

const psql = (sql) =>
  execFileSync("docker", [
    "exec", DB, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-c", sql,
  ]).toString().trim();

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function mint(sub) {
  const h = b64({ alg: "HS256", typ: "JWT" });
  const p = b64({ sub, role: "authenticated", aud: "authenticated",
                  exp: Math.floor(Date.now() / 1000) + 3600 });
  const s = crypto.createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${s}`;
}

function check(label, actual, expected) {
  if (String(actual) !== String(expected)) {
    console.error(`FAIL ${label}: expected ${expected}, got ${actual}`);
    process.exit(1);
  }
  console.log(`ok   ${label}`);
}

// Fixtures. No deletes: ledger rows are append-only by design.
psql(`insert into auth.users (instance_id,id,aud,role,email,confirmation_token,recovery_token,email_change_token_new,email_change,created_at,updated_at) values
 ('00000000-0000-0000-0000-000000000000','${RIDER}','authenticated','authenticated','d.rider.${suffix}@test.local','','','','',now(),now()),
 ('00000000-0000-0000-0000-000000000000','${DRIVER}','authenticated','authenticated','d.driver.${suffix}@test.local','','','','',now(),now());`);
psql(`insert into public.profiles (id,role,first_name,phone) values
 ('${RIDER}','rider','Aline','+2507881${suffix}'),
 ('${DRIVER}','driver','Eric','+2507882${suffix}');`);
psql(`insert into public.drivers (id,verification) values ('${DRIVER}','verified');`);
psql(`insert into public.ledger_entries (driver_id,kind,amount_rwf) values ('${DRIVER}','topup_credit',5000);`);
// One moto, online, 300m from the pickup.
psql(`insert into public.driver_presence (driver_id,status,vehicle_class,position,heartbeat_at)
      values ('${DRIVER}','online','moto',st_point(30.0650,-1.9441)::geography,now());`);

const riderJwt = mint(RIDER);
const driverJwt = mint(DRIVER);

const call = async (path, jwt, body) => {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const quote = await call("/functions/v1/quote", riderJwt, {
  vehicleClass: "moto", distanceM: 4000, durationS: 720,
});
check("quote returns 200", quote.status, 200);

const created = await call("/rest/v1/rpc/create_trip_from_quote", riderJwt, {
  p_quote_id: quote.body.quoteId,
  p_pickup: "POINT(30.0619 -1.9441)",
  p_pickup_label: "Kimironko Market",
  p_pickup_note: "blue gate opposite the pharmacy",
  p_dropoff: "POINT(30.0588 -1.9536)",
  p_dropoff_label: "Kigali Heights",
});
check("trip created", created.status, 200);
const tripId = created.body.id;

// Nobody names a driver here. The dispatcher chooses.
const dispatched = await call("/functions/v1/dispatch", SERVICE, { tripId });
check("dispatch returns 200", dispatched.status, 200);
check("a driver was offered the trip", dispatched.body.offered, true);
check("and it is the only eligible driver", dispatched.body.driverId, DRIVER);
check("trip is offered", psql(`select state from public.trips where id='${tripId}';`), "offered");

const offerId = psql(
  `select id from public.trip_offers where trip_id='${tripId}' and outcome is null;`);

const accepted = await call("/rest/v1/rpc/accept_offer", driverJwt, {
  p_offer_id: offerId, p_idempotency_key: "acc-1",
});
check("driver accepts", accepted.body.state, "accepted");
check("offer records the outcome",
  psql(`select outcome from public.trip_offers where id='${offerId}';`), "accepted");

for (const [to, key] of [["arrived", "a2"], ["in_progress", "a3"]]) {
  const r = await call("/rest/v1/rpc/trip_transition", driverJwt, {
    p_trip_id: tripId, p_to: to, p_idempotency_key: key,
  });
  check(`transition to ${to}`, r.body.state, to);
}

const done = await call("/functions/v1/complete-trip", driverJwt, {
  tripId, actualDistanceM: 4100, idempotencyKey: "done-1",
});
check("completion returns 200", done.status, 200);
check("trip completed", done.body.state, "completed");
check("exactly one commission debit",
  psql(`select count(*) from public.ledger_entries where trip_id='${tripId}';`), "1");
check("driver balance is 5000 - 255",
  psql(`select public.driver_balance('${DRIVER}');`), "4745");

console.log("\nDispatch end-to-end passed: nobody chose the driver.");
```

- [ ] **Step 2: Add the script**

In the ROOT `package.json` scripts:

```json
"e2e:dispatch": "node scripts/e2e-dispatch.mjs"
```

- [ ] **Step 3: Run it**

Serve the functions: `pnpm dlx supabase@latest functions serve --no-verify-jwt`
Then, with keys exported from `supabase status`:

```bash
GERA_ANON_KEY=<anon> GERA_SERVICE_KEY=<service_role> pnpm e2e:dispatch
```

Expected: every check prints `ok`, exit 0. Paste the real output.

If a check fails, fix the underlying code — never loosen a check.

- [ ] **Step 4: Commit**

```bash
git add scripts package.json
git commit -m "test: drive a full dispatch loop with nobody choosing the driver

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Definition of done

- [ ] `pnpm verify` exits 0 (typecheck, unit tests, and the Deno functions tests including bundle freshness).
- [ ] `pnpm dlx supabase@latest test db` — 16 files, all pass.
- [ ] `pnpm e2e` (Phase 2a) still exits 0.
- [ ] `pnpm e2e:dispatch` exits 0, and no check names a driver in advance.
- [ ] A driver below the minimum balance cannot enter the dispatch index.
- [ ] Two drivers cannot both accept the same offer, proven in pgTAP.
- [ ] `find_candidate_drivers` and `create_trip_offer` are executable by `service_role` only.

## Deliberately not in this plan

- Google Distance Matrix — `straightLineEta` ships now behind `EtaProvider`; the real provider is a drop-in.
- Realtime driver-position streaming to the rider's map, and the ambient geohash channel.
- The rider's morphing bottom sheet, destination picker, and the landmark gazetteer UI.
- Background location, the foreground service, and turn-by-turn navigation.
- The demand heatmap, earnings coaching, and safety features.
- Wallet top-up and the `PaymentProvider` implementation.
- Contact masking (spec 3.6) — needs the in-trip screen.
- Re-dispatch on driver heartbeat loss after acceptance (the `accepted → offered` edge exists and is legal, but nothing drives it yet).
