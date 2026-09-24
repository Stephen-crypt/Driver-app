# Gera — Foundation & Domain Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Gera monorepo, a fully unit-tested dependency-free domain core (trip state machine, fare arithmetic, ledger arithmetic), the Postgres/PostGIS schema with adversarially-tested row-level security, and phone-OTP authentication with driver onboarding in both Expo apps.

**Architecture:** A pnpm workspace monorepo. Domain rules live once in `packages/core` as pure TypeScript functions with no I/O, and are mirrored in SQL inside the database so the server can enforce them independently — a parity test proves the two copies agree. Supabase provides Postgres, PostGIS, Auth and RLS; the database is the authority for trip state, and clients only ever *request* transitions.

**Tech Stack:** pnpm workspaces, TypeScript (strict), Vitest, Expo / React Native, Supabase (Postgres 15 + PostGIS 3.4), pgTAP, Zod.

**Spec:** `docs/superpowers/specs/2026-09-24-gera-core-trip-loop-design.md`

**Covers:** Spec Phase 0 and Phase 1. Phase 2 (core trip loop against the simulation harness) is a separate plan written after this one lands.

## Global Constraints

- **Package manager:** pnpm 9+. Node 20+.
- **TypeScript:** `strict: true` everywhere. No `any` in `packages/core`.
- **Money is integer RWF.** The Rwandan franc has no circulating subunit. Every monetary value in TypeScript and SQL is an integer number of francs. Never a float, never a decimal type, never minor units.
- **Fare rounding:** all rider-facing fares round **up** to the nearest 100 RWF. Rwandan prices are quoted in hundreds; a 1,847 RWF fare is wrong for this market.
- **`packages/core` has zero runtime dependencies.** No database, network, filesystem, React, or date library. Enforced by a test in Task 2.
- **Geography, not geometry.** All PostGIS spatial columns are `geography(Point, 4326)`. Distances come out in metres without projection choices.
- **Timestamps are `timestamptz`, server-generated.** `default now()`. Client-supplied timestamps are advisory only and never authoritative.
- **RLS is deny-by-default.** Every table has `enable row level security` and no policy is added without a matching pgTAP test proving the negative case.
- **Vehicle classes:** `moto`, `cab`, `cab_xl`. `moto` is always listed first and is the default.
- **Commit messages** use Conventional Commits and end with the trailer:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

---

## File Structure

| Path | Responsibility |
|---|---|
| `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json` | Workspace root and shared compiler config |
| `packages/core/src/trip/states.ts` | Trip state and actor enums — the single vocabulary |
| `packages/core/src/trip/transitions.ts` | The legal transition table (data, not logic) |
| `packages/core/src/trip/machine.ts` | `canTransition` / `applyTransition` — pure |
| `packages/core/src/fare/policy.ts` | `FarePolicy` type and rounding helper |
| `packages/core/src/fare/quote.ts` | Upfront quote arithmetic |
| `packages/core/src/fare/finalize.ts` | Final fare with distance-overage tolerance |
| `packages/core/src/ledger/commission.ts` | Commission and balance arithmetic |
| `packages/core/src/index.ts` | Public surface of the package |
| `supabase/migrations/0001_extensions_and_enums.sql` | Extensions, enum types |
| `supabase/migrations/0002_identity.sql` | `profiles`, `drivers`, `vehicles` |
| `supabase/migrations/0003_trips.sql` | `trips`, `trip_events`, `trip_offers` |
| `supabase/migrations/0004_presence.sql` | `driver_presence` + GiST index |
| `supabase/migrations/0005_money.sql` | `fare_policies`, `fare_quotes`, `ledger_entries` |
| `supabase/migrations/0006_transition_fn.sql` | `is_legal_transition()`, `trip_transition()` |
| `supabase/migrations/0007_rls.sql` | All row-level security policies |
| `supabase/tests/*.sql` | pgTAP suites, one per concern |
| `packages/ui/src/tokens.ts` | Colour, spacing, radius, type scale |
| `packages/ui/src/theme.ts` | Semantic theme built from tokens |
| `packages/data/src/client.ts` | Typed Supabase client factory |
| `packages/data/src/auth.ts` | Phone OTP wrappers |
| `apps/rider/`, `apps/driver/` | The two Expo apps |

---

## Task 1: Workspace scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/vitest.config.ts`

**Interfaces:**
- Consumes: nothing
- Produces: a `@gera/core` workspace package resolvable by path, and a working `pnpm test` at the root.

- [ ] **Step 1: Initialise the repo and root manifest**

```bash
git init
```

Create `package.json`:

```json
{
  "name": "gera",
  "private": true,
  "packageManager": "pnpm@9.12.0",
  "scripts": {
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Declare the workspace**

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

Create `.gitignore`:

```
node_modules/
dist/
.expo/
.env
.env.local
*.log
coverage/
```

- [ ] **Step 3: Shared compiler config**

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "declaration": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 4: Create the core package**

Create `packages/core/package.json`:

```json
{
  "name": "@gera/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {}
}
```

Create `packages/core/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

Create `packages/core/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
```

- [ ] **Step 5: Install and verify the workspace resolves**

Run: `pnpm install`
Expected: installs without error, creates `node_modules` and `pnpm-lock.yaml`.

Run: `pnpm -r typecheck`
Expected: PASS (nothing to check yet, exits 0).

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "chore: scaffold pnpm workspace with core package

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Trip state vocabulary and the zero-dependency guard

**Files:**
- Create: `packages/core/src/trip/states.ts`
- Create: `packages/core/src/index.ts`
- Test: `packages/core/test/no-dependencies.test.ts`

**Interfaces:**
- Consumes: Task 1's `@gera/core` package
- Produces: `TripState`, `Actor`, `TRIP_STATES`, `TERMINAL_STATES`, `isTerminal(state: TripState): boolean`

- [ ] **Step 1: Write the failing dependency-guard test**

Create `packages/core/test/no-dependencies.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import pkg from "../package.json" with { type: "json" };

describe("@gera/core packaging", () => {
  it("has zero runtime dependencies", () => {
    expect(pkg.dependencies ?? {}).toEqual({});
  });

  it("has zero peer dependencies", () => {
    expect((pkg as Record<string, unknown>).peerDependencies ?? {}).toEqual({});
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @gera/core test`
Expected: PASS. This test exists to fail later, the first time someone adds a dependency to the domain core.

- [ ] **Step 3: Write the failing state test**

Create `packages/core/test/trip/states.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { TRIP_STATES, TERMINAL_STATES, isTerminal } from "../../src/trip/states";

describe("trip states", () => {
  it("declares exactly the ten states in the spec", () => {
    expect([...TRIP_STATES].sort()).toEqual([
      "accepted",
      "arrived",
      "cancelled_by_driver",
      "cancelled_by_rider",
      "completed",
      "expired",
      "in_progress",
      "no_drivers",
      "offered",
      "requested",
    ]);
  });

  it("treats completed as terminal", () => {
    expect(isTerminal("completed")).toBe(true);
  });

  it("treats in_progress as non-terminal", () => {
    expect(isTerminal("in_progress")).toBe(false);
  });

  it("marks every cancellation and dead-end as terminal", () => {
    expect([...TERMINAL_STATES].sort()).toEqual([
      "cancelled_by_driver",
      "cancelled_by_rider",
      "completed",
      "expired",
      "no_drivers",
    ]);
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `pnpm --filter @gera/core test`
Expected: FAIL — cannot resolve `../../src/trip/states`.

- [ ] **Step 5: Implement the states module**

Create `packages/core/src/trip/states.ts`:

```ts
export const TRIP_STATES = [
  "requested",
  "offered",
  "accepted",
  "arrived",
  "in_progress",
  "completed",
  "cancelled_by_rider",
  "cancelled_by_driver",
  "expired",
  "no_drivers",
] as const;

export type TripState = (typeof TRIP_STATES)[number];

export const ACTORS = ["rider", "driver", "system"] as const;
export type Actor = (typeof ACTORS)[number];

export const TERMINAL_STATES = [
  "completed",
  "cancelled_by_rider",
  "cancelled_by_driver",
  "expired",
  "no_drivers",
] as const satisfies readonly TripState[];

export function isTerminal(state: TripState): boolean {
  return (TERMINAL_STATES as readonly TripState[]).includes(state);
}
```

- [ ] **Step 6: Create the public surface**

Create `packages/core/src/index.ts`:

```ts
export * from "./trip/states";
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter @gera/core test`
Expected: PASS, 6 tests.

- [ ] **Step 8: Commit**

```bash
git add packages/core
git commit -m "feat(core): trip state vocabulary with zero-dependency guard

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: The trip state machine

**Files:**
- Create: `packages/core/src/trip/transitions.ts`
- Create: `packages/core/src/trip/machine.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/trip/machine.test.ts`

**Interfaces:**
- Consumes: `TripState`, `Actor`, `isTerminal` from Task 2
- Produces:
  - `TRANSITIONS: readonly TransitionRule[]` where `TransitionRule = { from: TripState; to: TripState; actors: readonly Actor[] }`
  - `canTransition(from: TripState, to: TripState, actor: Actor): boolean`
  - `applyTransition(from: TripState, to: TripState, actor: Actor): TransitionResult`
  - `TransitionResult = { ok: true; state: TripState } | { ok: false; reason: "illegal_edge" | "wrong_actor" | "terminal" }`

**Why the negative matrix matters:** an illegal transition that silently succeeds is how a driver marks a trip complete without ever picking anyone up. This task tests every *disallowed* pair, not a sample.

- [ ] **Step 1: Write the failing happy-path tests**

Create `packages/core/test/trip/machine.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { TRIP_STATES, type TripState, type Actor } from "../../src/trip/states";
import { canTransition, applyTransition, TRANSITIONS } from "../../src/trip/machine";

describe("legal transitions", () => {
  it("system may offer a requested trip", () => {
    expect(canTransition("requested", "offered", "system")).toBe(true);
  });

  it("driver may accept an offered trip", () => {
    expect(canTransition("offered", "accepted", "driver")).toBe(true);
  });

  it("driver may mark arrival after accepting", () => {
    expect(canTransition("accepted", "arrived", "driver")).toBe(true);
  });

  it("driver may start the trip after arriving", () => {
    expect(canTransition("arrived", "in_progress", "driver")).toBe(true);
  });

  it("driver may complete a trip in progress", () => {
    expect(canTransition("in_progress", "completed", "driver")).toBe(true);
  });

  it("an offer may bounce back to offered when declined", () => {
    expect(canTransition("offered", "offered", "system")).toBe(true);
  });

  it("applyTransition returns the new state", () => {
    expect(applyTransition("arrived", "in_progress", "driver")).toEqual({
      ok: true,
      state: "in_progress",
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @gera/core test`
Expected: FAIL — cannot resolve `../../src/trip/machine`.

- [ ] **Step 3: Write the transition table**

Create `packages/core/src/trip/transitions.ts`:

