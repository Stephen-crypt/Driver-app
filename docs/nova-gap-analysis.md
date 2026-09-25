# Gera as built vs the NOVA specification

An honest map of what exists, what carries over, what has to change, and the four decisions that change everything downstream.

---

## The headline

Roughly **a quarter** of NOVA is built, but it is the quarter that is hardest to get right and most expensive to get wrong: the trip state machine, dispatch, money integrity, RLS, live tracking. The remaining three quarters is mostly breadth — more screens, more tables, more roles — which is slower but far less dangerous.

Two things in the spec are not additions. They change what the product *is*, and no amount of building on top fixes a wrong answer.

---

## 1. The terminology is inverted, and it is dangerous

In NOVA, **"Rider" means the driver**. The customer is the **"Passenger"**.

In this codebase, **"rider" means the passenger**, everywhere:

| Where | Current meaning | NOVA meaning |
|---|---|---|
| `trips.rider_id` | the passenger | — |
| `user_role` enum: `rider` | the passenger | the driver |
| `cancelled_by_rider` | passenger cancelled | *would read as* driver cancelled |
| `saved_places.rider_id` | the passenger | — |
| `trip_ratings.rider_id` | the passenger | — |
| RLS policies, ~30 of them | passenger | — |
| `apps/rider/` | the passenger app | *would read as* the driver app |

This is not a cosmetic rename. `cancelled_by_rider` is a value in a state machine with a transition table, an actor check, and pgTAP tests asserting who may fire it. A **half-finished** rename is far worse than either extreme: it produces code where `rider` means the passenger in one file and the driver in the next, and the first bug it causes will be a driver cancelling as a passenger, or an RLS policy handing the wrong person someone's location.

If we adopt NOVA's vocabulary it has to be done in one atomic pass, with the tests as the net, and nothing else changing in the same commit.

**My recommendation:** adopt it. Fighting the spec's vocabulary means every conversation with you, any future developer, and the operations staff carries a translation step. But do it as a single mechanical migration, verified by the full suite, before any new feature lands on top.

---

## 2. Fleet or marketplace? This changes the money

This is the one I most need you to answer, because the two readings produce different products.

**What Gera is built as — a marketplace:**
- Drivers own their vehicles
- They collect cash from the passenger and keep all of it
- Commission is debited from a prepaid wallet the driver tops up
- No shifts; drivers go online when they want
- `ledger_entries`, `driver_balance()`, `can_go_online()` all exist to serve this

**What NOVA describes — a fleet:**
- §33–39: company vehicles, assignments, **handover between riders**, maintenance records, battery swaps
- §25: **start shift / end shift**, alcohol test at shift start, vehicle condition at shift end
- §28, §84: rider earnings with **bonuses, deductions, adjustments, payment status** — that is payroll, not commission
- §30: **inspectors** who scan a rider's QR and check the vehicle
- §13: **primary, preferred and backup riders** assigned by operations

Vehicle handover, shift alcohol tests and backup-rider assignment only make sense if the company owns the vehicles and schedules the people. That is Move's model, not Uber's.

**If NOVA is right, the wallet model is wrong.** `ledger_entries`, `driver_balance`, `can_go_online`, the balance gate in dispatch and the whole driver-desk top-up flow serve a business you would not be running. They would be replaced by an earnings ledger that pays *out*, not a float that gets debited.

I can build either. I cannot build both, and building the wrong one wastes more than any other mistake available here.

---

## 3. One app or two?

NOVA §2: one React Native app; the role is read after login and the right interface is shown. Passenger, Rider and Inspector all use it.

We built two apps — separate bundle ids, separate icons, separate stores.

**Honest trade-off:**

*One app*
- Matches the spec
- One build, one release, one QR to scan
- A person who is both a passenger and a driver signs in once
- **Cost:** every passenger downloads the driver and inspector code. Bigger bundle, and a passenger's home screen is one bug away from showing a driver's earnings.

*Two apps (current)*
- A driver's app can ask for background location and keep the screen awake; a passenger's should not
- App-store listings speak to one audience each — this matters for driver recruitment
- Smaller downloads on cheap Androids
- **Cost:** two builds, two releases, and it contradicts the spec

