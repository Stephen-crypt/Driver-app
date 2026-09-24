# Gera — Core Trip Loop: Design Spec

**Date:** 2026-09-24
**Status:** Draft for review
**Scope:** MVP core trip loop, rider + driver apps, real backend. Ops console deferred.

---

## 1. Product context

### 1.1 What this is

A ride-hailing platform for Rwanda, launching in Kigali, covering moto-taxis and cars. The MVP delivers the complete trip loop end-to-end on a real backend: a rider requests a ride, a driver is matched and dispatched, GPS tracks the trip live, the trip completes, and the fare and platform commission are accounted for.

### 1.2 Market position

The incumbent is **Yego** (local, operating since 2016, moto + car, metered fares). **Bolt** is the dominant international competitor. **Move** is a premium VW-only niche. Uber has no meaningful Kigali presence.

The strategic wedge is **supply-side first**. In a two-sided market with an entrenched incumbent, drivers are the scarce side. The driver app is therefore the flagship product, not the secondary one. A driver who earns measurably more per online hour will switch platforms and recruit peers; riders follow supply.

Two rider-facing differentiators support this: **upfront locked fares** (Yego is metered) and **landmark-first destination search** (see 3.7).

### 1.3 Brand

- **Name:** Gera — Kinyarwanda *kugera*, "to arrive / to reach". Tagline: "Gera. Get there."
- **Alternates considered:** Sanga (to find / to meet), Imbere (forward).
- **Rejected for conflict:** Vuba (Vuba Vuba, Rwandan delivery platform), Tugende (Ugandan moto-financing company), Genda (shadowed by Gendayo, African mobility platform).
- **ACTION REQUIRED:** the above is a web-search sanity check only. A formal RDB trademark search must be completed before any public use of the name.

**Palette.** Deep indigo base (`#141B34` family) with warm amber accent (`#F5A524` family). Chosen to avoid Bolt's green and Uber's monochrome, and because amber reads as both a Kigali moto vest and a high-visibility safety marker, and stays legible in direct equatorial sunlight.

**Motif.** Layered ridge silhouettes ("land of a thousand hills") for loading states, empty states, onboarding illustration, and custom map styling.

**Typography.** One geometric sans with full Latin Extended coverage. Display-size numerals for fares and ETAs — the most-read text in the product.

### 1.4 Decisions already taken

| Decision | Choice | Rationale |
|---|---|---|
| Ambition | Working MVP on a real backend | Deployable; payment provider mocked behind an interface |
| Clients | Expo / React Native, two apps | Background GPS rules out web for the driver app |
| Backend | Supabase — Postgres, PostGIS, Realtime, Auth, Edge Functions | Leverages existing Postgres familiarity; realtime included |
| Payments | Cash-first, driver collects; commission from a driver wallet | No customer funds held, so no BNR licence needed to start |
| Driver assist | Turn-by-turn nav, demand heatmap + earnings coaching, safety | Selected by product owner |
| Deferred | Kinyarwanda voice guidance, ops console, in-app MoMo collection | i18n scaffolded so Kinyarwanda is a translation job, not a refactor |

---

## 2. Repository structure

```
gera/
├─ apps/
│  ├─ rider/              Expo app
│  └─ driver/             Expo app
├─ packages/
│  ├─ ui/                 design tokens, primitives, map shell, sheet system
│  ├─ core/               trip state machine, fare math, shared types — ZERO dependencies
│  └─ data/               typed Supabase client, query layer, offline outbox
└─ supabase/
   ├─ migrations/         versioned SQL
   └─ functions/          quote, dispatch, trip-transition, wallet
```

`packages/core` is deliberately dependency-free. The state machine and fare arithmetic must be unit-testable with no database, device, or network. This is the highest-value test surface in the system and is written test-first.

---

## 3. Backend architecture

### 3.1 Trip state machine

Server-authoritative. Clients **request** transitions; they never **declare** them.