```ts
import type { Actor, TripState } from "./states";

export interface TransitionRule {
  readonly from: TripState;
  readonly to: TripState;
  readonly actors: readonly Actor[];
}

/**
 * The complete set of legal edges. Anything absent from this list is illegal.
 * This table is mirrored in SQL by is_legal_transition(); the parity test in
 * Task 9 proves the two copies agree.
 */
export const TRANSITIONS: readonly TransitionRule[] = [
  { from: "requested", to: "offered", actors: ["system"] },
  { from: "requested", to: "no_drivers", actors: ["system"] },
  { from: "requested", to: "cancelled_by_rider", actors: ["rider"] },

  // A declined or timed-out offer re-enters `offered` for the next candidate.
  { from: "offered", to: "offered", actors: ["system"] },
  { from: "offered", to: "accepted", actors: ["driver"] },
  { from: "offered", to: "expired", actors: ["system"] },
  { from: "offered", to: "no_drivers", actors: ["system"] },
  { from: "offered", to: "cancelled_by_rider", actors: ["rider"] },

  { from: "accepted", to: "arrived", actors: ["driver"] },
  { from: "accepted", to: "cancelled_by_rider", actors: ["rider"] },
  { from: "accepted", to: "cancelled_by_driver", actors: ["driver"] },
  // Heartbeat loss re-dispatches a trip that never reached pickup.
  { from: "accepted", to: "offered", actors: ["system"] },

  { from: "arrived", to: "in_progress", actors: ["driver"] },
  { from: "arrived", to: "cancelled_by_rider", actors: ["rider"] },
  { from: "arrived", to: "cancelled_by_driver", actors: ["driver"] },

  { from: "in_progress", to: "completed", actors: ["driver"] },
] as const;
```

- [ ] **Step 4: Implement the machine**

Create `packages/core/src/trip/machine.ts`:

```ts
import { isTerminal, type Actor, type TripState } from "./states";
import { TRANSITIONS } from "./transitions";

export { TRANSITIONS };
export type { TransitionRule } from "./transitions";

export type TransitionResult =
  | { ok: true; state: TripState }
  | { ok: false; reason: "illegal_edge" | "wrong_actor" | "terminal" };

export function canTransition(from: TripState, to: TripState, actor: Actor): boolean {
  if (isTerminal(from)) return false;
  return TRANSITIONS.some(
    (rule) => rule.from === from && rule.to === to && rule.actors.includes(actor),
  );
}

export function applyTransition(
  from: TripState,
  to: TripState,
  actor: Actor,
): TransitionResult {
  if (isTerminal(from)) return { ok: false, reason: "terminal" };

  const edge = TRANSITIONS.find((rule) => rule.from === from && rule.to === to);
  if (!edge) return { ok: false, reason: "illegal_edge" };
  if (!edge.actors.includes(actor)) return { ok: false, reason: "wrong_actor" };

  return { ok: true, state: to };
}
```

- [ ] **Step 5: Run to verify the happy paths pass**

Run: `pnpm --filter @gera/core test`
Expected: PASS.

- [ ] **Step 6: Add the exhaustive negative matrix**

Append to `packages/core/test/trip/machine.test.ts`:

```ts
describe("the negative matrix", () => {
  const ACTORS: Actor[] = ["rider", "driver", "system"];

  const legal = new Set(
    TRANSITIONS.flatMap((r) => r.actors.map((a) => `${r.from}>${r.to}>${a}`)),
  );

  it("rejects every pair not in the transition table", () => {
    const wrongly_allowed: string[] = [];

    for (const from of TRIP_STATES) {
      for (const to of TRIP_STATES) {
        for (const actor of ACTORS) {
          const key = `${from}>${to}>${actor}`;
          if (legal.has(key)) continue;
          if (canTransition(from as TripState, to as TripState, actor)) {
            wrongly_allowed.push(key);
          }
        }
      }
    }

    expect(wrongly_allowed).toEqual([]);
  });

  it("names the reason a driver cannot complete an accepted trip", () => {
    expect(applyTransition("accepted", "completed", "driver")).toEqual({
      ok: false,
      reason: "illegal_edge",
    });
  });

  it("names the reason a rider cannot start a trip", () => {
    expect(applyTransition("arrived", "in_progress", "rider")).toEqual({
      ok: false,
      reason: "wrong_actor",
    });
  });

  it("refuses to move out of a terminal state", () => {
    expect(applyTransition("completed", "in_progress", "driver")).toEqual({
      ok: false,
      reason: "terminal",
    });
  });

  it("never allows a rider to cancel once the trip is in progress", () => {
    expect(canTransition("in_progress", "cancelled_by_rider", "rider")).toBe(false);
  });
});
```

- [ ] **Step 7: Export from the package surface**

Modify `packages/core/src/index.ts` to read:

```ts
export * from "./trip/states";
export * from "./trip/machine";
```

- [ ] **Step 8: Run the full suite**

Run: `pnpm --filter @gera/core test`
Expected: PASS. The matrix test walks 10 × 10 × 3 = 300 combinations and asserts that exactly the 16 table entries are permitted.

- [ ] **Step 9: Commit**

```bash
git add packages/core
git commit -m "feat(core): trip state machine with exhaustive negative matrix

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Fare arithmetic

**Files:**
- Create: `packages/core/src/fare/policy.ts`
- Create: `packages/core/src/fare/quote.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/fare/quote.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces:
  - `VehicleClass = "moto" | "cab" | "cab_xl"`
  - `FarePolicy = { vehicleClass: VehicleClass; baseRwf: number; perKmRwf: number; perMinuteRwf: number; minimumRwf: number }`
  - `roundFareRwf(amount: number): number` — rounds **up** to the nearest 100
  - `quoteFare(policy: FarePolicy, distanceMetres: number, durationSeconds: number): number`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/test/fare/quote.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { roundFareRwf } from "../../src/fare/policy";
import { quoteFare } from "../../src/fare/quote";
import type { FarePolicy } from "../../src/fare/policy";

const MOTO: FarePolicy = {
  vehicleClass: "moto",
  baseRwf: 400,
  perKmRwf: 250,
  perMinuteRwf: 20,
  minimumRwf: 700,
};

describe("roundFareRwf", () => {
  it("rounds up to the nearest hundred", () => {
    expect(roundFareRwf(1847)).toBe(1900);
  });

  it("leaves exact hundreds alone", () => {
    expect(roundFareRwf(1800)).toBe(1800);
  });

  it("rounds a single franc up a whole step", () => {
    expect(roundFareRwf(1801)).toBe(1900);
  });

  it("handles zero", () => {
    expect(roundFareRwf(0)).toBe(0);
  });
});

