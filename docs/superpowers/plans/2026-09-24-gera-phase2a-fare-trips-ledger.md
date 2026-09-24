# Gera — Phase 2a: Fare Quoting, Trip Creation, Completion & Ledger

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A rider can be quoted a locked upfront fare, create a trip from that quote, and have the trip complete with the correct commission debited from the driver's wallet as an append-only ledger entry.

**Architecture:** Fare arithmetic stays in `packages/core` as the single implementation; Supabase Edge Functions import it directly (Deno runs TypeScript natively, and `packages/core` is dependency-free precisely so it can be consumed outside the workspace). Money-moving steps are Postgres functions so they are atomic — an Edge Function computes amounts and calls one RPC that writes the event, the state change and the ledger entry together or not at all.

**Tech Stack:** Supabase Edge Functions (Deno), Postgres 15 + PostGIS, pgTAP, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-24-gera-core-trip-loop-design.md` (sections 3.4 Fare and quoting, 3.5 Wallet and ledger)

**Covers:** The first half of the spec's Phase 2. Matching, sequential dispatch, the offer sweeper and the simulation harness are Plan 2b.

**Builds on:** `feat/foundation-and-domain-core` (28 commits). That branch is complete and green: `pnpm verify` exit 0, pgTAP 6 files / 66 assertions PASS.

## Global Constraints

- **Money is integer RWF.** No subunit exists. Every amount is a whole number of francs — never float, never numeric, never minor units. The one sanctioned exception is `fare_policies.commission_pct`, a percentage.
- **Rider-facing fares round UP to the nearest 100 RWF** (`roundFareRwf`).
- **`packages/core` keeps zero runtime dependencies.** `"dependencies"` stays exactly `{}`. This is what makes it importable from Deno; a test enforces it.
- **`trips.state` may only change through `trip_transition()` or `trip_transition_system()`.** A `before update` trigger (`trips_guard_state_trg`) rejects anything else. Never write `state` directly, never disable that trigger.
- **`ledger_entries` is append-only.** Positive amounts, direction carried by `kind`. Corrections are compensating rows, never edits.
- Spatial columns are `geography(Point, 4326)`. Timestamps are `timestamptz`, server-generated.
- TypeScript `strict: true`. No `any`.
- The Supabase CLI sometimes prints a JSON error and still exits 0 — judge by output text; `"_tag":"Error"` means failure.
- Commit messages use Conventional Commits and end with:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

---

## File Structure

| Path | Responsibility |
|---|---|
| `packages/core/src/fare/policy.ts` | **Modified** — `FarePolicy` gains `commissionPct` |
| `packages/core/src/fare/receipt.ts` | New — assembles a rider-facing receipt from quote + actuals |
| `supabase/migrations/0010_fare_policy_seed.sql` | Seeds Kigali rates; `current_fare_policy()` lookup |
| `supabase/migrations/0011_ledger_immutable.sql` | Trigger making `ledger_entries` append-only in fact |
| `supabase/migrations/0012_trip_creation.sql` | `create_trip_from_quote()`, `assign_driver_to_trip()` |
| `supabase/migrations/0013_trip_completion.sql` | `complete_trip()` — transition + ledger, atomic |
| `supabase/functions/_shared/core.ts` | Re-export surface of `packages/core` for Deno |
| `supabase/functions/_shared/supabase.ts` | Request-scoped client helpers |
| `supabase/functions/quote/index.ts` | Computes and persists a locked fare quote |
| `supabase/functions/complete-trip/index.ts` | Finalises fare, calls `complete_trip()` |
| `packages/data/src/trips.ts` | Typed client bindings for the above |
| `supabase/tests/007_*.sql` … `010_*.sql` | pgTAP per migration |

---

## Task 1: `commissionPct` on `FarePolicy`

The final review flagged this: `fare_policies` carries `commission_pct` but the TypeScript `FarePolicy` has no field for it, so the quote function cannot carry the commission rate it needs at completion.

**Files:**
- Modify: `packages/core/src/fare/policy.ts`
- Test: `packages/core/test/fare/policy.test.ts` (new)

**Interfaces:**
- Consumes: nothing
- Produces: `FarePolicy` gains `readonly commissionPct: number` (0–100)

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/fare/policy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { roundFareRwf, type FarePolicy } from "../../src/fare/policy";

const MOTO: FarePolicy = {
  vehicleClass: "moto",
  baseRwf: 400,
  perKmRwf: 250,
  perMinuteRwf: 20,
  minimumRwf: 700,
  commissionPct: 15,
};

describe("FarePolicy", () => {
  it("carries the commission rate alongside the fare rates", () => {
    expect(MOTO.commissionPct).toBe(15);
  });

  it("still rounds fares up to whole hundreds", () => {
    expect(roundFareRwf(1701)).toBe(1800);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gera/core test`
Expected: FAIL — `commissionPct` does not exist on type `FarePolicy`.

- [ ] **Step 3: Add the field**

In `packages/core/src/fare/policy.ts`, inside `interface FarePolicy`, after `minimumRwf`:

```ts
  /** Platform commission as a percentage of the fare, 0-100. */
  readonly commissionPct: number;
```

- [ ] **Step 4: Fix the existing fixtures**

Every existing test builds a `FarePolicy` literal and will now fail to typecheck. Add `commissionPct: 15,` to the `MOTO` fixture in each of:
- `packages/core/test/fare/quote.test.ts`
- `packages/core/test/fare/finalize.test.ts`

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm --filter @gera/core test && pnpm --filter @gera/core typecheck`
Expected: both PASS. Test count rises from 58 to 60.

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): carry the commission rate on FarePolicy

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Rider-facing receipt

Spec 3.4 requires distance overage to be **itemised separately, never folded silently into the total**. That shaping belongs in `packages/core` so both the app and the completion path produce the same numbers.

**Files:**
- Create: `packages/core/src/fare/receipt.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/fare/receipt.test.ts`

**Interfaces:**
- Consumes: `FarePolicy`, `finalizeFare`, `FinalFare` from Task 1 and existing code
- Produces:
  - `ReceiptLine = { label: string; amountRwf: number }`
  - `buildReceipt(policy: FarePolicy, quotedRwf: number, quotedDistanceMetres: number, actualDistanceMetres: number): { lines: readonly ReceiptLine[]; totalRwf: number; commissionRwf: number }`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/fare/receipt.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildReceipt } from "../../src/fare/receipt";
import type { FarePolicy } from "../../src/fare/policy";

const MOTO: FarePolicy = {
  vehicleClass: "moto",
  baseRwf: 400,
  perKmRwf: 250,
  perMinuteRwf: 20,
  minimumRwf: 700,
  commissionPct: 15,
};

describe("buildReceipt", () => {
  it("shows a single line when the trip matched its quote", () => {
    const r = buildReceipt(MOTO, 1700, 4000, 4000);
    expect(r.lines).toEqual([{ label: "Fare", amountRwf: 1700 }]);
    expect(r.totalRwf).toBe(1700);
  });

  it("itemises a distance overage as its own line", () => {
    const r = buildReceipt(MOTO, 1700, 4000, 5600);
    expect(r.lines).toEqual([
      { label: "Fare", amountRwf: 1700 },
      { label: "Extra distance", amountRwf: 300 },
    ]);
    expect(r.totalRwf).toBe(2000);
  });

  it("never folds an overage silently into the fare line", () => {
    const r = buildReceipt(MOTO, 1700, 4000, 5600);
    expect(r.lines[0]?.amountRwf).toBe(1700);
  });

  it("computes commission on the total, not the quote", () => {
    const r = buildReceipt(MOTO, 1700, 4000, 5600);
    expect(r.commissionRwf).toBe(300); // 15% of 2000
  });

  it("lines always sum to the total", () => {
    const r = buildReceipt(MOTO, 1700, 4000, 5600);
    expect(r.lines.reduce((t, l) => t + l.amountRwf, 0)).toBe(r.totalRwf);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gera/core test`
