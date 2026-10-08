# Promo codes — design

Date: 2026-10-08. Status: approved in conversation, awaiting review of this document.

## 1. Intent

**What the owner said:** passengers should be able to make a ride cheaper with a promo
code, and staff need somewhere to create codes. How codes will be used (launch
marketing, apologies, partners) is not decided, so the feature should be simple and
flexible. Nova covers the discount.

**Assumptions the owner accepted:** codes are created in the staff dashboard;
passengers still pay cash; the rider collects the lower amount and is never out of
pocket; the passenger sees the discounted price before booking; every check happens
on the server.

**Done looks like:** a code is created in the dashboard, a passenger adds it, their
next eligible ride shows the lower price, the rider collects the lower amount while
earning on the full fare, and the dashboard shows each code's uses and cost.

## 2. How the money works

The fleet ledger (0034/0035) already separates two things per trip:
`fare_collected` (company cash the rider now holds) and `trip_earning` (what the
rider is owed). A promo changes only the first.

- The discount applies to the **ride fare**, never to the waiting charge, and never
  takes the fare below 0 (a 100% code makes the fare free; waiting is still paid).
- At completion, with `fare` the final fare and `wait` the waiting charge:
  - `discount = promo_discount_rwf(code, fare)` — the code's rules applied to the
    final fare (a fixed amount stays fixed, a percentage stays a percentage, the cap
    still applies);
  - `trip_earning` is computed on `fare + wait`, exactly as without a promo;
  - `fare_collected = fare + wait − discount` — the cash actually taken.
- Nova simply receives less cash. No extra ledger kind, no payout.
- Each trip records `promo_id` and `promo_discount_rwf`, so the cost of every code
  is a sum over its trips.

## 3. Data

New enum `promo_kind`: `amount` | `percent`.

`promo_codes`
| column | notes |
|---|---|
| `id uuid` pk | |
| `code text` unique | stored normalised: upper case, no spaces, `[A-Z0-9-]`, 4–20 chars |
| `kind promo_kind` | |
| `amount_rwf int` | for `amount`; > 0 |
| `percent int` | for `percent`; 1–100 |
| `max_discount_rwf int` null | optional cap for `percent` |
| `min_fare_rwf int` null | optional |
| `vehicle_classes vehicle_class[]` null | null = all classes |
| `per_passenger_limit int` default 1 | ≥ 1 |
| `total_limit int` null | null = no limit |
| `starts_at timestamptz` default now() | |
| `ends_at timestamptz` null | |
| `paused boolean` default false | |
| `note text` null | staff only; passengers never see it |
| `batch_id uuid` null | codes made together |
| `created_by uuid`, `created_at` | |

A check constraint keeps the kind and its fields consistent.

`passenger_promos` — codes a passenger has added: `(passenger_id, promo_id)` primary
key, `added_at`.

`promo_attempts` — `(passenger_id, at, ok)` for the lock-out: more than 10 failed
adds in an hour refuses further tries for that hour.

`fare_quotes` gains `promo_id`, `promo_discount_rwf` (the estimate shown).
`trips` gains `promo_id`, `promo_discount_rwf` (estimate at booking, final at
completion).

**A use** is a trip with that `promo_id` in state `requested`, `offered`,
`accepted`, `arrived`, `in_progress`, `completed` or `scheduled` (a ride booked
ahead holds its use). `cancelled_by_passenger`, `cancelled_by_rider`, `no_riders`,
`no_show`, `skipped` and `expired` give it back. Uses are counted, never stored as
a counter, so this happens by construction.

RLS: `promo_codes` and `promo_attempts` are not readable by clients at all.
`passenger_promos` is readable by its owner. All writes go through functions.

## 4. Server functions

Pure and shared:
- `promo_discount_rwf(code promo_codes, fare int) → int` — the arithmetic; never
  more than `fare`, never negative.
- `promo_problem(code, passenger, class, fare) → text|null` — null when the code can
  be used; otherwise one of `paused`, `not_started`, `ended`, `used_up`,
  `already_used`, `min_fare`, `vehicle`.

Passenger (signed in):
- `add_promo_code(p_code text)` — normalises, applies the lock-out, refuses with
  `promo_not_found` / `promo_ended` / `promo_used_up` / `promo_already_used` /
  `too_many_tries`, else saves to `passenger_promos` and returns the code summary.
- `my_promos()` — the passenger's codes with discount, uses left, end date and
  status (`ready`, `used`, `ended`, `paused`).