describe("quoteFare", () => {
  it("charges base plus distance plus time, rounded up", () => {
    // 400 base + (4.0km x 250) + (12min x 20) = 400 + 1000 + 240 = 1640 -> 1700
    expect(quoteFare(MOTO, 4000, 720)).toBe(1700);
  });

  it("applies the minimum fare to very short trips", () => {
    // 400 + (0.2km x 250) + (1min x 20) = 400 + 50 + 20 = 470 -> below 700 minimum
    expect(quoteFare(MOTO, 200, 60)).toBe(700);
  });

  it("returns the minimum for a zero-length trip", () => {
    expect(quoteFare(MOTO, 0, 0)).toBe(700);
  });

  it("returns an integer for fractional inputs", () => {
    const result = quoteFare(MOTO, 3333, 401);
    expect(Number.isInteger(result)).toBe(true);
  });

  it("rejects negative distance", () => {
    expect(() => quoteFare(MOTO, -1, 60)).toThrow("distanceMetres must be >= 0");
  });

  it("rejects negative duration", () => {
    expect(() => quoteFare(MOTO, 1000, -1)).toThrow("durationSeconds must be >= 0");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @gera/core test`
Expected: FAIL — cannot resolve `../../src/fare/policy`.

- [ ] **Step 3: Implement the policy module**

Create `packages/core/src/fare/policy.ts`:

```ts
export const VEHICLE_CLASSES = ["moto", "cab", "cab_xl"] as const;
export type VehicleClass = (typeof VEHICLE_CLASSES)[number];

export interface FarePolicy {
  readonly vehicleClass: VehicleClass;
  /** Flat charge applied to every trip, in whole RWF. */
  readonly baseRwf: number;
  readonly perKmRwf: number;
  readonly perMinuteRwf: number;
  /** No rider is ever quoted below this, in whole RWF. */
  readonly minimumRwf: number;
}

/** Rider-facing fares are always whole hundreds of francs, rounded up. */
export function roundFareRwf(amount: number): number {
  return Math.ceil(amount / 100) * 100;
}
```

- [ ] **Step 4: Implement the quote**

Create `packages/core/src/fare/quote.ts`:

```ts
import { roundFareRwf, type FarePolicy } from "./policy";

export function quoteFare(
  policy: FarePolicy,
  distanceMetres: number,
  durationSeconds: number,
): number {
  if (distanceMetres < 0) throw new Error("distanceMetres must be >= 0");
  if (durationSeconds < 0) throw new Error("durationSeconds must be >= 0");

  const distanceCharge = (distanceMetres / 1000) * policy.perKmRwf;
  const timeCharge = (durationSeconds / 60) * policy.perMinuteRwf;
  const raw = policy.baseRwf + distanceCharge + timeCharge;

  return roundFareRwf(Math.max(raw, policy.minimumRwf));
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @gera/core test`
Expected: PASS.

- [ ] **Step 6: Export and commit**

Modify `packages/core/src/index.ts` to read:

```ts
export * from "./trip/states";
export * from "./trip/machine";
export * from "./fare/policy";
export * from "./fare/quote";
```

Run: `pnpm --filter @gera/core typecheck`
Expected: PASS.

```bash
git add packages/core
git commit -m "feat(core): upfront fare quoting in whole RWF

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: Final fare with overage tolerance

**Files:**
- Create: `packages/core/src/fare/finalize.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/fare/finalize.test.ts`

**Interfaces:**
- Consumes: `FarePolicy`, `roundFareRwf` from Task 4
- Produces:
  - `OVERAGE_TOLERANCE = 0.15`
  - `FinalFare = { totalRwf: number; quotedRwf: number; overageRwf: number; overageMetres: number }`
  - `finalizeFare(policy: FarePolicy, quotedRwf: number, quotedDistanceMetres: number, actualDistanceMetres: number): FinalFare`

**Rule from the spec (3.4):** the final fare equals the quote unless actual distance exceeds quoted distance by more than the tolerance. Overage is charged only on the distance *beyond* the tolerance band, and is always itemised separately — never folded silently into the total.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/test/fare/finalize.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { finalizeFare, OVERAGE_TOLERANCE } from "../../src/fare/finalize";
import type { FarePolicy } from "../../src/fare/policy";

const MOTO: FarePolicy = {
  vehicleClass: "moto",
  baseRwf: 400,
  perKmRwf: 250,
  perMinuteRwf: 20,
  minimumRwf: 700,
};

describe("finalizeFare", () => {
  it("honours the quote when the trip matches", () => {
    const f = finalizeFare(MOTO, 1700, 4000, 4000);
    expect(f).toEqual({
      totalRwf: 1700,
      quotedRwf: 1700,
      overageRwf: 0,
      overageMetres: 0,
    });
  });

  it("honours the quote when the trip is shorter than quoted", () => {
    const f = finalizeFare(MOTO, 1700, 4000, 3000);
    expect(f.totalRwf).toBe(1700);
    expect(f.overageRwf).toBe(0);
  });

  it("absorbs a detour inside the tolerance band", () => {
    // 15% of 4000m = 600m band; 4500m is inside it.
    const f = finalizeFare(MOTO, 1700, 4000, 4500);
    expect(f.totalRwf).toBe(1700);
    expect(f.overageMetres).toBe(0);
  });

  it("charges only the distance beyond the tolerance band", () => {
    // band ends at 4600m; actual 5600m -> 1000m chargeable at 250/km = 250 -> 300
    const f = finalizeFare(MOTO, 1700, 4000, 5600);
    expect(f.overageMetres).toBe(1000);
    expect(f.overageRwf).toBe(300);
    expect(f.totalRwf).toBe(2000);
  });

  it("exposes the quote unchanged alongside the overage", () => {
    const f = finalizeFare(MOTO, 1700, 4000, 5600);
    expect(f.quotedRwf).toBe(1700);
    expect(f.totalRwf).toBe(f.quotedRwf + f.overageRwf);
  });

  it("uses the declared tolerance constant", () => {
    expect(OVERAGE_TOLERANCE).toBe(0.15);
  });

  it("rejects a negative actual distance", () => {
    expect(() => finalizeFare(MOTO, 1700, 4000, -1)).toThrow(
      "actualDistanceMetres must be >= 0",
    );
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @gera/core test`
Expected: FAIL — cannot resolve `../../src/fare/finalize`.

- [ ] **Step 3: Implement**

Create `packages/core/src/fare/finalize.ts`:

```ts
import { roundFareRwf, type FarePolicy } from "./policy";

/** Detours up to this fraction beyond the quoted distance are absorbed. */
export const OVERAGE_TOLERANCE = 0.15;

export interface FinalFare {
  readonly totalRwf: number;
  readonly quotedRwf: number;
  readonly overageRwf: number;
  readonly overageMetres: number;
}

export function finalizeFare(
  policy: FarePolicy,
  quotedRwf: number,
  quotedDistanceMetres: number,
  actualDistanceMetres: number,
): FinalFare {
  if (actualDistanceMetres < 0) throw new Error("actualDistanceMetres must be >= 0");

  const bandEnd = quotedDistanceMetres * (1 + OVERAGE_TOLERANCE);
  const overageMetres = Math.max(0, Math.round(actualDistanceMetres - bandEnd));
  const overageRwf =
    overageMetres === 0 ? 0 : roundFareRwf((overageMetres / 1000) * policy.perKmRwf);

  return {
    totalRwf: quotedRwf + overageRwf,
    quotedRwf,
    overageRwf,
    overageMetres,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gera/core test`
Expected: PASS.

- [ ] **Step 5: Export and commit**

Add to `packages/core/src/index.ts`:

```ts
export * from "./fare/finalize";
```

```bash
git add packages/core
git commit -m "feat(core): final fare with itemised distance overage

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: Commission and ledger arithmetic

**Files:**
- Create: `packages/core/src/ledger/commission.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/ledger/commission.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces:
  - `LedgerEntryKind = "commission_debit" | "topup_credit" | "adjustment_credit" | "adjustment_debit"`
  - `LedgerEntry = { kind: LedgerEntryKind; amountRwf: number }` — `amountRwf` is **always positive**; direction comes from `kind`
  - `commissionFor(fareRwf: number, ratePercent: number): number`
  - `balanceOf(entries: readonly LedgerEntry[]): number`
  - `canGoOnline(balanceRwf: number, minimumRwf: number): boolean`

**Design note:** amounts are stored positive and signed by kind. A ledger where negative numbers mean debits invites sign bugs that silently corrupt balances; making direction a typed enum makes a wrong debit a type error rather than an arithmetic one.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/test/ledger/commission.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  commissionFor,
  balanceOf,
  canGoOnline,
  type LedgerEntry,
} from "../../src/ledger/commission";

describe("commissionFor", () => {
  it("takes the configured percentage of the fare", () => {
    expect(commissionFor(2000, 15)).toBe(300);
  });

  it("rounds to a whole franc", () => {
    // 15% of 1700 = 255
    expect(commissionFor(1700, 15)).toBe(255);
    // 15% of 1750 = 262.5 -> 263
    expect(commissionFor(1750, 15)).toBe(263);
  });

  it("returns zero for a zero fare", () => {
    expect(commissionFor(0, 15)).toBe(0);
  });

  it("rejects a rate outside 0-100", () => {
    expect(() => commissionFor(2000, -1)).toThrow("ratePercent must be between 0 and 100");
    expect(() => commissionFor(2000, 101)).toThrow("ratePercent must be between 0 and 100");
  });
});

describe("balanceOf", () => {
  it("is zero for an empty ledger", () => {
    expect(balanceOf([])).toBe(0);
  });

  it("adds credits and subtracts debits", () => {
    const entries: LedgerEntry[] = [
      { kind: "topup_credit", amountRwf: 5000 },
      { kind: "commission_debit", amountRwf: 300 },
      { kind: "commission_debit", amountRwf: 255 },
    ];
    expect(balanceOf(entries)).toBe(4445);
  });

  it("applies adjustments in both directions", () => {
    const entries: LedgerEntry[] = [
      { kind: "topup_credit", amountRwf: 1000 },
      { kind: "adjustment_debit", amountRwf: 200 },
      { kind: "adjustment_credit", amountRwf: 50 },
    ];
    expect(balanceOf(entries)).toBe(850);
  });

  it("can go negative when commission outruns top-ups", () => {
    const entries: LedgerEntry[] = [
      { kind: "topup_credit", amountRwf: 100 },
      { kind: "commission_debit", amountRwf: 300 },
    ];
    expect(balanceOf(entries)).toBe(-200);
  });

  it("rejects a negative amount", () => {
    expect(() => balanceOf([{ kind: "topup_credit", amountRwf: -1 }])).toThrow(
      "amountRwf must be >= 0",
    );
  });
});

describe("canGoOnline", () => {
  it("permits a driver at exactly the minimum", () => {
    expect(canGoOnline(500, 500)).toBe(true);
  });

  it("blocks a driver below the minimum", () => {
    expect(canGoOnline(499, 500)).toBe(false);
  });

  it("blocks a driver in arrears", () => {
    expect(canGoOnline(-200, 500)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @gera/core test`
Expected: FAIL — cannot resolve `../../src/ledger/commission`.

- [ ] **Step 3: Implement**

Create `packages/core/src/ledger/commission.ts`:

```ts
export const LEDGER_ENTRY_KINDS = [
  "commission_debit",
  "topup_credit",
  "adjustment_credit",
  "adjustment_debit",
] as const;

export type LedgerEntryKind = (typeof LEDGER_ENTRY_KINDS)[number];

export interface LedgerEntry {
  readonly kind: LedgerEntryKind;
  /** Always positive. Direction is carried by `kind`, never by the sign. */
  readonly amountRwf: number;
}

const CREDIT_KINDS: readonly LedgerEntryKind[] = ["topup_credit", "adjustment_credit"];

export function commissionFor(fareRwf: number, ratePercent: number): number {
  if (ratePercent < 0 || ratePercent > 100) {
    throw new Error("ratePercent must be between 0 and 100");
  }
  return Math.round((fareRwf * ratePercent) / 100);
}

export function balanceOf(entries: readonly LedgerEntry[]): number {
  return entries.reduce((total, entry) => {
    if (entry.amountRwf < 0) throw new Error("amountRwf must be >= 0");
    return CREDIT_KINDS.includes(entry.kind)
      ? total + entry.amountRwf
      : total - entry.amountRwf;
  }, 0);
}

export function canGoOnline(balanceRwf: number, minimumRwf: number): boolean {
  return balanceRwf >= minimumRwf;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gera/core test`
Expected: PASS.

- [ ] **Step 5: Export and commit**

Add to `packages/core/src/index.ts`:

```ts
export * from "./ledger/commission";
```

Run: `pnpm --filter @gera/core test && pnpm --filter @gera/core typecheck`
Expected: both PASS.

```bash
git add packages/core
git commit -m "feat(core): commission and append-only ledger arithmetic

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: Database schema — extensions, enums, identity

**Files:**
- Create: `supabase/migrations/0001_extensions_and_enums.sql`
- Create: `supabase/migrations/0002_identity.sql`
- Test: `supabase/tests/001_schema.test.sql`

**Interfaces:**
- Consumes: the state and class vocabularies from Tasks 2, 4, 6 — the SQL enums must match them exactly
- Produces: tables `profiles`, `drivers`, `vehicles`; enums `user_role`, `vehicle_class`, `trip_state`, `driver_status`, `verification_status`, `ledger_entry_kind`

- [ ] **Step 1: Initialise Supabase locally**

Run: `pnpm dlx supabase init`
Then: `pnpm dlx supabase start`
Expected: local stack boots and prints an API URL, anon key, and service-role key. Save these for Task 11.

- [ ] **Step 2: Write the extensions and enums migration**

Create `supabase/migrations/0001_extensions_and_enums.sql`:

```sql
create extension if not exists postgis;
create extension if not exists pgcrypto;
create extension if not exists pg_cron;

create type user_role as enum ('rider', 'driver', 'ops');

create type vehicle_class as enum ('moto', 'cab', 'cab_xl');

create type trip_state as enum (
  'requested',
  'offered',
  'accepted',
  'arrived',
  'in_progress',
  'completed',
  'cancelled_by_rider',
  'cancelled_by_driver',
  'expired',
  'no_drivers'
);

create type trip_actor as enum ('rider', 'driver', 'system');

create type driver_status as enum ('offline', 'online', 'on_trip');

create type verification_status as enum ('pending', 'submitted', 'verified', 'rejected');

create type ledger_entry_kind as enum (
  'commission_debit',
  'topup_credit',
  'adjustment_credit',
  'adjustment_debit'
);
```

- [ ] **Step 3: Write the identity migration**

Create `supabase/migrations/0002_identity.sql`:

```sql
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  role        user_role   not null default 'rider',
  first_name  text        not null,
  phone       text        not null unique,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on column public.profiles.phone is
  'E.164, e.g. +2507XXXXXXXX. Disclosed to a counterparty only during an active trip.';

create table public.drivers (
  id                  uuid primary key references public.profiles (id) on delete cascade,
  verification        verification_status not null default 'pending',
  verification_notes  text,
  national_id         text,
  licence_number      text,
  rating_sum          integer not null default 0,
  rating_count        integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table public.vehicles (
  id            uuid primary key default gen_random_uuid(),
  driver_id     uuid not null references public.drivers (id) on delete cascade,
  class         vehicle_class not null,
  plate         text not null,
  -- Kigali motos carry a numbered vest; riders identify the moto by this number.
  vest_number   text,
  is_active     boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (driver_id, plate)
);

-- A driver may have at most one active vehicle at a time.
create unique index vehicles_one_active_per_driver
  on public.vehicles (driver_id)
  where is_active;

create index vehicles_driver_idx on public.vehicles (driver_id);
```

- [ ] **Step 4: Apply and verify the migration runs**

Run: `pnpm dlx supabase db reset`
Expected: migrations apply cleanly, no errors.

- [ ] **Step 5: Write a schema assertion test**

Create `supabase/tests/001_schema.test.sql`:

```sql
begin;
select plan(6);

select has_table('public', 'profiles', 'profiles table exists');
select has_table('public', 'drivers', 'drivers table exists');
select has_table('public', 'vehicles', 'vehicles table exists');

select has_extension('postgis', 'postgis is installed');

select col_is_pk('public', 'profiles', 'id', 'profiles.id is the primary key');

select is(
  (select count(*)::int from pg_enum e
    join pg_type t on t.oid = e.enumtypid
   where t.typname = 'trip_state'),
  10,
  'trip_state enum has exactly ten values'
);

select * from finish();
rollback;
```

- [ ] **Step 6: Enable pgTAP and run the test**

Add to the top of `supabase/migrations/0001_extensions_and_enums.sql`:

```sql
create extension if not exists pgtap;
```

Run: `pnpm dlx supabase db reset && pnpm dlx supabase test db`
Expected: PASS, 6 assertions.

- [ ] **Step 7: Commit**

```bash
git add supabase
git commit -m "feat(db): extensions, enums, and identity tables

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: Database schema — trips, presence, money

**Files:**
- Create: `supabase/migrations/0003_trips.sql`
- Create: `supabase/migrations/0004_presence.sql`
- Create: `supabase/migrations/0005_money.sql`
- Test: `supabase/tests/002_tables.test.sql`

**Interfaces:**
- Consumes: enums from Task 7
- Produces: tables `trips`, `trip_events`, `trip_offers`, `driver_presence`, `fare_policies`, `fare_quotes`, `ledger_entries`, `saved_places`, `landmarks`

- [ ] **Step 1: Write the trips migration**

Create `supabase/migrations/0003_trips.sql`:

```sql
create table public.trips (
  id                    uuid primary key default gen_random_uuid(),
  rider_id              uuid not null references public.profiles (id),
  driver_id             uuid references public.drivers (id),
  vehicle_class         vehicle_class not null,
  -- `state` is a projection maintained by trip_transition(); trip_events is the truth.
  state                 trip_state not null default 'requested',
  pickup                geography(Point, 4326) not null,
  pickup_label          text not null,
  pickup_note           text,
  dropoff               geography(Point, 4326) not null,
  dropoff_label         text not null,
  quoted_distance_m     integer,
  quoted_duration_s     integer,
  actual_distance_m     integer,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on column public.trips.pickup_note is
  'Rider free text, e.g. "blue gate opposite the pharmacy". Shown large to the driver.';

create index trips_rider_idx  on public.trips (rider_id, created_at desc);
create index trips_driver_idx on public.trips (driver_id, created_at desc);
create index trips_open_idx   on public.trips (state)
  where state in ('requested', 'offered', 'accepted', 'arrived', 'in_progress');

create table public.trip_events (
  id               bigint generated always as identity primary key,
  trip_id          uuid not null references public.trips (id) on delete cascade,
  from_state       trip_state not null,
  to_state         trip_state not null,
  actor            trip_actor not null,
  actor_id         uuid references public.profiles (id),
  idempotency_key  text not null,
  meta             jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  unique (trip_id, idempotency_key)
);

create index trip_events_trip_idx on public.trip_events (trip_id, id);

create table public.trip_offers (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips (id) on delete cascade,
  driver_id   uuid not null references public.drivers (id),
  rank        integer not null,
  eta_seconds integer,
  expires_at  timestamptz not null,
  outcome     text check (outcome in ('accepted', 'declined', 'timed_out')),
  created_at  timestamptz not null default now()
);

create index trip_offers_open_idx on public.trip_offers (driver_id, expires_at)
  where outcome is null;
```

- [ ] **Step 2: Write the presence migration**

Create `supabase/migrations/0004_presence.sql`:

```sql
-- One row per driver, UPDATED IN PLACE. This table must never grow with time;
-- historical breadcrumbs belong in trip_track_points.
create table public.driver_presence (
  driver_id      uuid primary key references public.drivers (id) on delete cascade,
  status         driver_status not null default 'offline',
  vehicle_class  vehicle_class,
  position       geography(Point, 4326),
  heading_deg    smallint,
  speed_mps      real,
  accuracy_m     real,
  heartbeat_at   timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- The matching index. Partial, so it only holds drivers who can actually be dispatched.
create index driver_presence_dispatchable_idx
  on public.driver_presence
  using gist (position)
  where status = 'online';

create index driver_presence_heartbeat_idx on public.driver_presence (heartbeat_at)
  where status <> 'offline';

create table public.trip_track_points (
  id          bigint generated always as identity primary key,
  trip_id     uuid not null references public.trips (id) on delete cascade,
  position    geography(Point, 4326) not null,
  accuracy_m  real,
  recorded_at timestamptz not null default now()
);

create index trip_track_points_trip_idx on public.trip_track_points (trip_id, recorded_at);
```

- [ ] **Step 3: Write the money migration**

Create `supabase/migrations/0005_money.sql`:

```sql
-- Versioned and effective-dated: a price change never rewrites history.
create table public.fare_policies (
  id                uuid primary key default gen_random_uuid(),
  vehicle_class     vehicle_class not null,
  base_rwf          integer not null check (base_rwf >= 0),
  per_km_rwf        integer not null check (per_km_rwf >= 0),
  per_minute_rwf    integer not null check (per_minute_rwf >= 0),
  minimum_rwf       integer not null check (minimum_rwf >= 0),
  commission_pct    numeric(5,2) not null check (commission_pct between 0 and 100),
  effective_from    timestamptz not null default now(),
  effective_to      timestamptz,
  created_at        timestamptz not null default now()
);

create index fare_policies_lookup_idx
  on public.fare_policies (vehicle_class, effective_from desc);

create table public.fare_quotes (
  id             uuid primary key default gen_random_uuid(),
  rider_id       uuid not null references public.profiles (id),
  policy_id      uuid not null references public.fare_policies (id),
  vehicle_class  vehicle_class not null,
  distance_m     integer not null,
  duration_s     integer not null,
  amount_rwf     integer not null check (amount_rwf >= 0),
  expires_at     timestamptz not null,
  created_at     timestamptz not null default now()
);

-- APPEND ONLY. Never updated, never deleted. Corrections are compensating rows.
create table public.ledger_entries (
  id          bigint generated always as identity primary key,
  driver_id   uuid not null references public.drivers (id),
  trip_id     uuid references public.trips (id),
  kind        ledger_entry_kind not null,
  -- Always positive; direction is carried by `kind`.
  amount_rwf  integer not null check (amount_rwf >= 0),
  memo        text,
  created_at  timestamptz not null default now()
);

create index ledger_entries_driver_idx on public.ledger_entries (driver_id, id);

create table public.saved_places (
  id         uuid primary key default gen_random_uuid(),
  rider_id   uuid not null references public.profiles (id) on delete cascade,
  label      text not null,
  position   geography(Point, 4326) not null,
  note       text,
  created_at timestamptz not null default now()
);

create index saved_places_rider_idx on public.saved_places (rider_id);

-- The curated gazetteer that makes landmark-first search possible.
create table public.landmarks (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  sector     text,
  position   geography(Point, 4326) not null,
  aliases    text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index landmarks_position_idx on public.landmarks using gist (position);
create index landmarks_name_idx on public.landmarks using gin (to_tsvector('simple', name));
```

- [ ] **Step 4: Apply the migrations**

Run: `pnpm dlx supabase db reset`
Expected: all migrations apply cleanly.

- [ ] **Step 5: Write the structural test**

Create `supabase/tests/002_tables.test.sql`:

```sql
begin;
select plan(7);

select has_table('public', 'trips', 'trips table exists');
select has_table('public', 'trip_events', 'trip_events table exists');
select has_table('public', 'driver_presence', 'driver_presence table exists');
select has_table('public', 'ledger_entries', 'ledger_entries table exists');

select has_index(
  'public', 'driver_presence', 'driver_presence_dispatchable_idx',
  'the dispatch GiST index exists'
);

select has_index(
  'public', 'trip_events', 'trip_events_trip_idx',
  'trip_events is indexed by trip'
);

-- Idempotency is enforced by the database, not by hope.
select col_is_unique(
  'public', 'trip_events', ARRAY['trip_id', 'idempotency_key'],
  'a trip cannot record the same idempotency key twice'
);

select * from finish();
rollback;
```

- [ ] **Step 6: Run the tests**

Run: `pnpm dlx supabase test db`
Expected: PASS, all assertions across both test files.

- [ ] **Step 7: Commit**

```bash
git add supabase
git commit -m "feat(db): trips, presence, and money schema

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 9: The guarded transition function and TS/SQL parity

**Files:**
- Create: `supabase/migrations/0006_transition_fn.sql`
- Create: `packages/core/scripts/dump-transitions.ts`
- Test: `supabase/tests/003_transitions.test.sql`
- Test: `packages/core/test/trip/parity.test.ts`

**Interfaces:**
- Consumes: `TRANSITIONS` from Task 3; `trips`/`trip_events` from Task 8
- Produces:
  - SQL `public.is_legal_transition(p_from trip_state, p_to trip_state, p_actor trip_actor) returns boolean`
  - SQL `public.trip_transition(p_trip_id uuid, p_to trip_state, p_idempotency_key text, p_meta jsonb) returns public.trips`
  - `packages/core/scripts/dump-transitions.ts` emitting the TS table as CSV for the parity test

**Why parity matters:** the legality rules exist twice — in TypeScript for instant client feedback, in SQL for enforcement. Duplication is the right call here (the client must not need a round-trip to grey out a button), but it is only safe if drift is impossible. The parity test makes drift a failing build.

- [ ] **Step 1: Write the transition function migration**

Create `supabase/migrations/0006_transition_fn.sql`:

```sql
-- Mirror of TRANSITIONS in packages/core/src/trip/transitions.ts.
-- Kept honest by packages/core/test/trip/parity.test.ts.
create table public.trip_transition_rules (
  from_state trip_state not null,
  to_state   trip_state not null,
  actor      trip_actor not null,
  primary key (from_state, to_state, actor)
);

insert into public.trip_transition_rules (from_state, to_state, actor) values
  ('requested',   'offered',            'system'),
  ('requested',   'no_drivers',         'system'),
  ('requested',   'cancelled_by_rider', 'rider'),
  ('offered',     'offered',            'system'),
  ('offered',     'accepted',           'driver'),
  ('offered',     'expired',            'system'),
  ('offered',     'no_drivers',         'system'),
  ('offered',     'cancelled_by_rider', 'rider'),
  ('accepted',    'arrived',            'driver'),
  ('accepted',    'cancelled_by_rider', 'rider'),
  ('accepted',    'cancelled_by_driver','driver'),
  ('accepted',    'offered',            'system'),
  ('arrived',     'in_progress',        'driver'),
  ('arrived',     'cancelled_by_rider', 'rider'),
  ('arrived',     'cancelled_by_driver','driver'),
  ('in_progress', 'completed',          'driver');

create or replace function public.is_terminal(p_state trip_state)
returns boolean
language sql
immutable
as $$
  select p_state in (
    'completed', 'cancelled_by_rider', 'cancelled_by_driver', 'expired', 'no_drivers'
  );
$$;

create or replace function public.is_legal_transition(
  p_from  trip_state,
  p_to    trip_state,
  p_actor trip_actor
) returns boolean
language sql
stable
as $$
  select not public.is_terminal(p_from)
     and exists (
       select 1 from public.trip_transition_rules r
        where r.from_state = p_from
          and r.to_state   = p_to
          and r.actor      = p_actor
     );
$$;

-- The only sanctioned way to change a trip's state.
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
  -- Idempotent replay: a key already recorded for this trip is a no-op.
  if exists (
    select 1 from public.trip_events
     where trip_id = p_trip_id and idempotency_key = p_idempotency_key
  ) then
    select * into v_trip from public.trips where id = p_trip_id;
    return v_trip;
  end if;

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

  if not public.is_legal_transition(v_trip.state, p_to, v_actor) then
    raise exception 'illegal_transition: % -> % by %', v_trip.state, p_to, v_actor
      using errcode = '23514';
  end if;

  insert into public.trip_events
    (trip_id, from_state, to_state, actor, actor_id, idempotency_key, meta)
  values
    (p_trip_id, v_trip.state, p_to, v_actor, auth.uid(), p_idempotency_key, p_meta);

  update public.trips
     set state = p_to, updated_at = now()
   where id = p_trip_id
  returning * into v_trip;

  return v_trip;
end;
$$;

revoke all on function public.trip_transition(uuid, trip_state, text, jsonb) from public;
grant execute on function public.trip_transition(uuid, trip_state, text, jsonb) to authenticated;
```

- [ ] **Step 2: Apply and verify**

Run: `pnpm dlx supabase db reset`
Expected: applies cleanly.

- [ ] **Step 3: Write the SQL behaviour test**

Create `supabase/tests/003_transitions.test.sql`:

```sql
begin;
select plan(5);

select ok(
  public.is_legal_transition('offered', 'accepted', 'driver'),
  'a driver may accept an offered trip'
);

select ok(
  not public.is_legal_transition('accepted', 'completed', 'driver'),
  'a driver may not complete a trip that never started'
);

select ok(
  not public.is_legal_transition('arrived', 'in_progress', 'rider'),
  'a rider may not start the trip'
);

select ok(
  not public.is_legal_transition('completed', 'in_progress', 'driver'),
  'nothing escapes a terminal state'
);

select is(
  (select count(*)::int from public.trip_transition_rules),
  16,
  'the SQL rule table has sixteen rows'
);

select * from finish();
rollback;
```

- [ ] **Step 4: Run it**

Run: `pnpm dlx supabase test db`
Expected: PASS.

- [ ] **Step 5: Write the parity dump script**

Create `packages/core/scripts/dump-transitions.ts`:

```ts
import { TRANSITIONS } from "../src/trip/transitions";

for (const rule of TRANSITIONS) {
  for (const actor of rule.actors) {
    console.log(`${rule.from},${rule.to},${actor}`);
  }
}
```

- [ ] **Step 6: Write the failing parity test**

Create `packages/core/test/trip/parity.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { TRANSITIONS } from "../../src/trip/transitions";

/**
 * The legality rules exist in TypeScript (for instant client feedback) and in
 * SQL (for enforcement). This test makes drift between them a build failure.
 */
describe("TS/SQL transition parity", () => {
  it("matches the rows seeded in 0006_transition_fn.sql", () => {
    const sql = readFileSync(
      new URL("../../../../supabase/migrations/0006_transition_fn.sql", import.meta.url),
      "utf8",
    );

    const insertBlock = sql
      .split("insert into public.trip_transition_rules (from_state, to_state, actor) values")[1]
      ?.split(";")[0];

    expect(insertBlock, "seed block not found in migration").toBeDefined();

    const sqlRules = [...insertBlock!.matchAll(/\(\s*'(\w+)'\s*,\s*'(\w+)'\s*,\s*'(\w+)'\s*\)/g)]
      .map((m) => `${m[1]}>${m[2]}>${m[3]}`)
      .sort();

    const tsRules = TRANSITIONS.flatMap((r) =>
      r.actors.map((a) => `${r.from}>${r.to}>${a}`),
    ).sort();

    expect(sqlRules).toEqual(tsRules);
  });
});
```

- [ ] **Step 7: Run the parity test**

Run: `pnpm --filter @gera/core test`
Expected: PASS. If it fails, one of the two tables was edited without the other — fix the mismatch, never the test.

- [ ] **Step 8: Commit**

```bash
git add supabase packages/core
git commit -m "feat(db): guarded idempotent trip_transition with TS/SQL parity test

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 10: Row-level security and its adversarial test suite

**Files:**
- Create: `supabase/migrations/0007_rls.sql`
- Test: `supabase/tests/004_rls.test.sql`

**Interfaces:**
- Consumes: every table from Tasks 7 and 8
- Produces: deny-by-default RLS across the schema, plus `public.shares_active_trip(p_other uuid) returns boolean` used by the contact-disclosure policy

**The rule being enforced (spec 3.6):** a driver sees no rider contact detail before accepting, both parties see a masked number during the trip, and access is revoked at completion. RLS failures are silent — they leak rather than throw — so every policy below gets a test that proves the *denial*, not just the permission.

- [ ] **Step 1: Write the RLS migration**

Create `supabase/migrations/0007_rls.sql`:

```sql
alter table public.profiles          enable row level security;
alter table public.drivers           enable row level security;
alter table public.vehicles          enable row level security;
alter table public.trips             enable row level security;
alter table public.trip_events       enable row level security;
alter table public.trip_offers       enable row level security;
alter table public.driver_presence   enable row level security;
alter table public.trip_track_points enable row level security;
alter table public.fare_policies     enable row level security;
alter table public.fare_quotes       enable row level security;
alter table public.ledger_entries    enable row level security;
alter table public.saved_places      enable row level security;
alter table public.landmarks         enable row level security;

-- True while the two users are counterparties on a trip that is live.
create or replace function public.shares_active_trip(p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.trips t
     where t.state in ('accepted', 'arrived', 'in_progress')
       and (
            (t.rider_id = auth.uid()  and t.driver_id = p_other)
         or (t.driver_id = auth.uid() and t.rider_id  = p_other)
       )
  );
$$;

-- profiles: your own row always; a counterparty's row only during a live trip.
create policy profiles_select_self on public.profiles
  for select using (id = auth.uid());

create policy profiles_select_trip_partner on public.profiles
  for select using (public.shares_active_trip(id));

create policy profiles_update_self on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

create policy profiles_insert_self on public.profiles
  for insert with check (id = auth.uid());

-- drivers / vehicles: owned by the driver. Verification is ops-only, so no
-- update policy is granted to the driver on `verification`.
create policy drivers_select_self on public.drivers
  for select using (id = auth.uid());

-- The verification value is constrained here: ownership alone would let a
-- driver insert themselves as already 'verified'. Only ops may set that, and
-- ops acts through the service role, which bypasses RLS.
create policy drivers_insert_self on public.drivers
  for insert with check (
    id = auth.uid() and verification in ('pending', 'submitted')
  );

create policy vehicles_owner_all on public.vehicles
  for all using (driver_id = auth.uid()) with check (driver_id = auth.uid());

-- trips: the rider who booked it, or the driver assigned to it.
create policy trips_select_participant on public.trips
  for select using (rider_id = auth.uid() or driver_id = auth.uid());

-- A trip may only be born in 'requested', and never with a driver already
-- attached. Otherwise a rider could insert a trip straight into 'completed',
-- or assign themselves a driver without going through dispatch.
create policy trips_insert_rider on public.trips
  for insert with check (
    rider_id = auth.uid() and state = 'requested' and driver_id is null
  );

-- NOTE: no UPDATE policy on trips. State changes go through trip_transition()
-- only, which is security definer. Direct writes are impossible by design.

create policy trip_events_select_participant on public.trip_events
  for select using (
    exists (
      select 1 from public.trips t
       where t.id = trip_events.trip_id
         and (t.rider_id = auth.uid() or t.driver_id = auth.uid())
    )
  );

create policy trip_offers_select_own on public.trip_offers
  for select using (driver_id = auth.uid());

-- Presence: a driver writes only their own row.
create policy presence_owner_all on public.driver_presence
  for all using (driver_id = auth.uid()) with check (driver_id = auth.uid());

create policy track_points_select_participant on public.trip_track_points
  for select using (
    exists (
      select 1 from public.trips t
       where t.id = trip_track_points.trip_id
         and (t.rider_id = auth.uid() or t.driver_id = auth.uid())
    )
  );

create policy track_points_insert_driver on public.trip_track_points
  for insert with check (
    exists (
      select 1 from public.trips t
       where t.id = trip_track_points.trip_id
         and t.driver_id = auth.uid()
         and t.state = 'in_progress'
    )
  );

-- Pricing is public knowledge; landmarks are a shared gazetteer.
create policy fare_policies_read_all on public.fare_policies
  for select using (true);

create policy landmarks_read_all on public.landmarks
  for select using (true);

create policy fare_quotes_select_own on public.fare_quotes
  for select using (rider_id = auth.uid());

-- Ledger: readable by its driver, writable by nobody through the API.
create policy ledger_select_own on public.ledger_entries
  for select using (driver_id = auth.uid());

create policy saved_places_owner_all on public.saved_places
  for all using (rider_id = auth.uid()) with check (rider_id = auth.uid());
```

- [ ] **Step 2: Apply the migration**

Run: `pnpm dlx supabase db reset`
Expected: applies cleanly.

- [ ] **Step 3: Write the adversarial RLS test**

Create `supabase/tests/004_rls.test.sql`:

```sql
begin;
select plan(11);

-- Two riders and one driver, created directly so we control the ids.
-- instance_id/aud/role are supplied explicitly: auth.users has no defaults for
-- them, and omitting them fails with a confusing not-null error.
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000',
   '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'rider.a@test.local'),
  ('00000000-0000-0000-0000-000000000000',
   '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'rider.b@test.local'),
  ('00000000-0000-0000-0000-000000000000',
   '33333333-3333-3333-3333-333333333333',
   'authenticated', 'authenticated', 'driver.c@test.local');

insert into public.profiles (id, role, first_name, phone) values
  ('11111111-1111-1111-1111-111111111111', 'rider',  'Aline', '+250700000001'),
  ('22222222-2222-2222-2222-222222222222', 'rider',  'Bosco', '+250700000002'),
  ('33333333-3333-3333-3333-333333333333', 'driver', 'Eric',  '+250700000003');

insert into public.drivers (id, verification) values
  ('33333333-3333-3333-3333-333333333333', 'verified');

insert into public.trips
  (id, rider_id, vehicle_class, state, pickup, pickup_label, dropoff, dropoff_label)
values (
  'aaaaaaaa-0000-0000-0000-000000000001',
  '11111111-1111-1111-1111-111111111111',
  'moto',
  'requested',
  st_point(30.0619, -1.9441)::geography, 'Kimironko Market',
  st_point(30.0588, -1.9536)::geography, 'Kigali Heights'
);

insert into public.ledger_entries (driver_id, kind, amount_rwf)
values ('33333333-3333-3333-3333-333333333333', 'topup_credit', 5000);

-- Act as rider A.
set local role authenticated;
set local request.jwt.claims to
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is(
  (select count(*)::int from public.trips),
  1,
  'rider A sees their own trip'
);

select is(
  (select count(*)::int from public.profiles
    where id = '22222222-2222-2222-2222-222222222222'),
  0,
  'rider A cannot read rider B profile'
);

select is(
  (select count(*)::int from public.profiles
    where id = '33333333-3333-3333-3333-333333333333'),
  0,
  'rider A cannot read the driver profile before a trip is accepted'
);

-- RLS denies an UPDATE by making the row invisible, not by raising. So the
-- statement succeeds, touches nothing, and the assertion that matters is that
-- the state did not move.
select lives_ok(
  $$ update public.trips set state = 'completed'
      where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  'a direct state update raises no error'
);

select is(
  (select state::text from public.trips
    where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'requested',
  'but trips.state is unchanged - only trip_transition() can move it'
);

select throws_ok(
  $$ insert into public.ledger_entries (driver_id, kind, amount_rwf)
     values ('33333333-3333-3333-3333-333333333333', 'topup_credit', 999999) $$,
  '42501',
  null,
  'no client can mint ledger entries'
);

-- Act as rider B.
set local request.jwt.claims to
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select is(
  (select count(*)::int from public.trips),
  0,
  'rider B cannot see rider A trips'
);

-- Privilege escalation: ownership alone is not enough on the drivers table.
select throws_ok(
  $$ insert into public.drivers (id, verification)
     values ('22222222-2222-2222-2222-222222222222', 'verified') $$,
  '42501',
  null,
  'a user cannot register themselves as an already-verified driver'
);

-- Act as the driver, who has not been offered this trip.
set local request.jwt.claims to
  '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

select is(
  (select count(*)::int from public.trips),
  0,
  'a driver cannot see a trip they were never offered'
);

select is(
  (select count(*)::int from public.ledger_entries),
  1,
  'a driver reads their own ledger'
);

select is(
  (select count(*)::int from public.profiles
    where id = '11111111-1111-1111-1111-111111111111'),
  0,
  'a driver cannot read rider contact details before accepting'
);

select * from finish();
rollback;
```

- [ ] **Step 4: Run the suite**

Run: `pnpm dlx supabase test db`
Expected: PASS, all 9 RLS assertions plus the earlier suites.

- [ ] **Step 5: Commit**

```bash
git add supabase
git commit -m "feat(db): deny-by-default RLS with adversarial pgTAP suite

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 11: Design tokens

**Files:**
- Create: `packages/ui/package.json`, `packages/ui/tsconfig.json`, `packages/ui/vitest.config.ts`
- Create: `packages/ui/src/tokens.ts`, `packages/ui/src/theme.ts`, `packages/ui/src/index.ts`
- Test: `packages/ui/test/contrast.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `tokens`, `lightTheme`, `darkTheme`, `contrastRatio(a: string, b: string): number`

**Why a contrast test:** the spec calls for legibility in direct equatorial sunlight. That requirement is meaningless unless something enforces it, so the palette ships with a test asserting real WCAG ratios on the pairs that carry fares and ETAs.

- [ ] **Step 1: Create the package**

Create `packages/ui/package.json`:

```json
{
  "name": "@gera/ui",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

Create `packages/ui/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

Create `packages/ui/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["test/**/*.test.ts"] },
});
```

- [ ] **Step 2: Write the failing contrast test**

Create `packages/ui/test/contrast.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { contrastRatio } from "../src/tokens";
import { lightTheme, darkTheme } from "../src/theme";

describe("sunlight legibility", () => {
  it("body text on surface clears WCAG AA in light theme", () => {
    expect(contrastRatio(lightTheme.text, lightTheme.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it("body text on surface clears WCAG AA in dark theme", () => {
    expect(contrastRatio(darkTheme.text, darkTheme.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it("fare numerals clear AAA in light theme", () => {
    expect(contrastRatio(lightTheme.textStrong, lightTheme.surface)).toBeGreaterThanOrEqual(7);
  });

  it("text on the amber accent is readable", () => {
    expect(contrastRatio(lightTheme.onAccent, lightTheme.accent)).toBeGreaterThanOrEqual(4.5);
  });

  it("muted text is still legible, never decorative grey", () => {
    expect(contrastRatio(lightTheme.textMuted, lightTheme.surface)).toBeGreaterThanOrEqual(4.5);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @gera/ui test`
Expected: FAIL — cannot resolve `../src/tokens`.

- [ ] **Step 4: Implement the tokens**

Create `packages/ui/src/tokens.ts`:

```ts
export const palette = {
  // Indigo night — the brand ground.
  indigo900: "#0B1022",
  indigo800: "#141B34",
  indigo700: "#1E2745",
  indigo500: "#3A4770",
  indigo300: "#8A94B8",

  // Amber — moto vest, high-visibility, the single accent.
  amber600: "#B26A00",
  amber500: "#F5A524",
  amber300: "#FFC96B",

  white: "#FFFFFF",
  paper: "#F7F8FB",
  slate600: "#4A5268",
  slate900: "#111523",

  success: "#0E7C4A",
  danger: "#C0342B",
} as const;

export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 } as const;

export const radius = { sm: 8, md: 14, lg: 22, pill: 999 } as const;

/** Fares and ETAs are the most-read text in the product; they get display sizes. */
export const type = {
  display: { size: 44, weight: "700", leading: 48 },
  title: { size: 24, weight: "700", leading: 30 },
  body: { size: 16, weight: "400", leading: 24 },
  label: { size: 13, weight: "600", leading: 18 },
} as const;

/** Minimum one-thumb touch target, in points. */
export const MIN_TOUCH_TARGET = 48;

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export const tokens = { palette, space, radius, type, MIN_TOUCH_TARGET } as const;
```

- [ ] **Step 5: Implement the semantic themes**

Create `packages/ui/src/theme.ts`:

```ts
import { palette } from "./tokens";

export interface Theme {
  readonly surface: string;
  readonly surfaceRaised: string;
  readonly text: string;
  readonly textStrong: string;
  readonly textMuted: string;
  readonly accent: string;
  readonly onAccent: string;
  readonly success: string;
  readonly danger: string;
}

export const lightTheme: Theme = {
  surface: palette.paper,
  surfaceRaised: palette.white,
  text: palette.slate600,
  textStrong: palette.indigo900,
  textMuted: palette.slate600,
  accent: palette.amber500,
  onAccent: palette.indigo900,
  success: palette.success,
  danger: palette.danger,
};

export const darkTheme: Theme = {
  surface: palette.indigo900,
  surfaceRaised: palette.indigo800,
  text: palette.indigo300,
  textStrong: palette.white,
  textMuted: palette.indigo300,
  accent: palette.amber500,
  onAccent: palette.indigo900,
  success: palette.success,
  danger: palette.danger,
};
```

Create `packages/ui/src/index.ts`:

```ts
export * from "./tokens";
export * from "./theme";
```

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm --filter @gera/ui test`
Expected: PASS, 5 assertions. If a pair fails, adjust the palette value — never lower the threshold.

- [ ] **Step 7: Commit**

```bash
git add packages/ui
git commit -m "feat(ui): design tokens with enforced sunlight contrast

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 12: Typed data client and phone-OTP auth

**Files:**
- Create: `packages/data/package.json`, `packages/data/tsconfig.json`, `packages/data/vitest.config.ts`
- Create: `packages/data/src/client.ts`, `packages/data/src/phone.ts`, `packages/data/src/auth.ts`, `packages/data/src/index.ts`
- Test: `packages/data/test/phone.test.ts`

**Interfaces:**
- Consumes: the Supabase project from Task 7
- Produces:
  - `createGeraClient(url: string, anonKey: string): SupabaseClient<Database>`
  - `normaliseRwandanPhone(input: string): string` — throws on invalid input
  - `requestOtp(client, phone): Promise<void>`, `verifyOtp(client, phone, token): Promise<Session>`

**Why phone normalisation is its own tested unit:** Rwandan numbers are written `0788123456`, `788123456`, `+250788123456`, and `250788123456` interchangeably. Auth silently fails on format mismatch, and a silent auth failure at the front door is the worst possible first impression.

- [ ] **Step 1: Create the package**

Create `packages/data/package.json`:

```json
{
  "name": "@gera/data",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.45.0"
  }
}
```

Create `packages/data/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

Create `packages/data/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["test/**/*.test.ts"] },
});
```

Run: `pnpm install`

- [ ] **Step 2: Write the failing phone tests**

Create `packages/data/test/phone.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normaliseRwandanPhone } from "../src/phone";

describe("normaliseRwandanPhone", () => {
  it("accepts the local leading-zero format", () => {
    expect(normaliseRwandanPhone("0788123456")).toBe("+250788123456");
  });

  it("accepts the bare nine-digit format", () => {
    expect(normaliseRwandanPhone("788123456")).toBe("+250788123456");
  });

  it("accepts the country code without a plus", () => {
    expect(normaliseRwandanPhone("250788123456")).toBe("+250788123456");
  });

  it("passes through a correct E.164 number", () => {
    expect(normaliseRwandanPhone("+250788123456")).toBe("+250788123456");
  });

  it("ignores spaces and dashes", () => {
    expect(normaliseRwandanPhone("078 812-3456")).toBe("+250788123456");
  });

  it("accepts every Rwandan mobile prefix", () => {
    for (const prefix of ["72", "73", "78", "79"]) {
      expect(normaliseRwandanPhone(`0${prefix}8123456`)).toBe(`+250${prefix}8123456`);
    }
  });

  it("rejects a landline prefix", () => {
    expect(() => normaliseRwandanPhone("0252123456")).toThrow("invalid Rwandan mobile number");
  });

  it("rejects a number that is too short", () => {
    expect(() => normaliseRwandanPhone("078812345")).toThrow("invalid Rwandan mobile number");
  });

  it("rejects a foreign number", () => {
    expect(() => normaliseRwandanPhone("+447700900123")).toThrow(
      "invalid Rwandan mobile number",
    );
  });

  it("rejects empty input", () => {
    expect(() => normaliseRwandanPhone("")).toThrow("invalid Rwandan mobile number");
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @gera/data test`
Expected: FAIL — cannot resolve `../src/phone`.

- [ ] **Step 4: Implement phone normalisation**

Create `packages/data/src/phone.ts`:

```ts
/** MTN Rwanda uses 78/79; Airtel Rwanda uses 72/73. */
const MOBILE_PREFIXES = ["72", "73", "78", "79"] as const;

/**
 * Accepts 0788123456, 788123456, 250788123456, +250788123456 (with any
 * spacing or dashes) and returns strict E.164. Throws on anything else.
 */
export function normaliseRwandanPhone(input: string): string {
  const digits = input.replace(/[^\d]/g, "");

  let national: string;
  if (digits.length === 9) {
    national = digits;
  } else if (digits.length === 10 && digits.startsWith("0")) {
    national = digits.slice(1);
  } else if (digits.length === 12 && digits.startsWith("250")) {
    national = digits.slice(3);
  } else {
    throw new Error("invalid Rwandan mobile number");
  }

  const prefix = national.slice(0, 2);
  if (!(MOBILE_PREFIXES as readonly string[]).includes(prefix)) {
    throw new Error("invalid Rwandan mobile number");
  }

  return `+250${national}`;
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @gera/data test`
Expected: PASS, 10 assertions.

- [ ] **Step 6: Implement the client and auth wrappers**

Create `packages/data/src/client.ts`:

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type GeraClient = SupabaseClient;

export function createGeraClient(url: string, anonKey: string): GeraClient {
  if (!url) throw new Error("SUPABASE_URL is required");
  if (!anonKey) throw new Error("SUPABASE_ANON_KEY is required");

  return createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
}
```

Create `packages/data/src/auth.ts`:

```ts
import type { Session } from "@supabase/supabase-js";
import type { GeraClient } from "./client";
import { normaliseRwandanPhone } from "./phone";

export async function requestOtp(client: GeraClient, phone: string): Promise<void> {
  const e164 = normaliseRwandanPhone(phone);
  const { error } = await client.auth.signInWithOtp({ phone: e164 });
  if (error) throw error;
}

export async function verifyOtp(
  client: GeraClient,
  phone: string,
  token: string,
): Promise<Session> {
  const e164 = normaliseRwandanPhone(phone);
  const { data, error } = await client.auth.verifyOtp({
    phone: e164,
    token,
    type: "sms",
  });
  if (error) throw error;
  if (!data.session) throw new Error("otp verification returned no session");
  return data.session;
}
```

Create `packages/data/src/index.ts`:

```ts
export * from "./client";
export * from "./phone";
export * from "./auth";
```

- [ ] **Step 7: Typecheck and commit**

Run: `pnpm --filter @gera/data typecheck && pnpm --filter @gera/data test`
Expected: both PASS.

```bash
git add packages/data
git commit -m "feat(data): typed client and Rwandan phone OTP auth

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 13: Rider app scaffold and the three-tap onboarding

**Files:**
- Create: `apps/rider/` via Expo, then `apps/rider/app/_layout.tsx`, `apps/rider/app/index.tsx`, `apps/rider/app/onboarding/phone.tsx`, `apps/rider/app/onboarding/verify.tsx`, `apps/rider/app/onboarding/name.tsx`
- Create: `apps/rider/src/lib/supabase.ts`
- Create: `apps/rider/.env.example`

**Interfaces:**
- Consumes: `createGeraClient`, `requestOtp`, `verifyOtp`, `normaliseRwandanPhone` from Task 12; `lightTheme`, `tokens` from Task 11
- Produces: a running Expo app whose onboarding is exactly three screens — phone, OTP, first name

**Spec requirement (5.2):** phone → OTP → first name. No email, no password, no account-creation step. Any extra field here is attrition.

- [ ] **Step 1: Scaffold the Expo app**

Run: `pnpm create expo-app apps/rider --template blank-typescript`
Then: `cd apps/rider && pnpm expo install expo-router react-native-safe-area-context react-native-screens expo-linking expo-constants`

- [ ] **Step 2: Wire workspace dependencies**

Modify `apps/rider/package.json` to add:

```json
{
  "dependencies": {
    "@gera/core": "workspace:*",
    "@gera/data": "workspace:*",
    "@gera/ui": "workspace:*"
  }
}
```

Run: `pnpm install`

- [ ] **Step 3: Create the client singleton and env template**

Create `apps/rider/.env.example`:

```
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
EXPO_PUBLIC_SUPABASE_ANON_KEY=replace-me
```

Create `apps/rider/src/lib/supabase.ts`:

```ts
import { createGeraClient } from "@gera/data";

export const supabase = createGeraClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? "",
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "",
);
```

- [ ] **Step 4: Build the phone screen**

Create `apps/rider/app/onboarding/phone.tsx`:

```tsx
import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { lightTheme, tokens } from "@gera/ui";
import { requestOtp } from "@gera/data";
import { supabase } from "../../src/lib/supabase";

export default function PhoneScreen() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await requestOtp(supabase, phone);
      router.push({ pathname: "/onboarding/verify", params: { phone } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.root}>
      <Text style={styles.title}>What's your number?</Text>
      <Text style={styles.sub}>We'll text you a code to sign in.</Text>

      <TextInput
        style={styles.input}
        value={phone}
        onChangeText={setPhone}
        placeholder="078 812 3456"
        placeholderTextColor={lightTheme.textMuted}
        keyboardType="phone-pad"
        autoFocus
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        style={[styles.cta, busy && styles.ctaBusy]}
        onPress={submit}
        disabled={busy}
      >
        <Text style={styles.ctaText}>{busy ? "Sending…" : "Continue"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: lightTheme.surface, padding: tokens.space.lg },
  title: {
    fontSize: tokens.type.title.size,
    fontWeight: "700",
    color: lightTheme.textStrong,
    marginTop: tokens.space.xxl,
  },
  sub: {
    fontSize: tokens.type.body.size,
    color: lightTheme.textMuted,
    marginTop: tokens.space.sm,
  },
  input: {
    marginTop: tokens.space.xl,
    fontSize: tokens.type.title.size,
    color: lightTheme.textStrong,
    borderBottomWidth: 2,
    borderBottomColor: lightTheme.accent,
    paddingVertical: tokens.space.sm,
  },
  error: { color: lightTheme.danger, marginTop: tokens.space.md },
  // The primary action lives in the bottom third, within one-thumb reach.
  cta: {
    marginTop: "auto",
    marginBottom: tokens.space.xl,
    minHeight: tokens.MIN_TOUCH_TARGET,
    backgroundColor: lightTheme.accent,
    borderRadius: tokens.radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaBusy: { opacity: 0.6 },
  ctaText: { fontSize: tokens.type.body.size, fontWeight: "700", color: lightTheme.onAccent },
});
```

- [ ] **Step 5: Build the verify screen**

Create `apps/rider/app/onboarding/verify.tsx`:

```tsx
import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { lightTheme, tokens } from "@gera/ui";
import { verifyOtp } from "@gera/data";
import { supabase } from "../../src/lib/supabase";

export default function VerifyScreen() {
  const router = useRouter();
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    try {
      await verifyOtp(supabase, phone, code);
      router.replace("/onboarding/name");
    } catch {
      setError("That code didn't work. Try again.");
    }
  }

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Enter the code</Text>
      <Text style={styles.sub}>Sent to {phone}</Text>

      <TextInput
        style={styles.input}
        value={code}
        onChangeText={setCode}
        keyboardType="number-pad"
        maxLength={6}
        autoFocus
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable style={styles.cta} onPress={submit}>
        <Text style={styles.ctaText}>Verify</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: lightTheme.surface, padding: tokens.space.lg },
  title: {
    fontSize: tokens.type.title.size,
    fontWeight: "700",
    color: lightTheme.textStrong,
    marginTop: tokens.space.xxl,
  },
  sub: { fontSize: tokens.type.body.size, color: lightTheme.textMuted, marginTop: tokens.space.sm },
  input: {
    marginTop: tokens.space.xl,
    fontSize: tokens.type.display.size,
    letterSpacing: 8,
    color: lightTheme.textStrong,
    borderBottomWidth: 2,
    borderBottomColor: lightTheme.accent,
    paddingVertical: tokens.space.sm,
  },
  error: { color: lightTheme.danger, marginTop: tokens.space.md },
  cta: {
    marginTop: "auto",
    marginBottom: tokens.space.xl,
    minHeight: tokens.MIN_TOUCH_TARGET,
    backgroundColor: lightTheme.accent,
    borderRadius: tokens.radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: { fontSize: tokens.type.body.size, fontWeight: "700", color: lightTheme.onAccent },
});
```

- [ ] **Step 6: Build the name screen, which writes the profile**

Create `apps/rider/app/onboarding/name.tsx`:

```tsx
import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { lightTheme, tokens } from "@gera/ui";
import { supabase } from "../../src/lib/supabase";

export default function NameScreen() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      setError("Session expired. Start again.");
      return;
    }

    const { error: writeError } = await supabase.from("profiles").insert({
      id: auth.user.id,
      role: "rider",
      first_name: name.trim(),
      phone: auth.user.phone ?? "",
    });

    if (writeError) {
      setError(writeError.message);
      return;
    }
    router.replace("/");
  }

  return (
    <View style={styles.root}>
      <Text style={styles.title}>What should we call you?</Text>

      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="Aline"
        placeholderTextColor={lightTheme.textMuted}
        autoFocus
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        style={[styles.cta, !name.trim() && styles.ctaBusy]}
        onPress={submit}
        disabled={!name.trim()}
      >
        <Text style={styles.ctaText}>Start riding</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: lightTheme.surface, padding: tokens.space.lg },
  title: {
    fontSize: tokens.type.title.size,
    fontWeight: "700",
    color: lightTheme.textStrong,
    marginTop: tokens.space.xxl,
  },
  input: {
    marginTop: tokens.space.xl,
    fontSize: tokens.type.title.size,
    color: lightTheme.textStrong,
    borderBottomWidth: 2,
    borderBottomColor: lightTheme.accent,
    paddingVertical: tokens.space.sm,
  },
  error: { color: lightTheme.danger, marginTop: tokens.space.md },
  cta: {
    marginTop: "auto",
    marginBottom: tokens.space.xl,
    minHeight: tokens.MIN_TOUCH_TARGET,
    backgroundColor: lightTheme.accent,
    borderRadius: tokens.radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaBusy: { opacity: 0.5 },
  ctaText: { fontSize: tokens.type.body.size, fontWeight: "700", color: lightTheme.onAccent },
});
```

- [ ] **Step 7: Add the router layout and a placeholder home**

Create `apps/rider/app/_layout.tsx`:

```tsx
import { Stack } from "expo-router";
import { lightTheme } from "@gera/ui";

export default function RootLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: lightTheme.surface },
      }}
    />
  );
}
```

Create `apps/rider/app/index.tsx`:

```tsx
import { View, Text, StyleSheet } from "react-native";
import { lightTheme, tokens } from "@gera/ui";

export default function Home() {
  return (
    <View style={styles.root}>
      <Text style={styles.title}>Gera</Text>
      <Text style={styles.sub}>Map and booking sheet arrive in Phase 2.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: lightTheme.surface,
    alignItems: "center",
    justifyContent: "center",
    padding: tokens.space.lg,
  },
  title: {
    fontSize: tokens.type.display.size,
    fontWeight: "700",
    color: lightTheme.textStrong,
  },
  sub: { fontSize: tokens.type.body.size, color: lightTheme.textMuted, marginTop: tokens.space.sm },
});
```

Set `"main": "expo-router/entry"` in `apps/rider/package.json`.

- [ ] **Step 8: Run the app and walk the flow**

Run: `cp apps/rider/.env.example apps/rider/.env` and fill in the anon key printed by `supabase start` in Task 7.
Run: `pnpm --filter rider exec expo start`

Expected: the app boots. Navigate to `/onboarding/phone`, enter `0788123456`, and confirm the OTP screen appears. With local Supabase, read the OTP from the Inbucket mail/SMS log at `http://127.0.0.1:54324`.

- [ ] **Step 9: Commit**

```bash
git add apps/rider
git commit -m "feat(rider): three-tap phone OTP onboarding

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 14: Driver app scaffold and verification submission

**Files:**
- Create: `apps/driver/` via Expo, mirroring Task 13's structure
- Create: `apps/driver/app/_layout.tsx`, `apps/driver/app/index.tsx`, `apps/driver/app/onboarding/phone.tsx`, `apps/driver/app/onboarding/verify.tsx`, `apps/driver/app/onboarding/details.tsx`, `apps/driver/app/onboarding/pending.tsx`
- Create: `apps/driver/src/lib/supabase.ts`, `apps/driver/.env.example`

**Interfaces:**
- Consumes: everything Task 13 consumes, plus the `drivers` and `vehicles` tables from Task 7
- Produces: a driver who can register, submit vehicle details, and land on a `pending` verification screen — the Phase 1 exit criterion

- [ ] **Step 1: Scaffold and wire the app**

Run: `pnpm create expo-app apps/driver --template blank-typescript`
Then: `cd apps/driver && pnpm expo install expo-router react-native-safe-area-context react-native-screens expo-linking expo-constants`

Add to `apps/driver/package.json`:

```json
{
  "main": "expo-router/entry",
  "dependencies": {
    "@gera/core": "workspace:*",
    "@gera/data": "workspace:*",
    "@gera/ui": "workspace:*"
  }
}
```

Run: `pnpm install`

- [ ] **Step 2: Copy the client singleton and env template**

Create `apps/driver/.env.example`:

```
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
EXPO_PUBLIC_SUPABASE_ANON_KEY=replace-me
```

Create `apps/driver/src/lib/supabase.ts`:

```ts
import { createGeraClient } from "@gera/data";

export const supabase = createGeraClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? "",
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "",
);
```

- [ ] **Step 3: Reuse the phone and verify screens**

Copy `apps/rider/app/onboarding/phone.tsx` to `apps/driver/app/onboarding/phone.tsx` unchanged.

Copy `apps/rider/app/onboarding/verify.tsx` to `apps/driver/app/onboarding/verify.tsx`, changing only the post-verify destination:

```tsx
      router.replace("/onboarding/details");
