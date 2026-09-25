# Gera — Phase 3a: The Rider Booking Experience

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A rider opens the app, sees a map, searches for a Kigali landmark, is shown a locked upfront fare, books, and watches the sheet morph as a driver is found, arrives, and completes the trip.

**Architecture:** One persistent map with a single bottom sheet that morphs through trip states — the sheet's shape is a pure function of `trips.state`, so the UI cannot disagree with the server. The map is Leaflet on OpenStreetMap inside a WebView, behind a narrow `<TripMap>` interface, because the spec's Google Maps needs an API key that does not exist yet and an unkeyed `react-native-maps` renders a blank grey rectangle.

**Tech Stack:** Expo / React Native, expo-router, react-native-webview, Leaflet 1.9 (CDN), TypeScript, Vitest, pgTAP.

**Spec:** `docs/superpowers/specs/2026-09-24-gera-core-trip-loop-design.md` (3.7 maps and the addressing problem, 5.1 the morphing sheet, 5.2 rider flow, 5.4 design rules)

**Builds on:** `feat/phase2b-dispatch` (22 commits, green: `pnpm verify` exit 0, pgTAP 17 files / 201 assertions, both e2e scripts passing, both apps bundling).

## Global Constraints

- **Money is integer RWF.** No circulating subunit. Fares render as whole francs with a thousands separator, never decimals.
- **Moto is listed first and is the default.** It is the dominant mode in Kigali; ordering it second imports a Western assumption.
- **Primary actions live in the bottom third**, within one-handed reach on a 6.7" phone.
- **Touch targets are at least `tokens.MIN_TOUCH_TARGET` (48pt).**
- **No thin grey-on-grey.** Use the contrast-tested semantic colours from `@gera/ui`; the palette clears WCAG AA in direct equatorial sunlight and a test enforces it.
- **Fares and ETAs get display-size numerals** — they are the most-read text in the product.
- **Destination search is landmark-first** (spec 3.7): recent → saved → curated Kigali gazetteer → pin-drop. Most Kigali locations have no usable street address; an address-bar-first UI copied from a Western ride app fails on day one.
- **Every screen has an honest offline state** — "Reconnecting, your trip is safe", never a dead spinner.
- TypeScript `strict: true`, **no `any`**. `packages/core` keeps zero runtime dependencies.
- **`pnpm bundle:core` must be re-run whenever `packages/core` changes**; `pnpm verify` fails on a stale bundle.
- **Grants must name `anon` explicitly.** `revoke ... from public` does not remove it under Supabase's defaults — a Critical finding four times in this project.
- The Supabase CLI prints JSON errors and still exits 0. Judge by output text.
- Commit messages use Conventional Commits and end with:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

---

## File Structure

| Path | Responsibility |
|---|---|
| `supabase/migrations/0022_landmarks_seed.sql` | ~40 real Kigali landmarks; `search_landmarks()` |
| `packages/data/src/places.ts` | Landmark search and saved-place bindings |
| `packages/data/src/trip-watch.ts` | Read one trip; poll it while it is live |
| `packages/ui/src/sheet.ts` | Sheet snap heights and the state→shape map |
| `apps/rider/src/components/TripMap.tsx` | Leaflet-in-WebView map, narrow props |
| `apps/rider/src/components/Sheet.tsx` | The bottom sheet shell |
| `apps/rider/app/index.tsx` | Map + "Where to?" — replaces the placeholder |
| `apps/rider/app/destination.tsx` | Landmark-first picker |
| `apps/rider/app/ride.tsx` | Vehicle choice, quote, confirm, and the live trip |

---

## Task 1: Seed the Kigali landmark gazetteer

The `landmarks` table has existed since Phase 1 with a GIN index and a read-all policy, and **zero rows**. Spec 3.7's landmark-first search has nothing to search.

**Files:**
- Create: `supabase/migrations/0022_landmarks_seed.sql`
- Create: `supabase/tests/018_landmarks.test.sql`