Expected: FAIL — cannot resolve `../../src/fare/receipt`.

- [ ] **Step 3: Implement**

Create `packages/core/src/fare/receipt.ts`:

```ts
import { finalizeFare } from "./finalize";
import { commissionFor } from "../ledger/commission";
import type { FarePolicy } from "./policy";

export interface ReceiptLine {
  readonly label: string;
  readonly amountRwf: number;
}

export interface Receipt {
  readonly lines: readonly ReceiptLine[];
  readonly totalRwf: number;
  readonly commissionRwf: number;
}

/**
 * Spec 3.4: an overage is always its own line. A rider who paid more than the
 * quote must be able to see exactly why, so the fare line keeps the quoted
 * figure and the excess is stated separately.
 */
export function buildReceipt(
  policy: FarePolicy,
  quotedRwf: number,
  quotedDistanceMetres: number,
  actualDistanceMetres: number,
): Receipt {
  const final = finalizeFare(policy, quotedRwf, quotedDistanceMetres, actualDistanceMetres);

  const lines: ReceiptLine[] = [{ label: "Fare", amountRwf: final.quotedRwf }];
  if (final.overageRwf > 0) {
    lines.push({ label: "Extra distance", amountRwf: final.overageRwf });
  }

  return {
    lines,
    totalRwf: final.totalRwf,
    commissionRwf: commissionFor(final.totalRwf, policy.commissionPct),
  };
}
```

- [ ] **Step 4: Export and verify**

Add to `packages/core/src/index.ts`:

```ts
export * from "./fare/receipt";
```

Run: `pnpm --filter @gera/core test && pnpm --filter @gera/core typecheck`
Expected: both PASS, 65 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): build itemised rider receipts

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Seed fare policies and the lookup function

**Files:**
- Create: `supabase/migrations/0010_fare_policy_seed.sql`
- Test: `supabase/tests/007_fare_policy.test.sql`

**Interfaces:**
- Consumes: `fare_policies` table from migration 0005
- Produces: `public.current_fare_policy(p_class vehicle_class) returns public.fare_policies`

**Rates:** placeholders pending the market calibration the spec lists as an open item. They are effective-dated so changing them never rewrites history.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0010_fare_policy_seed.sql`:

```sql
-- Placeholder rates. Spec open item 3 calls for market calibration before
-- launch; these are effective-dated so a later change never rewrites history.
insert into public.fare_policies
  (vehicle_class, base_rwf, per_km_rwf, per_minute_rwf, minimum_rwf, commission_pct)
values
  ('moto',   400,  250, 20, 700,  15.00),
  ('cab',    1000, 600, 50, 2000, 15.00),
  ('cab_xl', 1500, 800, 60, 3000, 15.00);

-- The policy in force for a class right now. Effective-dated, so a future
-- price change is inserted rather than updated and history stays intact.
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
   order by effective_from desc
   limit 1;
$$;

revoke all on function public.current_fare_policy(vehicle_class) from public, anon;
grant execute on function public.current_fare_policy(vehicle_class) to authenticated, service_role;
```

- [ ] **Step 2: Apply and read the output**

Run: `pnpm dlx supabase@latest db reset`
Expected: 10 migrations apply, no `"_tag":"Error"`.

- [ ] **Step 3: Write the pgTAP test**

Create `supabase/tests/007_fare_policy.test.sql`:

```sql
begin;
select plan(5);

select is(
  (select count(*)::int from public.fare_policies),
  3,
  'one seeded policy per vehicle class'
);

select is(
  (select base_rwf from public.current_fare_policy('moto')),
  400,
  'moto policy is returned with its base fare'
);

select is(
  (select commission_pct from public.current_fare_policy('moto')),
  15.00::numeric(5,2),
  'the commission rate is carried on the policy'
);

-- A superseding policy must win without the old row being touched.
insert into public.fare_policies
  (vehicle_class, base_rwf, per_km_rwf, per_minute_rwf, minimum_rwf, commission_pct, effective_from)
values ('moto', 500, 275, 22, 800, 18.00, now() - interval '1 minute');

select is(
  (select base_rwf from public.current_fare_policy('moto')),
  500,
  'the most recently effective policy wins'
);

select is(
  (select count(*)::int from public.fare_policies where vehicle_class = 'moto'),
  2,
  'superseding a price inserts, never updates - history is intact'
);

select * from finish();
rollback;
```

- [ ] **Step 4: Run and commit**

Run: `pnpm dlx supabase@latest test db`
Expected: 7 files, 71 assertions, PASS.

```bash
git add supabase
git commit -m "feat(db): seed fare policies and add effective-dated lookup

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Make the ledger append-only in fact, not just by convention

The final review flagged this: `ledger_entries` is documented append-only and RLS denies client writes, but `service_role` bypasses RLS. The Phase 2 ops console will run as service role and will be able to edit financial history rather than compensate it.

**Files:**
- Create: `supabase/migrations/0011_ledger_immutable.sql`
- Test: `supabase/tests/008_ledger_immutable.test.sql`

**Interfaces:**
- Consumes: `ledger_entries` from migration 0005
- Produces: trigger `ledger_entries_append_only_trg`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0011_ledger_immutable.sql`:

```sql
-- RLS already denies client writes, but service_role bypasses RLS and the ops
-- console will run as service_role. A ledger you can edit is not a ledger:
-- corrections must be compensating rows so the history stays auditable.
create or replace function public.ledger_entries_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'ledger_entries is append-only; write a compensating entry instead of %ing row %',
    lower(tg_op), coalesce(old.id, -1)
    using errcode = '42501';
end;
$$;

create trigger ledger_entries_append_only_trg
  before update or delete on public.ledger_entries
  for each row execute function public.ledger_entries_append_only();
```

- [ ] **Step 2: Apply**

Run: `pnpm dlx supabase@latest db reset`
Expected: 11 migrations apply cleanly.

- [ ] **Step 3: Write the pgTAP test**

Create `supabase/tests/008_ledger_immutable.test.sql`:

```sql
begin;
select plan(4);

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000',
   'dddddddd-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'ledger.driver@test.local');

insert into public.profiles (id, role, first_name, phone)
values ('dddddddd-0000-0000-0000-000000000001', 'driver', 'Eric', '+250788000111');