```

- [ ] **Step 4: Build the details screen**

Create `apps/driver/app/onboarding/details.tsx`:

```tsx
import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { lightTheme, tokens } from "@gera/ui";
import { VEHICLE_CLASSES, type VehicleClass } from "@gera/core";
import { supabase } from "../../src/lib/supabase";

export default function DetailsScreen() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [licence, setLicence] = useState("");
  const [plate, setPlate] = useState("");
  const [vest, setVest] = useState("");
  // moto is first and default: it is the dominant mode in Kigali.
  const [vehicleClass, setVehicleClass] = useState<VehicleClass>("moto");
  const [error, setError] = useState<string | null>(null);

  const ready = name.trim() && licence.trim() && plate.trim();

  async function submit() {
    setError(null);
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      setError("Session expired. Start again.");
      return;
    }

    const { error: profileError } = await supabase.from("profiles").insert({
      id: auth.user.id,
      role: "driver",
      first_name: name.trim(),
      phone: auth.user.phone ?? "",
    });
    if (profileError) return setError(profileError.message);

    const { error: driverError } = await supabase.from("drivers").insert({
      id: auth.user.id,
      licence_number: licence.trim(),
      verification: "submitted",
    });
    if (driverError) return setError(driverError.message);

    const { error: vehicleError } = await supabase.from("vehicles").insert({
      driver_id: auth.user.id,
      class: vehicleClass,
      plate: plate.trim().toUpperCase(),
      vest_number: vest.trim() || null,
      is_active: false,
    });
    if (vehicleError) return setError(vehicleError.message);

    router.replace("/onboarding/pending");
  }

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Your details</Text>

      <TextInput style={styles.input} value={name} onChangeText={setName}
        placeholder="First name" placeholderTextColor={lightTheme.textMuted} />
      <TextInput style={styles.input} value={licence} onChangeText={setLicence}
        placeholder="Licence number" placeholderTextColor={lightTheme.textMuted} />
      <TextInput style={styles.input} value={plate} onChangeText={setPlate}
        placeholder="Plate, e.g. RAD 123 B" placeholderTextColor={lightTheme.textMuted}
        autoCapitalize="characters" />
      <TextInput style={styles.input} value={vest} onChangeText={setVest}
        placeholder="Vest number (motos only)" placeholderTextColor={lightTheme.textMuted}
        keyboardType="number-pad" />

      <View style={styles.classRow}>
        {VEHICLE_CLASSES.map((c) => (
          <Pressable
            key={c}
            onPress={() => setVehicleClass(c)}
            style={[styles.chip, vehicleClass === c && styles.chipActive]}
          >
            <Text style={[styles.chipText, vehicleClass === c && styles.chipTextActive]}>
              {c === "cab_xl" ? "Cab XL" : c === "cab" ? "Cab" : "Moto"}
            </Text>
          </Pressable>
        ))}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable style={[styles.cta, !ready && styles.ctaDisabled]} onPress={submit} disabled={!ready}>
        <Text style={styles.ctaText}>Submit for verification</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: lightTheme.surface, padding: tokens.space.lg },
  title: {
    fontSize: tokens.type.title.size, fontWeight: "700",
    color: lightTheme.textStrong, marginTop: tokens.space.xl,
  },
  input: {
    marginTop: tokens.space.md, fontSize: tokens.type.body.size,
    color: lightTheme.textStrong, borderBottomWidth: 1,
    borderBottomColor: lightTheme.textMuted, paddingVertical: tokens.space.sm,
  },
  classRow: { flexDirection: "row", gap: tokens.space.sm, marginTop: tokens.space.lg },
  chip: {
    paddingHorizontal: tokens.space.md, minHeight: tokens.MIN_TOUCH_TARGET,
    justifyContent: "center", borderRadius: tokens.radius.pill,
    borderWidth: 1, borderColor: lightTheme.textMuted,
  },
  chipActive: { backgroundColor: lightTheme.accent, borderColor: lightTheme.accent },
  chipText: { color: lightTheme.text, fontWeight: "600" },
  chipTextActive: { color: lightTheme.onAccent },
  error: { color: lightTheme.danger, marginTop: tokens.space.md },
  cta: {
    marginTop: "auto", marginBottom: tokens.space.xl,
    minHeight: tokens.MIN_TOUCH_TARGET, backgroundColor: lightTheme.accent,
    borderRadius: tokens.radius.lg, alignItems: "center", justifyContent: "center",
  },
  ctaDisabled: { opacity: 0.5 },
  ctaText: { fontSize: tokens.type.body.size, fontWeight: "700", color: lightTheme.onAccent },
});
```

- [ ] **Step 5: Build the pending screen**

Create `apps/driver/app/onboarding/pending.tsx`:

```tsx
import { View, Text, StyleSheet } from "react-native";
import { lightTheme, tokens } from "@gera/ui";