**Interfaces:**
- Consumes: `public.landmarks` from migration `0005`
- Produces: `public.search_landmarks(p_query text, p_limit integer) returns table (id uuid, name text, sector text, lng double precision, lat double precision)`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0022_landmarks_seed.sql`:

```sql
-- Spec 3.7: most Kigali locations have no usable street address. People
-- navigate by landmark - "near Simba Supermarket, Kimironko". This gazetteer is
-- what makes landmark-first search possible; without it the picker has nothing
-- to offer and falls back to exactly the address bar the spec rejects.
insert into public.landmarks (name, sector, position, aliases) values
  ('Kimironko Market',            'Kimironko',  st_point(30.1128, -1.9403)::geography, array['kimironko market','market']),
  ('Kigali Heights',              'Kacyiru',    st_point(30.0925, -1.9536)::geography, array['heights']),
  ('Kigali Convention Centre',    'Kimihurura', st_point(30.0919, -1.9540)::geography, array['kcc','convention centre','dome']),
  ('Kigali International Airport','Kanombe',    st_point(30.1395, -1.9686)::geography, array['airport','kanombe airport','kgl']),
  ('Nyabugogo Bus Park',          'Nyabugogo',  st_point(30.0447, -1.9394)::geography, array['nyabugogo','bus park','taxi park']),
  ('Kigali Genocide Memorial',    'Gisozi',     st_point(30.0596, -1.9303)::geography, array['memorial','gisozi memorial']),
  ('Amahoro Stadium',             'Remera',     st_point(30.1043, -1.9500)::geography, array['amahoro','stadium']),
  ('BK Arena',                    'Remera',     st_point(30.1057, -1.9525)::geography, array['bk arena','arena']),
  ('Kigali City Tower',           'Nyarugenge', st_point(30.0605, -1.9498)::geography, array['city tower','kct']),
  ('Union Trade Centre',          'Nyarugenge', st_point(30.0596, -1.9487)::geography, array['utc']),
  ('Simba Supermarket Kimironko', 'Kimironko',  st_point(30.1117, -1.9411)::geography, array['simba kimironko','simba']),
  ('Simba Supermarket Remera',    'Remera',     st_point(30.1061, -1.9576)::geography, array['simba remera']),
  ('Kigali Public Library',       'Kacyiru',    st_point(30.0876, -1.9445)::geography, array['library']),
  ('Kacyiru Police Station',      'Kacyiru',    st_point(30.0839, -1.9377)::geography, array['kacyiru police']),
  ('CHUK Hospital',               'Nyarugenge', st_point(30.0596, -1.9556)::geography, array['chuk','university hospital']),
  ('King Faisal Hospital',        'Kacyiru',    st_point(30.0912, -1.9502)::geography, array['king faisal','faisal']),
  ('Kigali Sports Stadium Nyamirambo','Nyamirambo', st_point(30.0403, -1.9829)::geography, array['nyamirambo stadium','regional stadium']),
  ('Nyamirambo Market',           'Nyamirambo', st_point(30.0435, -1.9808)::geography, array['nyamirambo market']),
  ('Remera Taxi Park',            'Remera',     st_point(30.1085, -1.9563)::geography, array['remera taxi park','remera park']),
  ('Kimironko Bus Station',       'Kimironko',  st_point(30.1140, -1.9391)::geography, array['kimironko bus']),
  ('Gishushu',                    'Gishushu',   st_point(30.0973, -1.9490)::geography, array['gishushu']),
  ('Kimihurura',                  'Kimihurura', st_point(30.0930, -1.9484)::geography, array['kimihurura']),
  ('Gacuriro',                    'Gacuriro',   st_point(30.0862, -1.9219)::geography, array['gacuriro']),
  ('Kabeza',                      'Kabeza',     st_point(30.1234, -1.9622)::geography, array['kabeza']),
  ('Gikondo',                     'Gikondo',    st_point(30.0724, -1.9820)::geography, array['gikondo']),
  ('Kicukiro Centre',             'Kicukiro',   st_point(30.1003, -1.9781)::geography, array['kicukiro','kicukiro centre']),
  ('Niboye',                      'Kicukiro',   st_point(30.0951, -1.9740)::geography, array['niboye']),
  ('Gatenga',                     'Kicukiro',   st_point(30.0803, -1.9869)::geography, array['gatenga']),
  ('Nyarutarama',                 'Nyarutarama',st_point(30.1055, -1.9366)::geography, array['nyarutarama']),
  ('Kigali Golf Club',            'Nyarutarama',st_point(30.1075, -1.9339)::geography, array['golf club','golf']),
  ('MTN Centre',                  'Nyarutarama',st_point(30.1029, -1.9391)::geography, array['mtn centre']),
  ('Zaria Court',                 'Remera',     st_point(30.1067, -1.9509)::geography, array['zaria court','zaria']),
  ('Kigali Arena Parking',        'Remera',     st_point(30.1049, -1.9531)::geography, array['arena parking']),
  ('University of Rwanda Gikondo','Gikondo',    st_point(30.0705, -1.9775)::geography, array['ur gikondo','university gikondo']),
  ('Rwanda Revenue Authority',    'Kimihurura', st_point(30.0946, -1.9459)::geography, array['rra']),
  ('Kigali Serena Hotel',         'Nyarugenge', st_point(30.0617, -1.9531)::geography, array['serena']),
  ('Radisson Blu Kigali',         'Kimihurura', st_point(30.0906, -1.9551)::geography, array['radisson','radisson blu']),
  ('Marriott Kigali',             'Nyarugenge', st_point(30.0614, -1.9494)::geography, array['marriott']),
  ('Camp Kigali Memorial',        'Nyarugenge', st_point(30.0577, -1.9509)::geography, array['camp kigali']),
  ('Nyabugogo Taxi Park',         'Nyabugogo',  st_point(30.0433, -1.9412)::geography, array['nyabugogo taxi']);

-- Name match OR alias match, prefix-friendly so typing "kim" finds Kimironko.
-- Ordered so an exact prefix on the name beats an alias hit.
create or replace function public.search_landmarks(p_query text, p_limit integer)
returns table (id uuid, name text, sector text, lng double precision, lat double precision)
language sql
stable
as $$
  select l.id, l.name, l.sector,
         st_x(l.position::geometry) as lng,
         st_y(l.position::geometry) as lat
    from public.landmarks l
   where p_query is not null
     and length(btrim(p_query)) > 0
     and (
       l.name ilike btrim(p_query) || '%'
       or l.name ilike '%' || btrim(p_query) || '%'
       or exists (
         select 1 from unnest(l.aliases) a
          where a ilike btrim(p_query) || '%'
       )
     )
   order by (l.name ilike btrim(p_query) || '%') desc, l.name
   limit greatest(p_limit, 1);
$$;

revoke all on function public.search_landmarks(text, integer) from public, anon;
grant execute on function public.search_landmarks(text, integer) to authenticated, service_role;
```

- [ ] **Step 2: Apply and read the output**

Run: `pnpm dlx supabase@latest db reset`
Expected: 22 migrations apply, no `"_tag":"Error"`.

- [ ] **Step 3: Write the pgTAP test**

Create `supabase/tests/018_landmarks.test.sql`:

```sql
begin;
select plan(7);

select is((select count(*)::int from public.landmarks), 40,
  'the gazetteer is seeded');

select is(
  (select name from public.search_landmarks('kimironko market', 5) limit 1),
  'Kimironko Market',
  'an exact name finds its landmark');

select is(
  (select name from public.search_landmarks('kim', 5) limit 1),
  'Kigali International Airport',
  'a prefix search returns a prefix match first');

select ok(
  (select count(*) from public.search_landmarks('kim', 10)) > 1,
  'a short prefix returns several candidates');

-- "simba" is an alias, not a name prefix, on two different branches.
select is(
  (select count(*)::int from public.search_landmarks('simba', 10)),
  2,
  'an alias finds both Simba branches');

select is(
  (select count(*)::int from public.search_landmarks('', 10)),
  0,
  'an empty query returns nothing rather than the whole gazetteer');

select ok(
  not has_function_privilege('anon', 'public.search_landmarks(text,integer)', 'EXECUTE'),
  'the gazetteer is not readable by anonymous callers');

select * from finish();
rollback;
```

Note the third assertion: `'kim'` prefixes both `Kimironko Market` and `Kigali International Airport`; alphabetically `Kigali…` sorts first among prefix matches. If your seeded data orders differently, fix the assertion to match reality rather than reordering the seed.

- [ ] **Step 4: Run and commit**

Run: `pnpm dlx supabase@latest test db`
Expected: 18 files, all pass. Report the assertion count you observe.

```bash
git add supabase
git commit -m "feat(db): seed the Kigali landmark gazetteer

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Places and trip-watching bindings