insert into public.drivers (id, verification)
values ('dddddddd-0000-0000-0000-000000000001', 'verified');

insert into public.ledger_entries (driver_id, kind, amount_rwf)
values ('dddddddd-0000-0000-0000-000000000001', 'topup_credit', 5000);

select lives_ok(
  $$ insert into public.ledger_entries (driver_id, kind, amount_rwf)
     values ('dddddddd-0000-0000-0000-000000000001', 'commission_debit', 300) $$,
  'appending a new entry is allowed'
);

select throws_ok(
  $$ update public.ledger_entries set amount_rwf = 1
      where driver_id = 'dddddddd-0000-0000-0000-000000000001' $$,
  '42501', null,
  'a ledger entry cannot be updated, even as superuser'
);

select throws_ok(
  $$ delete from public.ledger_entries
      where driver_id = 'dddddddd-0000-0000-0000-000000000001' $$,
  '42501', null,
  'a ledger entry cannot be deleted, even as superuser'
);

select is(
  (select sum(case when kind in ('topup_credit','adjustment_credit')
                   then amount_rwf else -amount_rwf end)::int
     from public.ledger_entries
    where driver_id = 'dddddddd-0000-0000-0000-000000000001'),
  4700,
  'the balance survives the refused edits'
);

select * from finish();
rollback;
```

- [ ] **Step 4: Run and commit**

Run: `pnpm dlx supabase@latest test db`
Expected: 8 files, 75 assertions, PASS.

```bash
git add supabase
git commit -m "feat(db): enforce the append-only ledger with a trigger

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: Edge Function foundation — prove `packages/core` imports from Deno

This task exists to de-risk the central architectural bet early. If Deno cannot import `packages/core`, every later Edge Function task changes shape, and it is far cheaper to discover that now.

**Files:**
- Create: `supabase/functions/deno.json`
- Create: `supabase/functions/_shared/core.ts`
- Create: `supabase/functions/_shared/supabase.ts`
- Create: `supabase/functions/_shared/core_test.ts`

**Interfaces:**
- Consumes: `packages/core` exports
- Produces:
  - `supabase/functions/_shared/core.ts` re-exporting `quoteFare`, `buildReceipt`, `commissionFor`, `roundFareRwf`, and the `FarePolicy`/`VehicleClass` types
  - `serviceClient(): SupabaseClient` and `callerClient(req: Request): SupabaseClient` from `_shared/supabase.ts`

- [ ] **Step 1: Create the Deno config with an import alias**

Create `supabase/functions/deno.json`:

```json
{
  "imports": {
    "@gera/core": "../../packages/core/src/index.ts",
    "@supabase/supabase-js": "npm:@supabase/supabase-js@2"
  }
}
```

- [ ] **Step 2: Create the re-export surface**

Create `supabase/functions/_shared/core.ts`:

```ts
// Single import point for the domain core. The fare and commission arithmetic
// has exactly one implementation, in packages/core, which is dependency-free
// specifically so Deno can run it unchanged.
export {
  quoteFare,
  buildReceipt,
  commissionFor,
  roundFareRwf,
  VEHICLE_CLASSES,
} from "@gera/core";

export type { FarePolicy, VehicleClass, Receipt } from "@gera/core";
```

- [ ] **Step 3: Write the failing proof test**

Create `supabase/functions/_shared/core_test.ts`:

```ts
import { assertEquals } from "jsr:@std/assert@1";
import { quoteFare, buildReceipt } from "./core.ts";
import type { FarePolicy } from "./core.ts";

const MOTO: FarePolicy = {
  vehicleClass: "moto",
  baseRwf: 400,
  perKmRwf: 250,
  perMinuteRwf: 20,
  minimumRwf: 700,
  commissionPct: 15,
};

Deno.test("Deno runs the workspace fare arithmetic unchanged", () => {
  assertEquals(quoteFare(MOTO, 4000, 720), 1700);
});

Deno.test("Deno runs the workspace receipt builder unchanged", () => {
  const r = buildReceipt(MOTO, 1700, 4000, 5600);
  assertEquals(r.totalRwf, 2000);
  assertEquals(r.commissionRwf, 300);
});
```

- [ ] **Step 4: Run it — this is the de-risking moment**

Run: `deno test --allow-read --config supabase/functions/deno.json supabase/functions/_shared/core_test.ts`
Expected: 2 tests pass, proving Deno resolves and executes `packages/core`.

**If the import does not resolve**, STOP and report before writing any Edge Function. Do not reimplement the fare maths in SQL or duplicate it into `supabase/functions/` — a second copy of money arithmetic is precisely the defect class this architecture avoids. Report the resolution error and wait.

- [ ] **Step 5: Create the client helpers**

Create `supabase/functions/_shared/supabase.ts`:

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Full-privilege client. Bypasses RLS - use only for writes the caller is
 *  authorised to make by logic you have already checked. */
export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );
}

/** Client acting AS the caller, so RLS applies exactly as it would in the app. */
export function callerClient(req: Request): SupabaseClient {
  const auth = req.headers.get("Authorization") ?? "";
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: auth } }, auth: { persistSession: false } },
  );
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
```

- [ ] **Step 6: Commit**

```bash
git add supabase/functions
git commit -m "feat(functions): share the domain core with Deno edge functions

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: The `quote` Edge Function

**Files:**
- Create: `supabase/functions/quote/index.ts`
- Create: `supabase/functions/quote/index_test.ts`

**Interfaces:**
- Consumes: `_shared/core.ts`, `_shared/supabase.ts`, `current_fare_policy()`
- Produces: `POST /functions/v1/quote` taking `{ vehicleClass, distanceM, durationS }` and returning `{ quoteId, amountRwf, expiresAt, vehicleClass, distanceM, durationS }`

**Spec 3.4:** the quote is locked for 120 seconds. The rider sees a guaranteed price before confirming — Yego runs metered, so this is a deliberate differentiator.

- [ ] **Step 1: Write the function**

Create `supabase/functions/quote/index.ts`:

```ts
import { quoteFare, VEHICLE_CLASSES } from "../_shared/core.ts";
import type { FarePolicy, VehicleClass } from "../_shared/core.ts";
import { callerClient, serviceClient, json } from "../_shared/supabase.ts";

const QUOTE_TTL_SECONDS = 120;

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const caller = callerClient(req);
  const { data: auth } = await caller.auth.getUser();
  if (!auth.user) return json({ error: "unauthenticated" }, 401);

  let body: { vehicleClass?: string; distanceM?: number; durationS?: number };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const { vehicleClass, distanceM, durationS } = body;

  if (!VEHICLE_CLASSES.includes(vehicleClass as VehicleClass)) {
    return json({ error: "unknown_vehicle_class" }, 400);
  }
  if (typeof distanceM !== "number" || distanceM < 0 || !Number.isFinite(distanceM)) {
    return json({ error: "invalid_distance" }, 400);
  }
  if (typeof durationS !== "number" || durationS < 0 || !Number.isFinite(durationS)) {
    return json({ error: "invalid_duration" }, 400);
  }

  const svc = serviceClient();
  const { data: row, error: policyError } = await svc
    .rpc("current_fare_policy", { p_class: vehicleClass })
    .single();

  if (policyError || !row) return json({ error: "no_fare_policy" }, 503);

  const policy: FarePolicy = {
    vehicleClass: row.vehicle_class,
    baseRwf: row.base_rwf,
    perKmRwf: row.per_km_rwf,
    perMinuteRwf: row.per_minute_rwf,
    minimumRwf: row.minimum_rwf,
    commissionPct: Number(row.commission_pct),
  };

  const amountRwf = quoteFare(policy, distanceM, durationS);
  const expiresAt = new Date(Date.now() + QUOTE_TTL_SECONDS * 1000).toISOString();

  const { data: quote, error: writeError } = await svc
    .from("fare_quotes")
    .insert({
      rider_id: auth.user.id,
      policy_id: row.id,
      vehicle_class: vehicleClass,
      distance_m: Math.round(distanceM),
      duration_s: Math.round(durationS),
      amount_rwf: amountRwf,
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (writeError || !quote) return json({ error: "quote_write_failed" }, 500);

  return json({
    quoteId: quote.id,
    amountRwf,
    expiresAt,
    vehicleClass,
    distanceM: Math.round(distanceM),
    durationS: Math.round(durationS),
  });
});
```

- [ ] **Step 2: Write the validation tests**

Create `supabase/functions/quote/index_test.ts`:

```ts
import { assertEquals } from "jsr:@std/assert@1";
import { quoteFare } from "../_shared/core.ts";
import type { FarePolicy } from "../_shared/core.ts";

const MOTO: FarePolicy = {
  vehicleClass: "moto",
  baseRwf: 400,
  perKmRwf: 250,
  perMinuteRwf: 20,
  minimumRwf: 700,
  commissionPct: 15,
};

Deno.test("a 4km, 12min moto trip quotes at 1700 RWF", () => {
  assertEquals(quoteFare(MOTO, 4000, 720), 1700);
});

Deno.test("a very short trip is floored at the minimum", () => {
  assertEquals(quoteFare(MOTO, 200, 60), 700);
});

Deno.test("quotes are always whole hundreds", () => {
  const q = quoteFare(MOTO, 3333, 401);
  assertEquals(q % 100, 0);
});
```

- [ ] **Step 3: Run the unit tests**

Run: `deno test --allow-read --config supabase/functions/deno.json supabase/functions/quote/index_test.ts`
Expected: 3 tests pass.

- [ ] **Step 4: Serve and exercise it live**

Run in one shell: `pnpm dlx supabase@latest functions serve quote --no-verify-jwt`

In another, mint a caller token the way the project already does and POST:

```bash
curl -s -X POST http://127.0.0.1:54321/functions/v1/quote \
  -H "Content-Type: application/json" \
  -d '{"vehicleClass":"moto","distanceM":4000,"durationS":720}'
```

Expected: JSON with `"amountRwf":1700` and an `expiresAt` roughly two minutes ahead. Record the real output. Stop the server afterwards.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions
git commit -m "feat(functions): quote a locked upfront fare

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: Trip creation from a quote

**Files:**
- Create: `supabase/migrations/0012_trip_creation.sql`
- Test: `supabase/tests/009_trip_creation.test.sql`

**Interfaces:**
- Consumes: `fare_quotes`, `trips`, `trip_transition_system()`
- Produces:
  - `public.create_trip_from_quote(p_quote_id uuid, p_pickup geography, p_pickup_label text, p_pickup_note text, p_dropoff geography, p_dropoff_label text) returns public.trips`
  - `public.assign_driver_to_trip(p_trip_id uuid, p_driver_id uuid, p_idempotency_key text) returns public.trips`

**Why `assign_driver_to_trip` is here and not in Plan 2b:** completion debits a driver's wallet, so this plan needs a driver on the trip. It is the seam Plan 2b's dispatcher will call once matching exists.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0012_trip_creation.sql`:

```sql
-- A trip must remember which quote priced it. Without this link, completion has
-- no reliable way to recover the locked fare - guessing from the most recent
-- quote for the same vehicle class would happily pick another rider's.
alter table public.trips
  add column quote_id           uuid references public.fare_quotes (id),
  add column quoted_amount_rwf  integer check (quoted_amount_rwf >= 0);

-- Creates a trip against a quote the caller owns. The quote is the price lock:
-- an expired one must be re-quoted rather than honoured (spec 3.4).
create or replace function public.create_trip_from_quote(
  p_quote_id     uuid,
  p_pickup       geography(Point, 4326),
  p_pickup_label text,
  p_pickup_note  text,
  p_dropoff      geography(Point, 4326),
  p_dropoff_label text
) returns public.trips
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote public.fare_quotes;
  v_trip  public.trips;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  select * into v_quote from public.fare_quotes where id = p_quote_id;
  if not found then
    raise exception 'quote_not_found' using errcode = 'P0002';
  end if;

  if v_quote.rider_id <> auth.uid() then
    raise exception 'quote_not_yours' using errcode = '42501';
  end if;

  if v_quote.expires_at <= now() then
    raise exception 'quote_expired' using errcode = '22023';
  end if;

  insert into public.trips
    (rider_id, vehicle_class, state, pickup, pickup_label, pickup_note,
     dropoff, dropoff_label, quoted_distance_m, quoted_duration_s,
     quote_id, quoted_amount_rwf)
  values
    (auth.uid(), v_quote.vehicle_class, 'requested', p_pickup, p_pickup_label,
     nullif(btrim(coalesce(p_pickup_note, '')), ''),
     p_dropoff, p_dropoff_label, v_quote.distance_m, v_quote.duration_s,
     v_quote.id, v_quote.amount_rwf)
  returning * into v_trip;

  return v_trip;
end;
$$;

revoke all on function public.create_trip_from_quote(uuid, geography, text, text, geography, text)
  from public, anon;
grant execute on function public.create_trip_from_quote(uuid, geography, text, text, geography, text)
  to authenticated;

-- Attaches a driver and moves the trip to `offered`. Service role only: this is
-- the seam the Phase 2b dispatcher calls once matching exists. Riders must never
-- be able to choose their own driver.
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

  perform set_config('gera.in_transition', '1', true);
  update public.trips set driver_id = p_driver_id where id = p_trip_id;
  perform set_config('gera.in_transition', '0', true);

  return public.trip_transition_system(p_trip_id, 'offered', p_idempotency_key);
end;
$$;

revoke all on function public.assign_driver_to_trip(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.assign_driver_to_trip(uuid, uuid, text) to service_role;
```

- [ ] **Step 2: Apply and read the output**

Run: `pnpm dlx supabase@latest db reset`
Expected: 12 migrations apply, no `"_tag":"Error"`.

- [ ] **Step 3: Write the pgTAP test**

Create `supabase/tests/009_trip_creation.test.sql`:

```sql
begin;
select plan(8);

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000','cccccccc-0000-0000-0000-000000000001',
   'authenticated','authenticated','rider.c@test.local'),
  ('00000000-0000-0000-0000-000000000000','cccccccc-0000-0000-0000-000000000002',
   'authenticated','authenticated','rider.d@test.local'),
  ('00000000-0000-0000-0000-000000000000','cccccccc-0000-0000-0000-000000000003',
   'authenticated','authenticated','driver.e@test.local');