```
requested ──► offered ──► accepted ──► arrived ──► in_progress ──► completed
    │            │  ▲         │            │             │
    │            │  └─ declined / timeout   │            │
    │            │     (offer next driver)  │            │
    ▼            ▼                          ▼            ▼
no_drivers   expired                 cancelled_by_rider / cancelled_by_driver
```

**Invariants**

1. **Idempotent.** Every transition carries a client-generated `idempotency_key`. Replaying a transition produces one state change and N-1 no-ops.
2. **Guarded.** `trip_transition()` is a Postgres function validating (a) the current state, (b) the caller's identity and role, (c) the legality of the edge — before any write. Illegal edges and wrong-actor calls are rejected regardless of client payload.
3. **Append-only history.** Every accepted transition writes a `trip_events` row. The trip's current state is derivable from its event log; the `trips.state` column is a trigger-maintained projection for query convenience.

### 3.2 Location pipeline

Two paths, deliberately different, because conflating them is the standard scaling failure.

| | `driver_presence` | `trip_track_points` |
|---|---|---|
| Shape | One row per driver, **UPDATE in place** | Append-only, one row per GPS fix |
| Written | While online: 5s idle, 3s on-trip | Only during `in_progress` |
| Purpose | Matching — "who is near this pickup?" | Route replay, distance fare, disputes |
| Index | GiST on `geography(Point,4326)` | B-tree on `(trip_id, ts)` |
| Growth | Bounded by driver count (constant) | Bounded by trip count; archived monthly |

At 1,000 online drivers a naive append-only design produces roughly 200 writes/sec of near-worthless history. Presence-as-upsert keeps the matching index small and hot.

**Realtime fan-out is scoped, never broadcast.** A rider subscribes to their own trip's driver position only. The ambient "vehicles moving on the map" effect before booking uses a separate coarse channel publishing throttled, jittered, non-identifiable positions per geohash cell. Broadcasting precise driver positions to all clients is both a bandwidth problem and a stalking vector.

**Fix quality gate.** GPS fixes with accuracy worse than 50m are discarded. Displayed positions are smoothed and snapped to road geometry; raw fixes are what get persisted for fare and dispute purposes.

### 3.3 Matching and dispatch

An Edge Function, in three stages:

1. **Narrow (PostGIS).** `ST_DWithin` against the presence index — filtered by `status = 'online'`, matching `vehicle_class`, and heartbeat within 30s. Radius expands 1km → 2km → 4km when a stage returns no candidates.
2. **Rank (real ETA).** Straight-line distance misranks candidates in Kigali because of terrain and one-way streets. Take the top 5 by straight-line distance, then call Google Distance Matrix **for those 5 only** to obtain true ETAs. Five external calls per request, not fifty — this is the cost-control decision.
3. **Offer sequentially.** The best-ranked driver receives a 15-second exclusive offer. On decline or timeout it passes to the next. Implemented as `trip_offers` rows with an expiry, swept by `pg_cron`.

Sequential offers are chosen over broadcast deliberately: broadcasting one trip to twenty drivers creates a race with one winner and nineteen irritated drivers, which directly damages the supply side the strategy depends on.

**Double-accept is impossible** by construction: acceptance is a conditional `UPDATE ... WHERE state = 'offered' AND offered_driver_id = $1` inside a transaction. Losers of the race receive a clean "offer no longer available", not an error.

### 3.4 Fare and quoting

Fares are **quoted upfront and locked**. At request time the server computes a fare from base + per-km + per-minute rates for the vehicle class and writes a `fare_quotes` row valid for 120 seconds. The rider sees a guaranteed price before confirming.

The final fare equals the quote unless actual trip distance exceeds quoted distance by a configured tolerance (route change, rider-requested detour), in which case the excess is computed at the per-km rate and itemised separately on the receipt. Never a silent adjustment.