**Files:**
- Create: `packages/data/src/places.ts`
- Create: `packages/data/src/trip-watch.ts`
- Modify: `packages/data/src/index.ts`
- Test: `packages/data/test/places.test.ts`
- Test: `packages/data/test/trip-watch.test.ts`

**Interfaces:**
- Consumes: `GeraClient` from `packages/data/src/client.ts`
- Produces:
  - `Place = { id: string; name: string; sector: string | null; lng: number; lat: number }`
  - `searchLandmarks(client, query, limit?): Promise<Place[]>`
  - `TripSnapshot = { id: string; state: string; driverId: string | null; quotedAmountRwf: number | null; pickupLabel: string; dropoffLabel: string }`
  - `getTrip(client, tripId): Promise<TripSnapshot>`
  - `LIVE_TRIP_STATES: readonly string[]` and `isTripLive(state): boolean`

- [ ] **Step 1: Write the failing tests**

Create `packages/data/test/places.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { searchLandmarks } from "../src/places";
import type { GeraClient } from "../src/client";

function client(data: unknown, error: unknown = null): GeraClient {
  return { rpc: vi.fn().mockResolvedValue({ data, error }) } as unknown as GeraClient;
}

describe("searchLandmarks", () => {
  it("maps rows into places", async () => {
    const c = client([
      { id: "1", name: "Kimironko Market", sector: "Kimironko", lng: 30.1128, lat: -1.9403 },
    ]);
    const out = await searchLandmarks(c, "kimironko");
    expect(out[0]?.name).toBe("Kimironko Market");
    expect(out[0]?.lat).toBeCloseTo(-1.9403, 4);
  });

  it("returns an empty list for a blank query without calling the server", async () => {
    const c = client(null);
    expect(await searchLandmarks(c, "   ")).toEqual([]);
    expect(c.rpc).not.toHaveBeenCalled();
  });

  it("throws when the server errors", async () => {
    const c = client(null, { message: "boom" });
    await expect(searchLandmarks(c, "kim")).rejects.toThrow("boom");
  });

  it("returns an empty list when the server returns nothing", async () => {
    const c = client(null);
    expect(await searchLandmarks(c, "zzz")).toEqual([]);
  });
});
```

Create `packages/data/test/trip-watch.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { getTrip, isTripLive, LIVE_TRIP_STATES } from "../src/trip-watch";
import type { GeraClient } from "../src/client";

function client(data: unknown, error: unknown = null): GeraClient {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error }),
  };
  return { from: vi.fn().mockReturnValue(chain) } as unknown as GeraClient;
}

describe("isTripLive", () => {
  it("counts every pre-terminal state as live", () => {
    for (const s of ["requested", "offered", "accepted", "arrived", "in_progress"]) {
      expect(isTripLive(s)).toBe(true);
    }
  });

  it("does not count terminal states as live", () => {
    for (const s of ["completed", "cancelled_by_rider", "cancelled_by_driver", "no_drivers", "expired"]) {
      expect(isTripLive(s)).toBe(false);
    }
  });

  it("lists exactly the five live states", () => {
    expect([...LIVE_TRIP_STATES].sort()).toEqual(
      ["accepted", "arrived", "in_progress", "offered", "requested"],
    );
  });
});

describe("getTrip", () => {
  it("maps the row into a snapshot", async () => {
    const c = client({
      id: "t1", state: "offered", driver_id: "d1",
      quoted_amount_rwf: 1700, pickup_label: "Kimironko", dropoff_label: "Heights",
    });
    const t = await getTrip(c, "t1");
    expect(t.state).toBe("offered");
    expect(t.driverId).toBe("d1");
    expect(t.quotedAmountRwf).toBe(1700);
  });

  it("throws when the trip cannot be read", async () => {
    const c = client(null, { message: "not found" });
    await expect(getTrip(c, "t1")).rejects.toThrow("not found");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @gera/data test`
Expected: FAIL — cannot resolve `../src/places` and `../src/trip-watch`.

- [ ] **Step 3: Implement places**

Create `packages/data/src/places.ts`:

```ts
import type { GeraClient } from "./client";

export interface Place {
  readonly id: string;
  readonly name: string;
  readonly sector: string | null;
  readonly lng: number;
  readonly lat: number;
}

interface LandmarkRow {
  id: string;
  name: string;
  sector: string | null;
  lng: number;
  lat: number;
}

/**
 * Spec 3.7: destination search is landmark-first, because most Kigali addresses
 * do not exist. A blank query returns nothing rather than the whole gazetteer -
 * an empty search box should not look like a directory.
 */
export async function searchLandmarks(
  client: GeraClient,
  query: string,
  limit = 8,
): Promise<Place[]> {
  if (query.trim().length === 0) return [];

  const { data, error } = await client.rpc("search_landmarks", {
    p_query: query,
    p_limit: limit,
  });

  if (error) throw new Error(error.message);
  if (!data) return [];

  return (data as LandmarkRow[]).map((r) => ({
    id: r.id,
    name: r.name,
    sector: r.sector,
    lng: Number(r.lng),
    lat: Number(r.lat),
  }));
}
```

- [ ] **Step 4: Implement trip watching**

Create `packages/data/src/trip-watch.ts`:

```ts
import type { GeraClient } from "./client";

/** Every state before the trip reaches an end. */
export const LIVE_TRIP_STATES = [
  "requested",
  "offered",
  "accepted",
  "arrived",
  "in_progress",
] as const;

export function isTripLive(state: string): boolean {
  return (LIVE_TRIP_STATES as readonly string[]).includes(state);
}

export interface TripSnapshot {
  readonly id: string;
  readonly state: string;
  readonly driverId: string | null;
  readonly quotedAmountRwf: number | null;
  readonly pickupLabel: string;
  readonly dropoffLabel: string;
}

interface TripRow {
  id: string;
  state: string;
  driver_id: string | null;
  quoted_amount_rwf: number | null;
  pickup_label: string;
  dropoff_label: string;
}

export async function getTrip(client: GeraClient, tripId: string): Promise<TripSnapshot> {
  const { data, error } = await client
    .from("trips")
    .select("id, state, driver_id, quoted_amount_rwf, pickup_label, dropoff_label")
    .eq("id", tripId)
    .single();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("trip not found");

  const r = data as TripRow;
  return {
    id: r.id,
    state: r.state,
    driverId: r.driver_id,
    quotedAmountRwf: r.quoted_amount_rwf,
    pickupLabel: r.pickup_label,
    dropoffLabel: r.dropoff_label,
  };
}
```