insert into public.profiles (id, role, first_name, phone) values
  ('cccccccc-0000-0000-0000-000000000001','rider','Aline','+250788000201'),
  ('cccccccc-0000-0000-0000-000000000002','rider','Bosco','+250788000202'),
  ('cccccccc-0000-0000-0000-000000000003','driver','Eric','+250788000203');

insert into public.drivers (id, verification)
values ('cccccccc-0000-0000-0000-000000000003','verified');

insert into public.fare_quotes
  (id, rider_id, policy_id, vehicle_class, distance_m, duration_s, amount_rwf, expires_at)
values
  ('eeeeeeee-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001',
   (select id from public.fare_policies where vehicle_class='moto' limit 1),
   'moto', 4000, 720, 1700, now() + interval '2 minutes'),
  ('eeeeeeee-0000-0000-0000-000000000002','cccccccc-0000-0000-0000-000000000001',
   (select id from public.fare_policies where vehicle_class='moto' limit 1),
   'moto', 4000, 720, 1700, now() - interval '1 second');

set local role authenticated;
set local request.jwt.claims to
  '{"sub":"cccccccc-0000-0000-0000-000000000001","role":"authenticated"}';

select lives_ok(
  $$ select public.create_trip_from_quote(
       'eeeeeeee-0000-0000-0000-000000000001',
       st_point(30.0619,-1.9441)::geography, 'Kimironko Market', 'blue gate',
       st_point(30.0588,-1.9536)::geography, 'Kigali Heights') $$,
  'a rider creates a trip from their own live quote'
);

select is(
  (select state::text from public.trips
    where rider_id = 'cccccccc-0000-0000-0000-000000000001' limit 1),
  'requested',
  'a new trip starts in requested'
);

select is(
  (select quoted_distance_m from public.trips
    where rider_id = 'cccccccc-0000-0000-0000-000000000001' limit 1),
  4000,
  'the quoted distance is carried onto the trip'
);

-- Without this the trip cannot recover its own locked price at completion.
select is(
  (select quoted_amount_rwf from public.trips
    where rider_id = 'cccccccc-0000-0000-0000-000000000001' limit 1),
  1700,
  'the locked fare is carried onto the trip, not re-derived later'
);

select throws_ok(
  $$ select public.create_trip_from_quote(
       'eeeeeeee-0000-0000-0000-000000000002',
       st_point(30.0619,-1.9441)::geography, 'A', null,
       st_point(30.0588,-1.9536)::geography, 'B') $$,
  '22023', null,
  'an expired quote is refused rather than honoured'
);

set local request.jwt.claims to
  '{"sub":"cccccccc-0000-0000-0000-000000000002","role":"authenticated"}';

select throws_ok(
  $$ select public.create_trip_from_quote(
       'eeeeeeee-0000-0000-0000-000000000001',
       st_point(30.0619,-1.9441)::geography, 'A', null,
       st_point(30.0588,-1.9536)::geography, 'B') $$,
  '42501', null,
  'a rider cannot create a trip from someone else quote'
);

select ok(
  not has_function_privilege('authenticated',
    'public.assign_driver_to_trip(uuid,uuid,text)', 'EXECUTE'),
  'a rider cannot assign themselves a driver'
);

select ok(
  has_function_privilege('service_role',
    'public.assign_driver_to_trip(uuid,uuid,text)', 'EXECUTE'),
  'the dispatcher can assign a driver'
);

select * from finish();
rollback;
```

- [ ] **Step 4: Run and commit**

Run: `pnpm dlx supabase@latest test db`
Expected: 9 files, 83 assertions, PASS.

```bash
git add supabase
git commit -m "feat(db): create trips from locked quotes and assign drivers

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: Atomic trip completion with the commission debit

**Files:**
- Create: `supabase/migrations/0013_trip_completion.sql`
- Test: `supabase/tests/010_trip_completion.test.sql`

**Interfaces:**
- Consumes: `trip_transition()`, `ledger_entries`, `trips`
- Produces: `public.complete_trip(p_trip_id uuid, p_actual_distance_m integer, p_total_rwf integer, p_commission_rwf integer, p_idempotency_key text) returns public.trips`

**Why the amounts are parameters:** the arithmetic has one implementation, in `packages/core`. The Edge Function computes the receipt and passes the results in; this function's job is to make the state change and the ledger entry atomic, not to re-derive money in a second language.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0013_trip_completion.sql`:

```sql
-- Completion is one transaction: the trip moves to `completed`, the actual
-- distance is recorded, and the commission is debited. Either all of it happens
-- or none of it does - a state change without its ledger entry would mean a
-- ride the platform never charged for.
create or replace function public.complete_trip(
  p_trip_id           uuid,
  p_actual_distance_m integer,
  p_total_rwf         integer,
  p_commission_rwf    integer,
  p_idempotency_key   text
) returns public.trips
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip public.trips;
begin
  if p_actual_distance_m < 0 then
    raise exception 'negative_distance' using errcode = '22023';
  end if;
  if p_total_rwf < 0 or p_commission_rwf < 0 then
    raise exception 'negative_amount' using errcode = '22023';
  end if;
  if p_commission_rwf > p_total_rwf then
    raise exception 'commission_exceeds_fare' using errcode = '22023';
  end if;

  select * into v_trip from public.trips where id = p_trip_id for update;
  if not found then
    raise exception 'trip_not_found' using errcode = 'P0002';
  end if;

  -- Idempotent: a replayed completion must not debit commission twice.
  if exists (
    select 1 from public.trip_events
     where trip_id = p_trip_id and idempotency_key = p_idempotency_key
  ) then
    return v_trip;
  end if;

  if v_trip.driver_id is null then
    raise exception 'trip_has_no_driver' using errcode = '22023';
  end if;

  perform set_config('gera.in_transition', '1', true);
  update public.trips
     set actual_distance_m = p_actual_distance_m
   where id = p_trip_id;
  perform set_config('gera.in_transition', '0', true);

  -- Raises if the edge is illegal or the caller is not the driver.
  v_trip := public.trip_transition(p_trip_id, 'completed', p_idempotency_key,
                                   jsonb_build_object('total_rwf', p_total_rwf));

  insert into public.ledger_entries (driver_id, trip_id, kind, amount_rwf, memo)
  values (v_trip.driver_id, p_trip_id, 'commission_debit', p_commission_rwf,
          'commission on trip ' || p_trip_id);

  return v_trip;
end;
$$;

revoke all on function public.complete_trip(uuid, integer, integer, integer, text)
  from public, anon;
grant execute on function public.complete_trip(uuid, integer, integer, integer, text)
  to authenticated, service_role;
```

- [ ] **Step 2: Apply**

Run: `pnpm dlx supabase@latest db reset`
Expected: 13 migrations apply cleanly.

- [ ] **Step 3: Write the pgTAP test**

Create `supabase/tests/010_trip_completion.test.sql`:

```sql
begin;
select plan(8);

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000','ffffffff-0000-0000-0000-000000000001',
   'authenticated','authenticated','rider.f@test.local'),
  ('00000000-0000-0000-0000-000000000000','ffffffff-0000-0000-0000-000000000002',
   'authenticated','authenticated','driver.f@test.local');

insert into public.profiles (id, role, first_name, phone) values
  ('ffffffff-0000-0000-0000-000000000001','rider','Aline','+250788000301'),
  ('ffffffff-0000-0000-0000-000000000002','driver','Eric','+250788000302');

insert into public.drivers (id, verification)
values ('ffffffff-0000-0000-0000-000000000002','verified');

insert into public.trips
  (id, rider_id, driver_id, vehicle_class, state, pickup, pickup_label,
   dropoff, dropoff_label, quoted_distance_m, quoted_duration_s)
values
  ('bbbbbbbb-0000-0000-0000-000000000001',
   'ffffffff-0000-0000-0000-000000000001','ffffffff-0000-0000-0000-000000000002',
   'moto','in_progress',
   st_point(30.0619,-1.9441)::geography,'Kimironko',
   st_point(30.0588,-1.9536)::geography,'Kigali Heights', 4000, 720);

set local role authenticated;
set local request.jwt.claims to
  '{"sub":"ffffffff-0000-0000-0000-000000000002","role":"authenticated"}';

select lives_ok(
  $$ select public.complete_trip('bbbbbbbb-0000-0000-0000-000000000001',
                                 4100, 1700, 255, 'complete-1') $$,
  'the driver completes the trip'
);

select is(
  (select state::text from public.trips where id='bbbbbbbb-0000-0000-0000-000000000001'),
  'completed',
  'the trip reaches completed'
);

select is(
  (select actual_distance_m from public.trips where id='bbbbbbbb-0000-0000-0000-000000000001'),
  4100,
  'the actual distance is recorded'
);

select is(
  (select count(*)::int from public.ledger_entries
    where trip_id='bbbbbbbb-0000-0000-0000-000000000001' and kind='commission_debit'),
  1,
  'exactly one commission debit is written'
);

select is(
  (select amount_rwf from public.ledger_entries
    where trip_id='bbbbbbbb-0000-0000-0000-000000000001'),
  255,
  'the commission amount is the one the caller computed'
);

select lives_ok(
  $$ select public.complete_trip('bbbbbbbb-0000-0000-0000-000000000001',
                                 4100, 1700, 255, 'complete-1') $$,
  'replaying the completion is a no-op, not an error'
);

select is(
  (select count(*)::int from public.ledger_entries
    where trip_id='bbbbbbbb-0000-0000-0000-000000000001'),
  1,
  'a replayed completion does NOT debit commission twice'
);

select throws_ok(
  $$ select public.complete_trip('bbbbbbbb-0000-0000-0000-000000000001',
                                 4100, 1000, 2000, 'complete-2') $$,
  '22023', null,
  'commission larger than the fare is refused'
);

select * from finish();
rollback;
```

- [ ] **Step 4: Run and commit**

Run: `pnpm dlx supabase@latest test db`
Expected: 10 files, 91 assertions, PASS.

```bash
git add supabase
git commit -m "feat(db): complete trips atomically with the commission debit

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 9: The `complete-trip` Edge Function

**Files:**
- Create: `supabase/functions/complete-trip/index.ts`
- Create: `supabase/functions/complete-trip/index_test.ts`

**Interfaces:**
- Consumes: `_shared/core.ts` (`buildReceipt`), `_shared/supabase.ts`, `complete_trip()`, `current_fare_policy()`
- Produces: `POST /functions/v1/complete-trip` taking `{ tripId, actualDistanceM, idempotencyKey }` and returning `{ tripId, state, receipt: { lines, totalRwf }, commissionRwf }`

- [ ] **Step 1: Write the function**

Create `supabase/functions/complete-trip/index.ts`:

```ts
import { buildReceipt } from "../_shared/core.ts";
import type { FarePolicy } from "../_shared/core.ts";
import { callerClient, serviceClient, json } from "../_shared/supabase.ts";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const caller = callerClient(req);
  const { data: auth } = await caller.auth.getUser();
  if (!auth.user) return json({ error: "unauthenticated" }, 401);

  let body: { tripId?: string; actualDistanceM?: number; idempotencyKey?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const { tripId, actualDistanceM, idempotencyKey } = body;
  if (!tripId) return json({ error: "missing_trip_id" }, 400);
  if (!idempotencyKey) return json({ error: "missing_idempotency_key" }, 400);
  if (
    typeof actualDistanceM !== "number" ||
    actualDistanceM < 0 ||
    !Number.isFinite(actualDistanceM)
  ) {
    return json({ error: "invalid_distance" }, 400);
  }

  // Read the trip as the CALLER so RLS decides whether they may see it.
  const { data: trip, error: tripError } = await caller
    .from("trips")
    .select("id, vehicle_class, quoted_distance_m, quoted_amount_rwf")
    .eq("id", tripId)
    .single();

  if (tripError || !trip) return json({ error: "trip_not_found" }, 404);

  const svc = serviceClient();
  const { data: row, error: policyError } = await svc
    .rpc("current_fare_policy", { p_class: trip.vehicle_class })
    .single();

  if (policyError || !row) return json({ error: "no_fare_policy" }, 503);

  const policy: FarePolicy = {
    vehicleClass: row.vehicle_class,
    baseRwf: row.base_rwf,
    perKmRwf: row.per_km_rwf,
    perMinuteRwf: row.per_minute_rwf,
    minimumRwf: row.minimum_rwf,
    commissionPct: Number(row.commission_pct),
  };

  // The locked price comes off the trip itself, set at creation from the quote.
  // Never re-derive it or look up "the latest quote" - that is how one rider
  // gets charged another rider's fare.
  if (trip.quoted_amount_rwf === null || trip.quoted_amount_rwf === undefined) {
    return json({ error: "trip_has_no_quote" }, 409);
  }

  const receipt = buildReceipt(
    policy,
    trip.quoted_amount_rwf,
    trip.quoted_distance_m ?? 0,
    actualDistanceM,
  );

  // Call as the CALLER: complete_trip defers to trip_transition, which rejects
  // anyone who is not the trip's driver.
  const { data: completed, error: completeError } = await caller
    .rpc("complete_trip", {
      p_trip_id: tripId,
      p_actual_distance_m: Math.round(actualDistanceM),
      p_total_rwf: receipt.totalRwf,
      p_commission_rwf: receipt.commissionRwf,
      p_idempotency_key: idempotencyKey,
    })
    .single();

  if (completeError) return json({ error: completeError.message }, 400);

  return json({
    tripId,
    state: completed?.state ?? "completed",
    receipt: { lines: receipt.lines, totalRwf: receipt.totalRwf },
    commissionRwf: receipt.commissionRwf,
  });
});
```

- [ ] **Step 2: Write the unit tests**

Create `supabase/functions/complete-trip/index_test.ts`:

```ts
import { assertEquals } from "jsr:@std/assert@1";
import { buildReceipt } from "../_shared/core.ts";
import type { FarePolicy } from "../_shared/core.ts";