Fare configuration lives in a `fare_policies` table, versioned and effective-dated, so a price change never retroactively alters historical trips.

### 3.5 Wallet and ledger

**Double-entry and append-only.** `ledger_entries` rows are never updated or deleted. A balance is the sum of its entries. A correction is a new compensating entry, never an edit.

Flow: the rider pays the driver directly (cash or MoMo peer-to-peer). On trip completion the platform debits commission from the driver's wallet. The platform never holds customer funds — which is precisely why this model requires no BNR payment licence to operate.

A driver whose balance falls below a configured minimum cannot go online until they top up. Top-up runs through a `PaymentProvider` interface with a mock implementation at MVP; MTN MoMo and Airtel Money implementations drop in behind the same interface without touching ledger code.

### 3.6 Security and RLS

Row-level security on every table. Policies are tested explicitly (see 7.2) because RLS failures are silent and catastrophic.

**Staged contact disclosure.** A driver sees no rider contact detail before accepting. During an active trip both parties get a masked number. Access is revoked at completion. Location history is readable only by its owner and by ops. For moto-taxis carrying lone passengers this is a baseline safety requirement, not a refinement.

### 3.7 Maps and the addressing problem

Google Maps, chosen for Rwandan road coverage, Places, and Directions.

The binding constraint: **most Kigali locations have no usable street address.** Navigation is by landmark ("near Simba Supermarket, Kimironko"). An address-bar-first search UI copied from a Western ride app fails immediately here.

The destination picker is therefore ordered: recent trips → saved places → **curated Kigali landmark gazetteer** → Google Places autocomplete → pin-drop. Pin-drop always collects a one-line free-text "how to find me" note, displayed prominently to the driver on the pickup screen. This is a small feature with a large effect on pickup failure rates.

**API cost control:** Places Autocomplete session tokens, aggressive geocode caching, Distance Matrix restricted to the top-5 candidate set.

---

## 4. Data model (core tables)

Indicative, not exhaustive. Full DDL lives in `supabase/migrations/`.

| Table | Purpose | Notes |
|---|---|---|
| `profiles` | One row per authenticated user | Phone-based identity, `role` in (rider, driver, ops) |
| `drivers` | Driver-specific record | Verification status, vehicle class, documents |
| `vehicles` | Vehicle registry | Plate, moto vest number, class, active flag |
| `driver_presence` | Live position + status | UPDATE in place, GiST index, heartbeat timestamp |
| `trips` | Trip header | `state` projection, rider, driver, pickup/dropoff geography |
| `trip_events` | Append-only transition log | Source of truth for trip state |
| `trip_offers` | Sequential dispatch offers | Driver, expiry, outcome |
| `trip_track_points` | GPS breadcrumb during trip | Append-only, archived monthly |
| `fare_policies` | Versioned, effective-dated pricing | Never mutated in place |
| `fare_quotes` | Locked upfront quote | 120s validity |
| `ledger_entries` | Append-only double-entry ledger | Commission, top-ups, corrections |
| `saved_places` | Rider home/work/custom | Includes free-text "how to find me" note |
| `landmarks` | Curated Kigali gazetteer | Seeded, ops-editable |

---

## 5. Experience design

### 5.1 Structural idea: one map, one morphing sheet

The rider app is not a stack of screens. It is a persistent map with a single bottom sheet that morphs through trip states — shape, height, and content change; the map never unmounts.

Three consequences, none cosmetic:

- Map context never breaks across the trip.
- Transitions are cheap on low-end Android (no screen remounts).
- Trip states map **one-to-one** onto sheet configurations, making the UI a pure function of server state — exactly what is needed when the network is unreliable.

### 5.2 Rider flow