- [ ] **Step 5: Export, verify, commit**

Add to `packages/data/src/index.ts`:

```ts
export * from "./places";
export * from "./trip-watch";
```

Run: `pnpm --filter @gera/data test && pnpm --filter @gera/data typecheck`
Expected: both PASS. Test count rises from 17 to 27.

```bash
git add packages/data
git commit -m "feat(data): search landmarks and read a trip's live state

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: The sheet shape map

Spec 5.1: trip states map **one-to-one** onto sheet configurations, which is what makes the UI a pure function of server state. Putting that mapping in `packages/ui` keeps it testable without a device.

**Files:**
- Create: `packages/ui/src/sheet.ts`
- Modify: `packages/ui/src/index.ts`
- Test: `packages/ui/test/sheet.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `SheetHeight = { collapsed: number; peek: number; half: number; tall: number }` as `SHEET_HEIGHTS` (fractions of screen height)
  - `sheetHeightFor(state: string): number`
  - `sheetTitleFor(state: string): string`

- [ ] **Step 1: Write the failing test**

Create `packages/ui/test/sheet.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { SHEET_HEIGHTS, sheetHeightFor, sheetTitleFor } from "../src/sheet";

describe("sheet heights", () => {
  it("are ordered and all within the screen", () => {
    const { collapsed, peek, half, tall } = SHEET_HEIGHTS;
    expect(collapsed).toBeLessThan(peek);
    expect(peek).toBeLessThan(half);
    expect(half).toBeLessThan(tall);
    expect(tall).toBeLessThanOrEqual(0.9);
  });

  it("never covers the whole screen, so the map is always visible", () => {
    expect(SHEET_HEIGHTS.tall).toBeLessThan(1);
  });
});

describe("sheetHeightFor", () => {
  it("shows a small sheet while idle", () => {
    expect(sheetHeightFor("idle")).toBe(SHEET_HEIGHTS.peek);
  });

  it("grows while searching for a driver", () => {
    expect(sheetHeightFor("requested")).toBe(SHEET_HEIGHTS.half);
  });

  it("settles once a driver is assigned", () => {
    expect(sheetHeightFor("accepted")).toBe(SHEET_HEIGHTS.half);
  });

  it("uses the tallest sheet for the receipt", () => {
    expect(sheetHeightFor("completed")).toBe(SHEET_HEIGHTS.tall);
  });

  it("falls back to peek for an unknown state rather than throwing", () => {
    expect(sheetHeightFor("something_new")).toBe(SHEET_HEIGHTS.peek);
  });
});

describe("sheetTitleFor", () => {
  it("tells the rider what is happening, not what the state is called", () => {
    expect(sheetTitleFor("requested")).toBe("Finding you a driver");
    expect(sheetTitleFor("offered")).toBe("Finding you a driver");
    expect(sheetTitleFor("accepted")).toBe("Driver on the way");
    expect(sheetTitleFor("arrived")).toBe("Your driver is here");
    expect(sheetTitleFor("in_progress")).toBe("On the way");
    expect(sheetTitleFor("completed")).toBe("Trip complete");
    expect(sheetTitleFor("no_drivers")).toBe("No drivers nearby");
  });

  it("never shows a raw state name to a rider", () => {
    for (const s of ["requested", "offered", "accepted", "arrived", "in_progress", "completed", "no_drivers"]) {
      expect(sheetTitleFor(s)).not.toContain("_");
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gera/ui test`
Expected: FAIL — cannot resolve `../src/sheet`.

- [ ] **Step 3: Implement**

Create `packages/ui/src/sheet.ts`:

```ts
/**
 * Fractions of screen height. The sheet never reaches 1 - spec 5.1 keeps the
 * map visible at every stage so the rider never loses context.
 */
export const SHEET_HEIGHTS = {
  collapsed: 0.14,
  peek: 0.3,
  half: 0.45,
  tall: 0.62,
} as const;

const HEIGHT_BY_STATE: Record<string, number> = {
  idle: SHEET_HEIGHTS.peek,
  picking: SHEET_HEIGHTS.tall,
  quoted: SHEET_HEIGHTS.half,
  requested: SHEET_HEIGHTS.half,
  offered: SHEET_HEIGHTS.half,
  accepted: SHEET_HEIGHTS.half,
  arrived: SHEET_HEIGHTS.half,
  in_progress: SHEET_HEIGHTS.peek,
  completed: SHEET_HEIGHTS.tall,
  no_drivers: SHEET_HEIGHTS.half,
};

export function sheetHeightFor(state: string): number {
  return HEIGHT_BY_STATE[state] ?? SHEET_HEIGHTS.peek;
}

/**
 * Riders read intent, not schema. "offered" is an implementation detail: from
 * the rider's side it is still the app looking for someone.
 */
const TITLE_BY_STATE: Record<string, string> = {
  idle: "Where to?",
  picking: "Where to?",
  quoted: "Confirm your ride",
  requested: "Finding you a driver",
  offered: "Finding you a driver",
  accepted: "Driver on the way",
  arrived: "Your driver is here",
  in_progress: "On the way",
  completed: "Trip complete",
  no_drivers: "No drivers nearby",
  cancelled_by_rider: "Trip cancelled",
  cancelled_by_driver: "Trip cancelled",
};

export function sheetTitleFor(state: string): string {
  return TITLE_BY_STATE[state] ?? "Where to?";
}
```

- [ ] **Step 4: Export, verify, commit**

Add to `packages/ui/src/index.ts`:

```ts
export * from "./sheet";
```

Run: `pnpm --filter @gera/ui test && pnpm --filter @gera/ui typecheck`
Expected: both PASS, 15 tests.