Quoting (`quote` edge function):
- Request takes an optional `promo`: a promo id, `"none"`, or `"best"` (default).
- `"best"` picks, among the passenger's saved codes with no problem for this class
  and fare, the one with the largest discount.
- The quote row stores `promo_id` and `promo_discount_rwf`; the response adds
  `promo: { id, code, discountRwf } | null` and `payRwf`.

Booking:
- `create_trip_from_quote` and `schedule_trip_from_quote` copy `promo_id` and the
  estimated discount from the quote to the trip after re-running `promo_problem`. If
  it now has a problem they raise `promo_unavailable` and nothing is booked.
- Regular (recurring) trips never carry a promo in this version.

Completion: `complete_trip` computes the final discount as in §2, writes
`trips.promo_discount_rwf`, records `fare_collected` net of it, keeps
`trip_earning` on the full total, and adds `promo_discount_rwf` and `paid_rwf` to
the completion event's meta. The `complete-trip` function's receipt shows the promo
line and what was paid.

Staff (roles: `admin`, `operations` create and pause; `finance` reads):
- `staff_create_promo(...)` — one code, typed or generated (`NV-` plus 4
  unambiguous characters when none is given).
- `staff_create_promo_batch(count, ...)` — up to 200 single-use codes with the
  same rules; returns them.
- `staff_set_promo_paused(id, paused)`.
- `staff_promos()` — every code with uses, limit, cost so far and status.
- `staff_promo_trips(id)` — trips that used a code: when, first name, last phone
  digits, discount.
- Creates and pauses write to the audit log.

Paused codes stop new bookings immediately; trips already booked keep their
discount. A code that ends during a trip still applies to it.

## 5. Dashboard

A **Promotions** page under "Money and records".
- List: code, discount ("500 RWF off" / "30% off, up to 1,000"), uses as
  "23 / 100", cost so far, end date, status (Active, Paused, Used up, Ended);
  pause/resume; no delete.
- **New code** form: code (type or Generate), discount kind and value, cap, uses
  per person (default 1), total uses, start and end, minimum fare, vehicle types,
  private note.
- **Make a batch**: count plus the same rules; shows the codes with **Copy all**.
- A code's page lists the trips that used it.

## 6. Passenger app

- **Account → Promotions**: a code field and **Add**; success says what the code
  gives ("NOVA50 added: 500 RWF off your next ride"); failure says why in plain
  words. Saved codes list discount, uses left and end date; used and ended codes
  sit in a faded "Used" section.
- **Ride options sheet**: a **Promo** line above Cash. With an eligible code it is
  on by default and shows "NOVA50 · 500 RWF off"; each vehicle shows the old price
  struck through and the new one; the Book button carries the new price. Tapping the
  line lets the passenger pick another code, turn promos off for this ride, or add a
  code. With no eligible code it reads **Add a promo code**, or names why a saved
  code does not fit ("Moto only").
- If booking fails with `promo_unavailable`, the sheet says "That code has just run
  out" and re-quotes without it.
- Receipt and trip history show the fare, "Promo NOVA50 −500" and **You paid**.

## 7. Rider app

- Trip panel: "To collect at the end" shows the discounted amount with "Promo
  applied: Nova covers 500".
- Completion receipt: the amount to collect is net of the promo; the earning line
  is unchanged.

## 8. Rules in short

One code per ride; codes do not stack. Codes are case-insensitive and ignore spaces.
Shared codes can be added by anyone, within their limits; a code counts against a
passenger once added. Codes can be added from the account screen or from the ride
sheet.

## 9. Testing

- pgTAP: discount arithmetic (fixed, percent, cap, never below zero, waiting charge
  untouched); every `promo_problem` reason; uses returned on cancellation and no
  riders; per-person and total limits; the lock-out; `create_trip_from_quote`
  refusing a code that ran out; `complete_trip` keeping `trip_earning` on the full
  total while `fare_collected` is net; staff functions' role checks; RLS on all three
  tables.
- Deno: the quote function's `promo` handling ("best", a chosen id, "none").
- Vitest: data-layer calls and mapping of error codes to messages.
- Browser run-through of adding a code, booking with it, and the rider's collect
  screen; then a live check with a throwaway passenger, cleaned up after.

## 10. Rollout

1. Migrations and functions go live first. Existing apps keep working: no promo is
   ever applied unless a passenger adds one, which they cannot do until the new
   app.
2. Dashboard Promotions page.
3. Passenger and rider APKs, version 4.

## 11. Not in this version

Automatic offers with no code (first-ride discounts), promos on regular trips,
stacking, referral codes, per-code budgets in RWF, and editing a code's rules after
creation (pause it and make a new one).