const MOTO: FarePolicy = {
  vehicleClass: "moto",
  baseRwf: 400,
  perKmRwf: 250,
  perMinuteRwf: 20,
  minimumRwf: 700,
  commissionPct: 15,
};

Deno.test("a trip matching its quote receipts as a single line", () => {
  const r = buildReceipt(MOTO, 1700, 4000, 4000);
  assertEquals(r.lines.length, 1);
  assertEquals(r.totalRwf, 1700);
  assertEquals(r.commissionRwf, 255);
});

Deno.test("a detour beyond tolerance is itemised and raises commission", () => {
  const r = buildReceipt(MOTO, 1700, 4000, 5600);
  assertEquals(r.lines.length, 2);
  assertEquals(r.totalRwf, 2000);
  assertEquals(r.commissionRwf, 300);
});

Deno.test("commission never exceeds the fare", () => {
  const r = buildReceipt(MOTO, 1700, 4000, 4000);
  assertEquals(r.commissionRwf < r.totalRwf, true);
});
```

- [ ] **Step 3: Run the tests**

Run: `deno test --allow-read --config supabase/functions/deno.json supabase/functions/complete-trip/index_test.ts`
Expected: 3 tests pass.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions
git commit -m "feat(functions): complete a trip and issue an itemised receipt

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 10: Typed client bindings

**Files:**
- Create: `packages/data/src/trips.ts`
- Modify: `packages/data/src/index.ts`
- Test: `packages/data/test/trips.test.ts`

**Interfaces:**
- Consumes: `GeraClient` from `packages/data/src/client.ts`
- Produces:
  - `QuoteRequest`, `QuoteResult`, `CompleteTripResult` types
  - `requestQuote(client, req): Promise<QuoteResult>`
  - `createTripFromQuote(client, args): Promise<{ id: string; state: string }>`
  - `completeTrip(client, args): Promise<CompleteTripResult>`

- [ ] **Step 1: Write the failing test**

Create `packages/data/test/trips.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { requestQuote, completeTrip } from "../src/trips";
import type { GeraClient } from "../src/client";

function fakeClient(invokeResult: unknown, error: unknown = null): GeraClient {
  return {
    functions: { invoke: vi.fn().mockResolvedValue({ data: invokeResult, error }) },
  } as unknown as GeraClient;
}

describe("requestQuote", () => {
  it("returns the quote the edge function issued", async () => {
    const client = fakeClient({
      quoteId: "q1", amountRwf: 1700, expiresAt: "2026-09-24T12:00:00Z",
      vehicleClass: "moto", distanceM: 4000, durationS: 720,
    });
    const q = await requestQuote(client, {
      vehicleClass: "moto", distanceM: 4000, durationS: 720,
    });
    expect(q.amountRwf).toBe(1700);
    expect(q.quoteId).toBe("q1");
  });

  it("throws when the edge function reports an error", async () => {
    const client = fakeClient(null, { message: "no_fare_policy" });
    await expect(
      requestQuote(client, { vehicleClass: "moto", distanceM: 4000, durationS: 720 }),
    ).rejects.toThrow("no_fare_policy");
  });

  it("throws when the response is empty", async () => {
    const client = fakeClient(null);
    await expect(
      requestQuote(client, { vehicleClass: "moto", distanceM: 4000, durationS: 720 }),
    ).rejects.toThrow("quote failed");
  });
});