```bash
git add packages/ui
git commit -m "feat(ui): map trip states onto sheet shapes and rider-facing titles

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: The map

**Files:**
- Create: `apps/rider/src/components/TripMap.tsx`
- Modify: `apps/rider/package.json` (adds `react-native-webview`)

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: `<TripMap center markers onPressMap />` where
  - `LatLng = { lat: number; lng: number }`
  - `MapMarker = { id: string; at: LatLng; label: string; kind: "pickup" | "dropoff" | "driver" }`
  - props: `{ center: LatLng; markers?: readonly MapMarker[]; onPressMap?: (at: LatLng) => void }`

**Why Leaflet in a WebView:** spec 3.7 chooses Google Maps for Rwandan road coverage, and that needs an API key this project does not have. An unkeyed `react-native-maps` renders a blank grey rectangle on Android — the rider would see nothing at all. Leaflet on OpenStreetMap needs no key, renders real Kigali streets, and hides behind this component's props, so swapping to Google later changes one file. Say so in a comment.

- [ ] **Step 1: Install the WebView**

Run: `cd apps/rider && npx expo install react-native-webview`

- [ ] **Step 2: Write the component**

Create `apps/rider/src/components/TripMap.tsx`:

```tsx
import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import { lightTheme } from "@gera/ui";

export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

export interface MapMarker {
  readonly id: string;
  readonly at: LatLng;
  readonly label: string;
  readonly kind: "pickup" | "dropoff" | "driver";
}

interface Props {
  readonly center: LatLng;
  readonly markers?: readonly MapMarker[];
  readonly onPressMap?: (at: LatLng) => void;
}

const PIN_COLOUR: Record<MapMarker["kind"], string> = {
  pickup: "#0E7C4A",
  dropoff: "#C0342B",
  driver: "#F5A524",
};

/**
 * Spec 3.7 picks Google Maps for Rwandan road coverage, which needs an API key
 * this project does not have yet - and an unkeyed react-native-maps renders a
 * blank grey rectangle on Android, so the rider would see nothing. Leaflet on
 * OpenStreetMap needs no key and draws real Kigali streets. Everything Google
 * would change lives behind this component's props, so the swap is one file.
 */
function html(center: LatLng, markers: readonly MapMarker[]): string {
  const pins = markers
    .map(
      (m) => `L.circleMarker([${m.at.lat}, ${m.at.lng}], {
        radius: 9, weight: 3, color: '#fff',
        fillColor: '${PIN_COLOUR[m.kind]}', fillOpacity: 1
      }).addTo(map).bindTooltip(${JSON.stringify(m.label)}, {permanent:false});`,
    )
    .join("\n");

  return `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>html,body,#m{height:100%;margin:0;background:${lightTheme.surface}}</style>
</head><body><div id="m"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  var map = L.map('m', {zoomControl:false, attributionControl:false})
              .setView([${center.lat}, ${center.lng}], 14);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:19}).addTo(map);
  ${pins}
  map.on('click', function(e){
    window.ReactNativeWebView && window.ReactNativeWebView.postMessage(
      JSON.stringify({lat:e.latlng.lat, lng:e.latlng.lng}));
  });
</script></body></html>`;
}