export default function PendingScreen() {
  return (
    <View style={styles.root}>
      <Text style={styles.title}>We're checking your documents</Text>
      <Text style={styles.body}>
        This usually takes a few hours. We'll text you the moment you're approved,
        and you can start taking trips straight away.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1, backgroundColor: lightTheme.surface,
    alignItems: "center", justifyContent: "center", padding: tokens.space.lg,
  },
  title: {
    fontSize: tokens.type.title.size, fontWeight: "700",
    color: lightTheme.textStrong, textAlign: "center",
  },
  body: {
    fontSize: tokens.type.body.size, color: lightTheme.textMuted,
    textAlign: "center", marginTop: tokens.space.md, lineHeight: tokens.type.body.leading,
  },
});
```

- [ ] **Step 6: Add the layout and placeholder home**

Create `apps/driver/app/_layout.tsx` with the same content as `apps/rider/app/_layout.tsx`.

Create `apps/driver/app/index.tsx`:

```tsx
import { View, Text, StyleSheet } from "react-native";
import { lightTheme, tokens } from "@gera/ui";

export default function Home() {
  return (
    <View style={styles.root}>
      <Text style={styles.title}>Gera Driver</Text>
      <Text style={styles.sub}>Go-online toggle and offers arrive in Phase 2.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1, backgroundColor: lightTheme.surface,
    alignItems: "center", justifyContent: "center", padding: tokens.space.lg,
  },
  title: {
    fontSize: tokens.type.display.size, fontWeight: "700", color: lightTheme.textStrong,
  },
  sub: { fontSize: tokens.type.body.size, color: lightTheme.textMuted, marginTop: tokens.space.sm },
});
```

- [ ] **Step 7: Verify the Phase 1 exit criterion end to end**

Run: `cp apps/driver/.env.example apps/driver/.env` and fill in the anon key.
Run: `pnpm --filter driver exec expo start`

Walk the flow: phone → OTP (read from Inbucket at `http://127.0.0.1:54324`) → details → pending.