- **Onboarding is three taps.** Phone → OTP → first name. No email, no password, no account-creation step. Anything more is attrition when the competitor is already installed.
- **Destination picking is landmark-first** (see 3.7).
- **Vehicle selection** shows upfront prices as cards, not a carousel. Price in display numerals, ETA secondary. **Moto is listed first and is the default** — it is the dominant mode in Kigali, and ordering it second would import a Western assumption.
- **Matching shows honest progress** — "Asking Eric, 800m away" — not an indeterminate spinner. Riders tolerate waiting; they do not tolerate not knowing.
- **In-trip surfaces three things** and hides everything else: driver identity (photo, name, plate, **moto vest number** — how Rwandans actually identify a moto), live ETA, and **Share trip**, which sends a live-tracking link over WhatsApp specifically.
- **Completion:** itemised fare, payment method confirmation (cash / MoMo), rating with a one-tap 5-star default and optional tags. No forced review.

### 5.3 Driver flow (flagship)

Design constraint: a driver looks at the phone for **under two seconds at a time**, often while moving, usually in direct sunlight, sometimes wearing gloves. Every decision below follows from that.

- **The offer card is full-screen** — not a banner or a sheet. Countdown ring, pickup distance, estimated fare, destination neighbourhood. Legible at arm's length. Accept is a large target in the bottom third; decline is smaller and further away.
- **Irreversible actions are slide-to-confirm, never tap.** Start trip, end trip, cancel, go offline. A tap target on a moving motorcycle is hit accidentally; a deliberate horizontal slide is not. This single pattern is expected to prevent more support load than any other decision in the app.
- **Go-online is one large toggle** on a home screen showing exactly three numbers: today's earnings, hours online, wallet balance.

**Assist features**

- **Heatmap** — demand zones as a soft amber-to-red overlay, plus an *actionable* card: "Kimironko · 2.4× demand · 6 min away." A heatmap that does not say what to do is decoration.
- **Earnings coaching** — daily goal ring on the home screen; weekly view breaking down **RWF per online hour**, not just total. Per-hour is the number that changes driver behaviour because it exposes dead time.
- **Safety** — speed badge (neutral / amber over limit / red well over); rest prompt after ~5 continuous hours; SOS as a **long-press**, never a tap, sharing live location with ops and a trusted contact simultaneously.

### 5.4 Design rules for this market

- **Bottom third is sacred.** Every primary action sits within one-handed thumb reach on a 6.7" device.
- **Sunlight contrast.** No thin grey-on-grey anywhere — invisible outdoors near the equator.
- **Numbers are big.** Fares and ETAs get display-size treatment.
- **Data frugality is a feature.** Cached map tiles, no autoplay media, aggressively compressed avatars. Users are on metered bundles; an app with a reputation for eating data gets uninstalled.
- **Every screen has an honest offline state** — "Reconnecting — your trip is safe", never a dead spinner.
- **i18n scaffolded from the first commit.** English and French strings at MVP, Kinyarwanda keys present.

---

## 6. Failure modes and error handling

Ride-hailing fails in specific, well-known ways. Each is designed for, not discovered.

| Failure | Handling |
|---|---|
| Network drops mid-trip | Local SQLite **outbox**: intents written locally first, synced when online, made safe by server-side idempotency keys. Trip state always reconciled *from* the server on reconnect — local state is a cache that loses every argument. |
| **Android battery optimiser kills the driver app** | The classic killer. Foreground service with persistent notification; battery-optimisation exemption requested during onboarding; server-side heartbeat monitoring marks a driver offline after 60s of silence and re-dispatches if the trip has not reached pickup. |
| GPS drift / tunnels / urban canyon | Fixes worse than 50m accuracy discarded; displayed track smoothed and snapped to road; raw fixes retained for fare and disputes. |
| Two drivers accept simultaneously | Impossible by construction — conditional `UPDATE` inside a transaction (3.3). Loser gets a clean "no longer available". |
| Driver accepts then goes inert | Timeout on `accepted` with no movement toward pickup triggers re-dispatch and a driver reliability signal. |
| Rider cancels after driver is en route | Cancellation policy with a grace window; fee beyond it, credited to the driver via the ledger. |
| Fare quote expires before confirmation | Silent re-quote with an explicit "price updated" confirmation. Never charge against a stale quote. |
| Payment dispute (driver says rider did not pay) | Trip flagged, ops resolves, resolution written as a **compensating ledger entry** — never an edit to history. |
| No drivers available | Expanding radius (1→2→4km), then an honest `no_drivers` state with an optional notify-when-available. |
| Clock skew between devices | All authoritative timestamps are server-generated. Client timestamps are advisory only. |