export function TripMap({ center, markers = [], onPressMap }: Props) {
  // Callers pass an inline array, so a dependency on `markers` itself would
  // change identity every render, rebuild the document, and reload the tiles.
  // Depend on its contents instead.
  const key = markers.map((m) => `${m.id}:${m.at.lat}:${m.at.lng}:${m.kind}:${m.label}`).join("|");
  const source = useMemo(
    () => ({ html: html(center, markers) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [center.lat, center.lng, key],
  );

  return (
    <View style={styles.root}>
      <WebView
        originWhitelist={["*"]}
        source={source}
        style={styles.web}
        onMessage={(e) => {
          if (!onPressMap) return;
          try {
            const p = JSON.parse(e.nativeEvent.data) as LatLng;
            if (typeof p.lat === "number" && typeof p.lng === "number") onPressMap(p);
          } catch {
            // A message we do not understand is not worth crashing the map over.
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, backgroundColor: lightTheme.surface },
  web: { flex: 1, backgroundColor: lightTheme.surface },
});
```

- [ ] **Step 3: Typecheck and commit**

Run: `pnpm --filter rider exec tsc --noEmit`
Expected: exit 0.

```bash
git add apps/rider package.json pnpm-lock.yaml
git commit -m "feat(rider): draw a real Kigali map without an API key

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: Home — map and "Where to?"

**Files:**
- Create: `apps/rider/src/components/Sheet.tsx`
- Modify: `apps/rider/app/index.tsx`

**Interfaces:**
- Consumes: `TripMap`, `sheetHeightFor`, `sheetTitleFor`, `lightTheme`, `tokens`
- Produces: `<Sheet state title>` — a bottom sheet whose height comes from the state

- [ ] **Step 1: Write the sheet shell**

Create `apps/rider/src/components/Sheet.tsx`:

```tsx
import type { ReactNode } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { lightTheme, tokens, sheetHeightFor, sheetTitleFor } from "@gera/ui";

interface Props {
  readonly state: string;
  readonly children: ReactNode;
}

/**
 * Spec 5.1: one map, one sheet. The sheet's height and title are a pure
 * function of the trip state, so the UI cannot disagree with the server.
 */
export function Sheet({ state, children }: Props) {
  const { height } = useWindowDimensions();
  return (
    <View style={[styles.sheet, { height: height * sheetHeightFor(state) }]}>
      <View style={styles.grabber} />
      <Text style={styles.title}>{sheetTitleFor(state)}</Text>
      <View style={styles.body}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    backgroundColor: lightTheme.surfaceRaised,
    borderTopLeftRadius: tokens.radius.lg,
    borderTopRightRadius: tokens.radius.lg,
    paddingHorizontal: tokens.space.lg,
    paddingTop: tokens.space.sm,
    paddingBottom: tokens.space.xl,
    shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 }, elevation: 12,
  },
  grabber: {
    alignSelf: "center", width: 44, height: 5, borderRadius: tokens.radius.pill,
    backgroundColor: lightTheme.textMuted, opacity: 0.35, marginBottom: tokens.space.md,
  },
  title: {
    fontSize: tokens.type.title.size, fontWeight: "700",
    color: lightTheme.textStrong, marginBottom: tokens.space.md,
  },
  body: { flex: 1 },
});
```

- [ ] **Step 2: Rewrite the home screen**

Replace `apps/rider/app/index.tsx` entirely:

```tsx
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { lightTheme, tokens } from "@gera/ui";
import { supabase } from "../src/lib/supabase";
import { TripMap } from "../src/components/TripMap";
import { Sheet } from "../src/components/Sheet";

// Kimironko Market - a sensible default until real GPS lands in Phase 3b.
const KIGALI = { lat: -1.9403, lng: 30.1128 };

export default function Home() {
  const router = useRouter();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setSignedIn(Boolean(data.session));
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (active) setSignedIn(Boolean(session));
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (signedIn === null) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={lightTheme.accent} />
      </View>
    );
  }
  if (!signedIn) return <Redirect href="/onboarding/phone" />;

  return (
    <View style={styles.root}>
      <TripMap
        center={KIGALI}
        markers={[{ id: "me", at: KIGALI, label: "You are near here", kind: "pickup" }]}
      />
      <Sheet state="idle">
        <Pressable style={styles.search} onPress={() => router.push("/destination")}>
          <Text style={styles.searchText}>Where to?</Text>
        </Pressable>
        <Text style={styles.hint}>
          Search a landmark, or drop a pin on the map.
        </Text>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: lightTheme.surface },
  centre: {
    flex: 1, alignItems: "center", justifyContent: "center",
    backgroundColor: lightTheme.surface,
  },
  search: {
    minHeight: tokens.MIN_TOUCH_TARGET,
    justifyContent: "center",
    paddingHorizontal: tokens.space.md,
    borderRadius: tokens.radius.md,
    borderWidth: 2,
    borderColor: lightTheme.accent,
    backgroundColor: lightTheme.surface,
  },
  searchText: {
    fontSize: tokens.type.title.size, fontWeight: "700", color: lightTheme.textStrong,
  },
  hint: {
    marginTop: tokens.space.md, fontSize: tokens.type.body.size, color: lightTheme.textMuted,
  },
});
```

- [ ] **Step 3: Typecheck and commit**

Run: `pnpm --filter rider exec tsc --noEmit`
Expected: exit 0.

```bash
git add apps/rider
git commit -m "feat(rider): put a map and a where-to sheet on the home screen

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: The landmark-first destination picker

Spec 3.7: recent → saved → curated gazetteer → pin-drop, and a pin-drop **always** collects a one-line "how to find me" note, which is shown large to the driver. That note is a two-line feature with a measurable effect on pickup failures.

**Files:**
- Create: `apps/rider/app/destination.tsx`

**Interfaces:**
- Consumes: `searchLandmarks`, `Place` from `@gera/data`; `TripMap`
- Produces: navigates to `/ride` with params `{ lng, lat, label, note? }`

- [ ] **Step 1: Write the screen**

Create `apps/rider/app/destination.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useRouter } from "expo-router";
import { lightTheme, tokens } from "@gera/ui";
import { searchLandmarks, type Place } from "@gera/data";
import { supabase } from "../src/lib/supabase";
import { TripMap, type LatLng } from "../src/components/TripMap";

const KIGALI = { lat: -1.9403, lng: 30.1128 };

export default function Destination() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pin, setPin] = useState<LatLng | null>(null);
  const [note, setNote] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length === 0) {
      setResults([]);
      return;
    }
    // Debounced: a search per keystroke burns the rider's data bundle.
    timer.current = setTimeout(() => {
      setBusy(true);
      setError(null);
      searchLandmarks(supabase, q)
        .then(setResults)
        .catch(() => setError("Could not search just now."))
        .finally(() => setBusy(false));
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q]);

  const choose = useCallback(
    (lng: number, lat: number, label: string, howToFind?: string) => {
      router.push({
        pathname: "/ride",
        params: {
          lng: String(lng), lat: String(lat), label,
          ...(howToFind && howToFind.trim() ? { note: howToFind.trim() } : {}),
        },
      });
    },
    [router],
  );

  return (
    <View style={styles.root}>
      <View style={styles.searchBar}>
        <TextInput
          style={styles.input}
          value={q}
          onChangeText={setQ}
          placeholder="Search a landmark — Kimironko, Simba, airport"
          placeholderTextColor={lightTheme.textMuted}
          autoFocus
        />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {q.trim().length > 0 ? (
        <FlatList
          style={styles.list}
          data={results}
          keyExtractor={(p) => p.id}
          ListEmptyComponent={
            busy ? (
              <ActivityIndicator style={styles.spin} color={lightTheme.accent} />
            ) : (
              <Text style={styles.hint}>
                No landmark matches. Drop a pin on the map instead.
              </Text>
            )
          }
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => choose(item.lng, item.lat, item.name)}>
              <Text style={styles.rowName}>{item.name}</Text>
              {item.sector ? <Text style={styles.rowSector}>{item.sector}</Text> : null}
            </Pressable>
          )}
        />
      ) : (
        <View style={styles.mapWrap}>
          <TripMap
            center={KIGALI}
            markers={pin ? [{ id: "pin", at: pin, label: "Drop-off", kind: "dropoff" }] : []}
            onPressMap={setPin}
          />
          {pin ? (
            <View style={styles.pinPanel}>
              <Text style={styles.pinTitle}>Drop-off pinned</Text>
              <TextInput
                style={styles.noteInput}
                value={note}
                onChangeText={setNote}
                placeholder="How to find you — e.g. blue gate opposite the pharmacy"
                placeholderTextColor={lightTheme.textMuted}
              />
              <Pressable
                style={styles.cta}
                onPress={() => choose(pin.lng, pin.lat, "Pinned location", note)}
              >
                <Text style={styles.ctaText}>Use this spot</Text>
              </Pressable>
            </View>
          ) : (
            <Text style={styles.tapHint}>Tap the map to drop a pin</Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: lightTheme.surface },
  searchBar: { padding: tokens.space.lg, paddingBottom: tokens.space.sm },
  input: {
    minHeight: tokens.MIN_TOUCH_TARGET,
    fontSize: tokens.type.body.size,
    color: lightTheme.textStrong,
    borderWidth: 2, borderColor: lightTheme.accent,
    borderRadius: tokens.radius.md, paddingHorizontal: tokens.space.md,
  },
  list: { flex: 1 },
  row: {
    minHeight: tokens.MIN_TOUCH_TARGET, justifyContent: "center",
    paddingHorizontal: tokens.space.lg, paddingVertical: tokens.space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: lightTheme.textMuted,
  },
  rowName: { fontSize: tokens.type.body.size, fontWeight: "600", color: lightTheme.textStrong },
  rowSector: { fontSize: tokens.type.label.size, color: lightTheme.textMuted },
  hint: { padding: tokens.space.lg, color: lightTheme.textMuted, fontSize: tokens.type.body.size },
  tapHint: {
    position: "absolute", top: tokens.space.md, alignSelf: "center",
    backgroundColor: lightTheme.surfaceRaised, color: lightTheme.textStrong,
    paddingHorizontal: tokens.space.md, paddingVertical: tokens.space.sm,
    borderRadius: tokens.radius.pill, overflow: "hidden", fontSize: tokens.type.label.size,
  },
  spin: { marginTop: tokens.space.xl },
  error: { color: lightTheme.danger, paddingHorizontal: tokens.space.lg },
  mapWrap: { flex: 1 },
  pinPanel: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    backgroundColor: lightTheme.surfaceRaised,
    padding: tokens.space.lg,
    borderTopLeftRadius: tokens.radius.lg, borderTopRightRadius: tokens.radius.lg,
  },
  pinTitle: {
    fontSize: tokens.type.title.size, fontWeight: "700", color: lightTheme.textStrong,
  },
  noteInput: {
    marginTop: tokens.space.sm, minHeight: tokens.MIN_TOUCH_TARGET,
    fontSize: tokens.type.body.size, color: lightTheme.textStrong,
    borderBottomWidth: 2, borderBottomColor: lightTheme.accent,
  },
  cta: {
    marginTop: tokens.space.lg, minHeight: tokens.MIN_TOUCH_TARGET,
    backgroundColor: lightTheme.accent, borderRadius: tokens.radius.lg,
    alignItems: "center", justifyContent: "center",
  },
  ctaText: { fontSize: tokens.type.body.size, fontWeight: "700", color: lightTheme.onAccent },
});
```

- [ ] **Step 2: Typecheck and commit**

Run: `pnpm --filter rider exec tsc --noEmit`
Expected: exit 0.

```bash
git add apps/rider
git commit -m "feat(rider): pick a destination by landmark, or drop a pin

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: Vehicle choice, upfront quote, and booking