Then confirm the database agrees:

```bash
pnpm dlx supabase db query "select p.first_name, d.verification, v.class, v.plate
  from public.profiles p
  join public.drivers d on d.id = p.id
  join public.vehicles v on v.driver_id = d.id;"
```

Expected: one row, `verification = 'submitted'`.

Then flip it to verified as ops would:

```bash
pnpm dlx supabase db query "update public.drivers set verification = 'verified';"
```

Expected: the Phase 1 exit criterion — a driver can register and reach `verified`.

- [ ] **Step 8: Run the whole suite and commit**

Run: `pnpm test && pnpm dlx supabase test db`
Expected: every package suite and every pgTAP suite PASS.

```bash
git add apps/driver
git commit -m "feat(driver): onboarding through verification submission

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Definition of done

- [ ] `pnpm test` passes — core, ui, and data suites green.
- [ ] `pnpm dlx supabase test db` passes — schema, transition, and RLS suites green.
- [ ] The TS/SQL transition parity test passes, proving the two rule tables agree.
- [ ] A rider completes onboarding in three screens and a `profiles` row exists.
- [ ] A driver completes onboarding, reaches `pending`, and can be moved to `verified`.
- [ ] No client role can write `trips.state` or `ledger_entries` directly (proven by pgTAP, not by inspection).

## Deliberately not in this plan

These belong to Phase 2 and later, and are listed so their absence reads as a decision rather than an oversight:

- Fare quoting and dispatch Edge Functions
- The `offered` → `accepted` race and `pg_cron` offer sweeper
- Map rendering, the morphing bottom sheet, live tracking
- Background location, foreground service, battery-optimisation exemption
- The simulation harness
- Wallet top-up and the `PaymentProvider` interface
- Heatmap, earnings coaching, safety features
- Offline outbox and i18n