The inspector is a third case and genuinely belongs with the driver app or its own — an inspector is staff, not a customer.

**My recommendation:** two apps, with the inspector inside the driver app. But this is your call and the spec disagrees with me, so say the word and I will merge them.

---

## 4. Supabase or Java Spring Boot?

The spec proposes Spring Boot, and explicitly allows alternatives "where there is a strong technical reason".

What the spec actually *requires*, and what we have:

| Spec requirement | Built |
|---|---|
| PostgreSQL | ✅ Postgres 17 + PostGIS |
| REST API | ✅ PostgREST |
| Real time (§98: "WebSockets **or equivalent**") | ✅ Supabase Realtime |
| §5: "the backend must enforce role based permissions" | ✅ RLS — enforced in the database, so it holds even if an app is compromised |
| OTP, sessions, rate limiting (§91) | ✅ GoTrue |

**Rebuilding this in Spring Boot would cost months and lose the strongest property the system has.** Right now authorisation lives in the database: a driver cannot read another driver's wallet even with a valid token and a hand-crafted request, because Postgres refuses. In a Spring Boot service, that same guarantee is a `@PreAuthorize` annotation somebody can forget — and this project has already shipped that exact class of bug four times, caught only because RLS and column grants were there to be probed.

**My recommendation:** keep Supabase, and write the reason into the spec as the agreed stack. The one genuine gap is the **web dashboard**, which is a separate React app either way and does not depend on this choice.

---

## What carries over unchanged

Whatever you decide on 2–4, these keep their value:

- Trip state machine with a transition table and actor checks (§94 ride model, §8 flow)
- Dispatch: radius widening, offer TTL, decline chaining, termination bound (§40)
- Live GPS tracking with ETA (§19, §43)
- Fare configuration in the database, never in the app (§61)
- Cash payment recorded against the trip (§58)
- SOS with position (§21, §52) — alerting staff is what is missing
- Ratings that cannot be inflated by re-rating (§55)
- Driver documents, private bucket, review workflow (§23)
- Push notifications (§56)
- Landmark search — **not in NOVA at all**, and worth keeping; Kigali addresses do not work the way the spec assumes
- 24 pgTAP files / 271 assertions, several pinning real defects that were found by probing the live database

---

## What is missing, by size

**Large (weeks each)**
- Web dashboard — nothing exists; 8 staff-facing sections in §42, §53, §83, §85, §86
- Scheduled + recurring rides with independent occurrences (§9–12, §96) — a second scheduling engine beside dispatch
- Corporate accounts, employees, bookings, billing (§77–82)
- Fleet: vehicles, assignment, handover, maintenance, battery (§33–39)
- Referrals and rewards with an anti-abuse ledger (§64–76)

**Medium (days each)**
- Inspector role, rider/vehicle QR, inspections, alcohol tests (§30–32, §47–50)
- Control room: live map, speed, route deviation, geofencing (§42, §44–46)
- Support tickets, lost and found, refunds (§53, §54, §63)
- Reporting and export (§88)
- Audit log (§89)
- Shifts (§25)
- Kinyarwanda and French (§90)

**Small (hours each)**
- Ride PIN (§18)
- Ride for someone else (§17)
- Emergency and trusted contacts (§6, §21)
- No-show and waiting time (§15, §16)
- Passenger profile management (§6)

---

## What I would do, in order

1. **Answer the four questions below.**
2. Rename to NOVA's vocabulary in one atomic pass, full suite green, nothing else in the commit.
3. Ride PIN, no-show, waiting time, emergency contacts — small, high value, no architectural risk.
4. Scheduled and recurring rides — the largest *passenger-visible* gap, and §7 puts all three booking types on the home screen.
5. Web dashboard, starting with the control room, because §52 says SOS must reach staff and today nobody is watching.
6. Inspector and fleet, or corporate, depending on which the business needs first.

---

## The four questions

1. **Fleet or marketplace?** Company vehicles with shifts and payroll, or independent drivers with a commission wallet? This decides whether `ledger_entries` and the whole top-up flow survive.
2. **Adopt NOVA's vocabulary** — Passenger and Rider, where Rider is the driver?
3. **One app or two?**
4. **Keep Supabase**, or is Spring Boot a hard requirement from someone else?
