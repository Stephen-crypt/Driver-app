# Running the rider side

Everything you need to take a rider from "downloaded the app" to "carrying passengers", and what it costs you when you get it wrong.

Read this before you sign up your first rider. The technical steps take ten minutes; the decisions around them are the business.

---

## 1. What a rider must have before you touch the app

None of this is Gera's rule. It is Rwandan law, and the liability lands on you as the operator, not on the rider.

| Requirement | Where it comes from | Notes |
|---|---|---|
| Valid driving licence, correct category | Rwanda National Police | Category A for moto, B for cab. Check the category, not just that a licence exists. |
| Vehicle registration (*carte jaune*) | RRA | Must name the rider, or you need written authority from the owner. |
| Third-party insurance, in date | Any licensed insurer | **Check the expiry.** An expired policy is the single most common real-world failure, and it is the one that ends the business if there is a crash. |
| Vehicle inspection certificate | RURA-approved centre | Annual for commercial use. |
| National ID | — | Confirms the licence belongs to the person in front of you. |
| Moto only: helmet for the passenger | RURA | Two helmets, both usable. Passengers notice. |

**Verify these against the physical documents, in person, at least once.** The app collects photographs. A photograph proves a document exists; it does not prove it is current, or that it belongs to the person holding the phone.

---

## 2. Approving a rider

There is no admin web app. Approvals run through a command-line tool that talks to the database as `service_role`. That is deliberate: an admin screen reachable with an ordinary user login is a much larger risk than the inconvenience of a terminal.

```bash
# Who is waiting
pnpm review queue

# One rider in full, with every document and its state
pnpm review show <rider-id>
```

`show` prints the storage path of each upload. To actually look at one:

```bash
supabase storage download ss:///rider-documents/<rider-id>/driving_licence.jpg ./licence.jpg
```

Then decide, one document at a time:

```bash
pnpm review doc <rider-id> driving_licence approve
pnpm review doc <rider-id> insurance reject "Policy expired 12 Aug. Upload the renewal."
```

A rejection **requires** a reason, and the rider sees exactly what you type. Write what they should do differently. "Rejected" on its own means they re-upload the same photograph and you both waste a day.

Finally:

```bash
pnpm review verify <rider-id>
```

This refuses unless all four documents are approved. The check lives in the database, not in the tool, so it cannot be skipped by a reviewer working quickly.

### Suspending someone

```bash
pnpm review suspend <rider-id> "Complaint under investigation"
```

Takes effect immediately — it flips their verification *and* forces them offline, rather than waiting for their heartbeat to lapse. A rider who must stop driving must stop now.

---

## 3. The wallet — this is your revenue, and it is manual

Gera never touches the fare. The passenger pays the rider in cash, in full. Your commission is debited from a **prepaid wallet** the rider tops up.

This means: **a rider with an empty wallet cannot go online.** Verified is not enough.

```bash
pnpm review credit <rider-id> 5000 "MoMo ref 884213"
pnpm review balance <rider-id>
```

The reference is required. It should be something that proves the money arrived — a MoMo transaction id, a receipt number. An unreferenced credit is indistinguishable from an invented one, and when a rider disputes their balance six weeks later that reference is the entire argument.

**Today the flow is:**

1. Rider sends mobile money to your business number, or hands over cash
2. You confirm it arrived
3. You run `credit` with the transaction reference
4. Their wallet updates and they can go online

That is fine for ten riders and impossible at a hundred. Connecting MTN MoMo Collections or an aggregator (Paypack, Flutterwave, Kpay) turns step 2–3 into a webhook calling the same function. Nothing else changes — `credit_rider_wallet` is already the single entry point for money in.

### Setting the float

Two numbers in `platform_settings` govern this:

- **Minimum balance to go online** — set it to roughly three trips' commission. Too low and riders go negative mid-shift; too high and you are asking for a deposit before they have earned anything.
- **Commission percentage** — currently 15%.

On a 1,700 RWF moto trip the commission is 255 RWF. A 5,000 RWF float covers about nineteen trips, which is most of a day.

---

## 4. Recruiting

Order matters. Riders before passengers, always — a passenger who opens the app and sees "no riders nearby" does not come back, and you only get one first impression per person.

**Start in one sector.** Kimironko, Remera or Nyabugogo. Twenty riders covering one area beats sixty spread across Kigali, because coverage is about density, not headcount. A passenger waits four minutes or they walk to the taxi park.

**Where riders already are:** moto stages, taxi parks, existing rider WhatsApp groups. Riders talk to each other far more than passengers do — the first ten you treat well are your recruitment channel for the next hundred.

**What they will ask, in this order:**

1. *How much do I keep?* — All the cash. Commission comes from the wallet.
2. *When do I get paid?* — Immediately. The passenger hands it to you.
3. *What does it cost me?* — 15%, taken after each trip from a wallet you top up.
4. *What if there are no trips?* — Be honest. Early on there will be quiet hours.

That third answer is why the wallet model is worth the operational overhead: a rider who has already paid their commission is not deciding whether to hand you money at the end of a good day.

---

## 5. Day one checklist

- [ ] Company registered with RDB, TIN issued
- [ ] **RURA operator licence applied for** — start now, it is the long pole
- [ ] Registered as a data controller with NCSA (Law N° 058/2021 — you store phone numbers and live GPS, it applies)
- [ ] Business insurance
- [ ] Mobile money business number for wallet top-ups
- [ ] Pindo account funded, `Gera` sender ID registered
- [ ] Someone named as the person who answers the safety line (see below)
- [ ] 15–20 verified, funded riders in **one** sector
- [ ] You have personally taken five trips end to end

---

## 6. The gap you must close before real passengers

**Nobody answers the SOS button.**

The app records an alert with the trip and exact position, and puts the user one tap from 112. That is honest, and it is not enough. An alert is worth exactly as much as the person who answers it.

Before a single passenger who is not your friend uses this:

- A phone that is answered, with a named person on it during operating hours
- A written procedure for what that person does when an alert fires
- Someone watching `sos_alerts` — every row is a person who pressed a button because they were frightened

```sql
select a.created_at, a.source, p.first_name, p.phone, a.trip_id,
       st_y(a.position::geometry) as lat, st_x(a.position::geometry) as lng
  from sos_alerts a
  join profiles p on p.id = a.raised_by
 where a.acknowledged_at is null
 order by a.created_at desc;
```

Run it. Every day. Until it is somebody's actual job.

---

## Command reference

```
pnpm review queue                                 everyone waiting
pnpm review show <rider-id>                      one rider in full
pnpm review doc <rider-id> <kind> approve        approve a document
pnpm review doc <rider-id> <kind> reject "<why>" reject, with a reason they see
pnpm review verify <rider-id>                    verify (needs all four approved)
pnpm review suspend <rider-id> "<reason>"        stop them driving, now
pnpm review credit <rider-id> <rwf> "<ref>"      top up their wallet
pnpm review balance <rider-id>                   what they have left
```

Kinds: `national_id`, `driving_licence`, `vehicle_registration`, `insurance`

Against the cloud rather than your laptop:

```bash
GERA_DB_URL="postgresql://postgres.<ref>:<password>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres" \
  pnpm review queue
```