---

## 7. Testing strategy

### 7.1 Unit — `packages/core` (TDD, highest value)

Pure functions, no I/O. Written test-first:

- Every **legal** state transition produces the expected state.
- Every **illegal** transition is rejected (the full negative matrix, not a sample).
- Idempotent replay produces exactly one state change.
- Fare arithmetic: base, per-km, per-minute, tolerance overage, rounding to RWF.
- Commission arithmetic and ledger balance derivation.

### 7.2 Database — pgTAP for RLS

RLS bugs are silent and catastrophic: one wrong policy exposes every trip to every user. Each policy gets an explicit adversarial test:

- Rider A cannot `SELECT` rider B's trips.
- A driver cannot read a trip they were never offered.
- A driver cannot read rider contact details before `accepted` or after `completed`.
- No client role can `INSERT` or `UPDATE` `ledger_entries` directly.
- No client role can write `trips.state` directly, bypassing `trip_transition()`.

### 7.3 Integration — Edge Functions

Run against a local Supabase instance: quote, dispatch, transition, wallet — including the concurrency case (N simultaneous accepts on one offer).

### 7.4 Simulation harness

A script spawning N virtual drivers moving along real Kigali road geometry plus M riders requesting trips on realistic patterns. This is the only practical way to exercise matching, dispatch timing, and the location firehose before real drivers exist — and it doubles as the demo environment. High value; built early, in Phase 2.

### 7.5 End-to-end

Maestro flows covering the critical rider path (request → ride → pay → rate) and the critical driver path (online → offer → accept → navigate → complete).

---

## 8. Build order

| Phase | Deliverable | Exit criterion |
|---|---|---|
| **0** | Monorepo, design system, Supabase project, schema + RLS + pgTAP | RLS suite green; design tokens rendering in both apps |
| **1** | Phone/OTP auth, profiles, driver onboarding and verification | A driver can register and reach `verified` |
| **2** | **Core trip loop spine** — quote, request, dispatch, accept, track, complete — against the simulation harness | A simulated trip completes end-to-end with a correct ledger entry |
| **3** | Real GPS: background location, foreground service, turn-by-turn navigation | A real device completes a real trip on real roads |
| **4** | Wallet, commission, top-up via mocked `PaymentProvider` | Balance blocks go-online below the minimum; ledger reconciles |
| **5** | Assist features: heatmap, earnings coaching, safety | All three usable on a real device |
| **6** | Offline hardening, i18n, polish, data frugality pass | Trip survives a forced 2-minute network loss with no state loss |

Phase 2 is the spine: everything before it is scaffolding, everything after it hangs off it.

---

## 9. Open items

1. **Trademark.** Formal RDB search for "Gera" before any public use. Blocking for launch, not for build.
2. **Commission rate.** Placeholder 15%; needs a competitive check against Yego and Bolt driver economics before launch.
3. **Fare rates.** Base / per-km / per-minute for moto and cab need real market calibration. Configurable from day one, so this does not block Phase 2.
4. **MoMo credentials.** MTN and Airtel API access and the licensing question for any future platform-held model. Deferred behind `PaymentProvider`; does not block MVP.
5. **Landmark gazetteer.** Needs sourcing and seeding for Kigali. Can start small (~200 landmarks) and grow from rider pin-drops.