describe("completeTrip", () => {
  it("requires an idempotency key", async () => {
    const client = fakeClient({});
    await expect(
      completeTrip(client, { tripId: "t1", actualDistanceM: 4000, idempotencyKey: "" }),
    ).rejects.toThrow("idempotencyKey is required");
  });

  it("returns the receipt", async () => {
    const client = fakeClient({
      tripId: "t1", state: "completed",
      receipt: { lines: [{ label: "Fare", amountRwf: 1700 }], totalRwf: 1700 },
      commissionRwf: 255,
    });
    const r = await completeTrip(client, {
      tripId: "t1", actualDistanceM: 4000, idempotencyKey: "k1",
    });
    expect(r.receipt.totalRwf).toBe(1700);
    expect(r.commissionRwf).toBe(255);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gera/data test`
Expected: FAIL — cannot resolve `../src/trips`.

- [ ] **Step 3: Implement**

Create `packages/data/src/trips.ts`:

```ts
import type { GeraClient } from "./client";

export interface QuoteRequest {
  readonly vehicleClass: "moto" | "cab" | "cab_xl";
  readonly distanceM: number;
  readonly durationS: number;
}

export interface QuoteResult {
  readonly quoteId: string;
  readonly amountRwf: number;
  readonly expiresAt: string;
  readonly vehicleClass: string;
  readonly distanceM: number;
  readonly durationS: number;
}

export interface ReceiptLine {
  readonly label: string;
  readonly amountRwf: number;
}

export interface CompleteTripResult {
  readonly tripId: string;
  readonly state: string;
  readonly receipt: { readonly lines: readonly ReceiptLine[]; readonly totalRwf: number };
  readonly commissionRwf: number;
}

export async function requestQuote(
  client: GeraClient,
  req: QuoteRequest,
): Promise<QuoteResult> {
  const { data, error } = await client.functions.invoke("quote", { body: req });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("quote failed");
  return data as QuoteResult;
}

export interface CreateTripArgs {
  readonly quoteId: string;
  readonly pickup: { readonly lng: number; readonly lat: number };
  readonly pickupLabel: string;
  readonly pickupNote?: string;
  readonly dropoff: { readonly lng: number; readonly lat: number };
  readonly dropoffLabel: string;
}

export async function createTripFromQuote(
  client: GeraClient,
  args: CreateTripArgs,
): Promise<{ id: string; state: string }> {
  const { data, error } = await client.rpc("create_trip_from_quote", {
    p_quote_id: args.quoteId,
    p_pickup: `POINT(${args.pickup.lng} ${args.pickup.lat})`,
    p_pickup_label: args.pickupLabel,
    p_pickup_note: args.pickupNote ?? null,
    p_dropoff: `POINT(${args.dropoff.lng} ${args.dropoff.lat})`,
    p_dropoff_label: args.dropoffLabel,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("trip creation failed");
  return data as { id: string; state: string };
}

export interface CompleteTripArgs {
  readonly tripId: string;
  readonly actualDistanceM: number;
  readonly idempotencyKey: string;
}

export async function completeTrip(
  client: GeraClient,
  args: CompleteTripArgs,
): Promise<CompleteTripResult> {
  if (!args.idempotencyKey) throw new Error("idempotencyKey is required");
  const { data, error } = await client.functions.invoke("complete-trip", { body: args });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("completion failed");
  return data as CompleteTripResult;
}
```

- [ ] **Step 4: Export and verify**

Add to `packages/data/src/index.ts`:

```ts
export * from "./trips";
```

Run: `pnpm --filter @gera/data test && pnpm --filter @gera/data typecheck`
Expected: both PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/data
git commit -m "feat(data): typed bindings for quoting and completing trips

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 11: End-to-end proof against the live stack

The Phase 1 exit criterion was nearly declared met on mechanical evidence alone; a live walk then found four defects within a minute. This task exists so that does not repeat.

**Files:**
- Create: `scripts/e2e-trip-loop.mjs`
- Modify: root `package.json` (add an `e2e` script)

**Interfaces:**
- Consumes: the running local stack, all functions and RPCs above
- Produces: `pnpm e2e` — exits 0 only if a trip goes quote → create → assign → accept → start → complete with a correct ledger entry

- [ ] **Step 1: Write the script**

Create `scripts/e2e-trip-loop.mjs`:

```js
// Drives a whole trip through the real API surface, the way a device would.
// Uses the local stack's published demo keys - never run this against production.
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const API = "http://127.0.0.1:54321";
const JWT_SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";
const ANON = process.env.GERA_ANON_KEY;
const SERVICE = process.env.GERA_SERVICE_KEY;
if (!ANON || !SERVICE) {
  console.error("Set GERA_ANON_KEY and GERA_SERVICE_KEY from `supabase status`.");
  process.exit(1);
}

const RIDER = "11111111-aaaa-4aaa-8aaa-111111111111";
const DRIVER = "22222222-bbbb-4bbb-8bbb-222222222222";

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function mint(sub) {
  const h = b64({ alg: "HS256", typ: "JWT" });
  const p = b64({ sub, role: "authenticated", aud: "authenticated",
                  exp: Math.floor(Date.now() / 1000) + 3600 });
  const s = crypto.createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${s}`;
}

const psql = (sql) =>
  execFileSync("docker", [
    "exec", "supabase_db_driver_app", "psql", "-U", "postgres", "-d", "postgres", "-tA", "-c", sql,
  ]).toString().trim();

function check(label, actual, expected) {
  if (String(actual) !== String(expected)) {
    console.error(`FAIL ${label}: expected ${expected}, got ${actual}`);
    process.exit(1);
  }
  console.log(`ok   ${label}`);
}

// --- fixtures -------------------------------------------------------------
psql(`delete from auth.users where id in ('${RIDER}','${DRIVER}');`);
psql(`insert into auth.users (instance_id,id,aud,role,email) values
  ('00000000-0000-0000-0000-000000000000','${RIDER}','authenticated','authenticated','e2e.rider@test.local'),
  ('00000000-0000-0000-0000-000000000000','${DRIVER}','authenticated','authenticated','e2e.driver@test.local');`);
psql(`insert into public.profiles (id,role,first_name,phone) values
  ('${RIDER}','rider','Aline','+250788111111'),
  ('${DRIVER}','driver','Eric','+250788222222');`);
psql(`insert into public.drivers (id,verification) values ('${DRIVER}','verified');`);
psql(`insert into public.ledger_entries (driver_id,kind,amount_rwf)
      values ('${DRIVER}','topup_credit',5000);`);

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

// --- 1. quote -------------------------------------------------------------
const quote = await call("/functions/v1/quote", riderJwt, {
  vehicleClass: "moto", distanceM: 4000, durationS: 720,
});
check("quote returns 200", quote.status, 200);
check("quote is 1700 RWF", quote.body.amountRwf, 1700);

// --- 2. create the trip ---------------------------------------------------
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
check("trip starts in requested", created.body.state, "requested");

// --- 3. dispatch assigns the driver (service role) ------------------------
const assigned = await call("/rest/v1/rpc/assign_driver_to_trip", SERVICE, {
  p_trip_id: tripId, p_driver_id: DRIVER, p_idempotency_key: "offer-1",
});
check("driver assigned", assigned.status, 200);
check("trip is offered", assigned.body.state, "offered");

// --- 4. driver accepts, arrives, starts -----------------------------------
for (const [to, key] of [["accepted","a1"],["arrived","a2"],["in_progress","a3"]]) {
  const r = await call("/rest/v1/rpc/trip_transition", driverJwt, {
    p_trip_id: tripId, p_to: to, p_idempotency_key: key,
  });
  check(`transition to ${to}`, r.body.state, to);
}

// --- 5. complete ----------------------------------------------------------
const done = await call("/functions/v1/complete-trip", driverJwt, {
  tripId, actualDistanceM: 4100, idempotencyKey: "done-1",
});
check("completion returns 200", done.status, 200);
check("trip completed", done.body.state, "completed");
check("total is the quoted fare", done.body.receipt.totalRwf, 1700);
check("commission is 15%", done.body.commissionRwf, 255);

// --- 6. replay must not double-charge -------------------------------------
await call("/functions/v1/complete-trip", driverJwt, {
  tripId, actualDistanceM: 4100, idempotencyKey: "done-1",
});
check("exactly one commission debit",
  psql(`select count(*) from public.ledger_entries where trip_id='${tripId}';`), "1");

check("driver balance is 5000 - 255",
  psql(`select sum(case when kind in ('topup_credit','adjustment_credit')
        then amount_rwf else -amount_rwf end) from public.ledger_entries
        where driver_id='${DRIVER}';`), "4745");

psql(`delete from auth.users where id in ('${RIDER}','${DRIVER}');`);
console.log("\nAll end-to-end checks passed.");
```

- [ ] **Step 2: Add the script**

In the ROOT `package.json` scripts:

```json
"e2e": "node scripts/e2e-trip-loop.mjs"
```

- [ ] **Step 3: Run it**

Start the functions runtime: `pnpm dlx supabase@latest functions serve --no-verify-jwt`
Then, with the keys exported from `pnpm dlx supabase@latest status`:

```bash
GERA_ANON_KEY=<anon> GERA_SERVICE_KEY=<service_role> pnpm e2e
```

Expected: every check prints `ok`, and the script exits 0. Paste the real output.

If any check fails, fix the underlying code — never loosen a check to make the script pass.

- [ ] **Step 4: Commit**

```bash
git add scripts package.json
git commit -m "test: drive the whole trip loop against the live stack

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Definition of done

- [ ] `pnpm verify` exits 0 (typecheck across 5 packages, then all unit tests).
- [ ] `pnpm dlx supabase@latest test db` — 10 files, 91 assertions, PASS.
- [ ] `deno test` passes for `_shared`, `quote` and `complete-trip`.
- [ ] `pnpm e2e` exits 0 against the running stack.
- [ ] A replayed completion debits commission exactly once, proven in both pgTAP and the e2e script.
- [ ] No fare or commission arithmetic exists anywhere outside `packages/core`.

## Deliberately not in this plan

Plan 2b and later:

- PostGIS candidate matching and real-ETA ranking
- Sequential offers, the 15-second exclusive window, the `pg_cron` sweeper
- The simulation harness of virtual drivers
- Realtime driver-position streaming and the rider's live map
- The morphing bottom sheet, destination picker, vehicle selection UI
- Background location, turn-by-turn navigation
- Wallet top-up and the `PaymentProvider` interface
- **The minimum-balance gate on going online** (spec 3.5). `canGoOnline` already exists and is tested in `packages/core`, but wiring it belongs with presence and dispatch, not with completion.
- Contact masking (spec 3.6) — needs the in-trip screen to exist first