Spec 5.2: prices are shown as **cards, not a carousel**, moto first and default, price in display numerals with the ETA secondary. The quote is locked for 120 seconds, which is the commercial differentiator against the metered incumbent.

**Files:**
- Create: `apps/rider/app/ride.tsx`

**Interfaces:**
- Consumes: `requestQuote`, `createTripFromQuote`, `getTrip`, `isTripLive`, `sheetTitleFor` from `@gera/data` and `@gera/ui`; `TripMap`, `Sheet`
- Produces: the booking and live-trip screen

**Distance note:** real routing arrives with navigation in a later phase. Until then the screen estimates distance with a straight-line haversine between pickup and drop-off and derives duration from it, which is honest for a quote and clearly marked in a comment.

- [ ] **Step 1: Write the screen**

Create `apps/rider/app/ride.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { lightTheme, tokens } from "@gera/ui";
import {
  requestQuote, createTripFromQuote, getTrip, isTripLive,
  type QuoteResult, type TripSnapshot,
} from "@gera/data";
import { supabase } from "../src/lib/supabase";
import { TripMap } from "../src/components/TripMap";
import { Sheet } from "../src/components/Sheet";

const PICKUP = { lat: -1.9403, lng: 30.1128 };

const CLASSES = [
  { id: "moto" as const, label: "Moto", blurb: "Fastest through traffic" },
  { id: "cab" as const, label: "Cab", blurb: "Covered, up to 3 people" },
  { id: "cab_xl" as const, label: "Cab XL", blurb: "More room and luggage" },
];

/** Straight-line metres. Real road distance arrives with navigation. */
function haversineM(a: typeof PICKUP, b: typeof PICKUP): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}

const money = (rwf: number) => rwf.toLocaleString("en-US");

export default function Ride() {
  const router = useRouter();
  const p = useLocalSearchParams<{ lng?: string; lat?: string; label?: string; note?: string }>();
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  const lng = Number(one(p.lng));
  const lat = Number(one(p.lat));
  const label = one(p.label) ?? "Destination";
  const note = one(p.note);

  const [vehicleClass, setVehicleClass] = useState<"moto" | "cab" | "cab_xl">("moto");
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [trip, setTrip] = useState<TripSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dropoff = { lat, lng };
  const distanceM = Number.isFinite(lat) && Number.isFinite(lng) ? haversineM(PICKUP, dropoff) : 0;
  const durationS = Math.max(60, Math.round((distanceM / 7.5)));

  // Quote whenever the class changes, so the price on screen is the price booked.
  useEffect(() => {
    if (trip) return;
    let active = true;
    setBusy(true);
    setError(null);
    requestQuote(supabase, { vehicleClass, distanceM, durationS })
      .then((q) => active && setQuote(q))
      .catch(() => active && setError("Could not get a price just now."))
      .finally(() => active && setBusy(false));
    return () => { active = false; };
  }, [vehicleClass, distanceM, durationS, trip]);

  // Poll while the trip is live. Realtime streaming arrives in a later phase.
  useEffect(() => {
    if (!trip || !isTripLive(trip.state)) return;
    const id = setInterval(() => {
      getTrip(supabase, trip.id).then(setTrip).catch(() => {});
    }, 3000);
    return () => clearInterval(id);
  }, [trip]);

  const book = useCallback(async () => {
    if (!quote) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createTripFromQuote(supabase, {
        quoteId: quote.quoteId,
        pickup: PICKUP,
        pickupLabel: "Kimironko Market",
        ...(note ? { pickupNote: note } : {}),
        dropoff,
        dropoffLabel: label,
      });
      setTrip(await getTrip(supabase, created.id));
    } catch {
      setError("Could not book that ride. Your price may have expired.");
    } finally {
      setBusy(false);
    }
  }, [quote, note, label, dropoff]);

  const state = trip?.state ?? (quote ? "quoted" : "idle");

  return (
    <View style={styles.root}>
      <TripMap
        center={PICKUP}
        markers={[
          { id: "p", at: PICKUP, label: "Pickup", kind: "pickup" },
          ...(Number.isFinite(lat) ? [{ id: "d", at: dropoff, label, kind: "dropoff" as const }] : []),
        ]}
      />

      <Sheet state={state}>
        {trip ? (
          <View style={styles.flex}>
            <Text style={styles.route}>{trip.pickupLabel} → {trip.dropoffLabel}</Text>
            {trip.quotedAmountRwf !== null ? (
              <Text style={styles.fare}>{money(trip.quotedAmountRwf)} RWF</Text>
            ) : null}
            {isTripLive(trip.state) ? (
              <ActivityIndicator style={styles.spin} color={lightTheme.accent} />
            ) : (
              <Pressable style={styles.cta} onPress={() => router.replace("/")}>
                <Text style={styles.ctaText}>Done</Text>
              </Pressable>
            )}
          </View>
        ) : (
          <View style={styles.flex}>
            {CLASSES.map((c) => (
              <Pressable
                key={c.id}
                style={[styles.card, vehicleClass === c.id && styles.cardActive]}
                onPress={() => setVehicleClass(c.id)}
              >
                <View style={styles.flex}>
                  <Text style={styles.cardLabel}>{c.label}</Text>
                  <Text style={styles.cardBlurb}>{c.blurb}</Text>
                </View>
                {vehicleClass === c.id && quote ? (
                  <Text style={styles.cardPrice}>{money(quote.amountRwf)} RWF</Text>
                ) : null}
              </Pressable>
            ))}

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              style={[styles.cta, (!quote || busy) && styles.ctaDisabled]}
              onPress={book}
              disabled={!quote || busy}
            >
              <Text style={styles.ctaText}>
                {busy ? "Just a moment…" : quote ? `Book for ${money(quote.amountRwf)} RWF` : "Getting price…"}
              </Text>
            </Pressable>
          </View>
        )}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: lightTheme.surface },
  flex: { flex: 1 },
  card: {
    flexDirection: "row", alignItems: "center",
    minHeight: tokens.MIN_TOUCH_TARGET,
    paddingHorizontal: tokens.space.md, paddingVertical: tokens.space.sm,
    borderRadius: tokens.radius.md, borderWidth: 2,
    borderColor: "transparent", marginBottom: tokens.space.sm,
  },
  cardActive: { borderColor: lightTheme.accent, backgroundColor: lightTheme.surface },
  cardLabel: { fontSize: tokens.type.body.size, fontWeight: "700", color: lightTheme.textStrong },
  cardBlurb: { fontSize: tokens.type.label.size, color: lightTheme.textMuted },
  cardPrice: {
    fontSize: tokens.type.title.size, fontWeight: "700", color: lightTheme.textStrong,
  },
  route: { fontSize: tokens.type.body.size, color: lightTheme.textMuted },
  fare: {
    fontSize: tokens.type.display.size, fontWeight: "700",
    color: lightTheme.textStrong, marginTop: tokens.space.sm,
  },
  spin: { marginTop: tokens.space.lg },
  error: { color: lightTheme.danger, marginBottom: tokens.space.sm },
  cta: {
    marginTop: "auto", minHeight: tokens.MIN_TOUCH_TARGET,
    backgroundColor: lightTheme.accent, borderRadius: tokens.radius.lg,
    alignItems: "center", justifyContent: "center",
  },
  ctaDisabled: { opacity: 0.5 },
  ctaText: { fontSize: tokens.type.body.size, fontWeight: "700", color: lightTheme.onAccent },
});
```

- [ ] **Step 2: Typecheck and commit**

`createTripFromQuote` already accepts `pickupNote` and forwards it as
`p_pickup_note` — verified in `packages/data/src/trips.ts`. Do not re-add it.

Run: `pnpm --filter rider exec tsc --noEmit && pnpm --filter @gera/data test`
Expected: both pass.

```bash
git add apps/rider
git commit -m "feat(rider): choose a vehicle, see a locked price, and book

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: Walk it on a device

A screen that compiles is not a screen that works. Phase 1 nearly shipped an onboarding flow that could never log in, because verification stopped at typecheck.

**Files:** none — this is a verification task.

- [ ] **Step 1: Full suite**

Run: `pnpm verify`
Expected: exit 0.

Run: `pnpm dlx supabase@latest test db`
Expected: 18 files, all pass.

- [ ] **Step 2: Seed a driver so dispatch can succeed**

Run: `pnpm simulate -- --drivers 15 --minutes 5` in its own terminal, so there are funded, verified, online drivers near Kimironko.

- [ ] **Step 3: Serve the functions**

Run: `pnpm dlx supabase@latest functions serve --no-verify-jwt` in its own terminal.

- [ ] **Step 4: Run the app and walk it**

Run: `cd apps/rider && npx expo start --lan`

On a device or emulator, confirm each of these and record what you saw:
1. The map renders real Kigali streets.
2. "Where to?" opens the picker; typing `kim` lists Kimironko Market and Kigali International Airport.
3. Choosing one shows three vehicle cards with **Moto first and selected**, and a price in large numerals.
4. Switching to Cab re-quotes to a higher price.
5. Booking moves the sheet to "Finding you a driver".
6. With the simulator running, the sheet reaches "Driver on the way" within a few seconds.
7. Dropping a pin instead of searching asks for a "how to find you" note.

If any step fails, fix the cause — do not adjust the checklist. Report exactly which steps you confirmed and which you could not.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix(rider): corrections found walking the booking flow on a device

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Definition of done

- [ ] `pnpm verify` exits 0.
- [ ] `pnpm dlx supabase@latest test db` — 18 files, all pass.
- [ ] A rider can search a Kigali landmark and see it on a real map.
- [ ] Moto is first and pre-selected; the price is shown before booking and does not change on booking.
- [ ] Booking produces a trip that reaches "Driver on the way" with the simulator running.
- [ ] A pin-drop always collects the "how to find you" note.
- [ ] No screen shows a raw trip state name to a rider.

## Deliberately not in this plan

- Real GPS pickup — the pickup is hardcoded to Kimironko Market until background location lands.
- Google Maps and real road routing; distance is straight-line haversine.
- Realtime position streaming; the live trip polls every three seconds.
- The driver's live marker moving on the rider's map.
- Cancellation, rating, and the receipt breakdown by line.
- The driver app's go-online toggle, offer card, heatmap, earnings and safety features.
- Contact masking (spec 3.6).
