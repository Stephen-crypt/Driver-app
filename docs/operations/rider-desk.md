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

## 3. The money — two numbers, never one

This is the part most worth reading twice, because netting the two is how cash fleets lose money quietly.

A passenger pays the rider in cash. The company owns the vehicle. So at the end of every trip **two** things are true at once:

| | What it is | What you do about it |
|---|---|---|
| **Carrying** | Company cash in the rider's pocket. Fares collected minus what they've handed in. | Chase it. This is exposure. |
| **Owed** | What you owe the rider. Earnings and bonuses minus deductions and payouts. | Pay it. This is a liability. |

A rider carrying 50,000 RWF who has earned 20,000 nets to −30,000. That number is arithmetically true and operationally useless: what decides whether they work tomorrow is the **50,000 in their pocket**, not the net.

```bash
pnpm review money <rider-id>
#   carrying (ours):  2,400 RWF
#   owed (theirs):    2,390 RWF
```

### Recording cash coming in

```bash
pnpm review remit <rider-id> 5000 "MoMo ref 884213"
```

The reference is required, and it must prove the money arrived — a MoMo transaction id, a receipt number. An unreferenced remittance is indistinguishable from an invented one, and when a rider disputes their position six weeks later that reference is the entire argument.

Remitting reduces what they're carrying. It does **not** change what you owe them. That's the point.

### Paying riders

```bash
pnpm review pay <rider-id> 12000 "Week 40 payout"
pnpm review bonus <rider-id> 500 "Weekend cover"
pnpm review deduct <rider-id> 2000 "Damaged mirror"
```

A deduction needs a reason and the rider is shown it. A deduction nobody can explain is a dispute waiting.

### The cash ceiling

A rider carrying more than `platform_settings.max_cash_held_rwf` (default 50,000) **cannot go online**. They must remit first.

This is your real control on cash. Without it, exposure grows quietly with every shift and the first anyone notices is when somebody stops answering their phone.

A rider already online who goes over the ceiling mid-shift — because their own completed fare pushed them over — is **not** frozen. They can still report position and go offline; they simply can't start a new shift until they've remitted. That escape hatch is deliberate and there's a test pinning it: without it, a passenger watching their moto approach would see it stop dead.

### What the rider earns

The rider's share is the remainder after commission, taken from `fare_policies.commission_pct` for their vehicle class. At the default 15%, a 1,700 RWF trip splits 255 to the company and 1,445 to the rider.

**Change that number.** 15% was a marketplace rate, where the rider owned the vehicle and paid fuel. In a fleet you own both, so the company's share should be considerably higher:

```sql
insert into fare_policies (vehicle_class, base_rwf, per_km_rwf, per_minute_rwf,
                           minimum_rwf, commission_pct, effective_from)
values ('moto', 500, 900, 22, 800, 40.00, now());
```

Rates are versioned by `effective_from`, so a trip already quoted settles at the rate it was quoted under. Raising the rate never reaches a trip in flight.

### Going online

Two conditions, and telling a rider the wrong one wastes their day:

1. **A vehicle assigned** — the company owns it, so no vehicle means not working today
2. **Under the cash ceiling**

`pnpm review verify` tells you which one is missing.

## 4. Recruiting

Order matters. Riders before passengers, always — a passenger who opens the app and sees "no riders nearby" does not come back, and you only get one first impression per person.

**Start in one sector.** Kimironko, Remera or Nyabugogo. Twenty riders covering one area beats sixty spread across Kigali, because coverage is about density, not headcount. A passenger waits four minutes or they walk to the taxi park.

**Where riders already are:** moto stages, taxi parks, existing rider WhatsApp groups. Riders talk to each other far more than passengers do — the first ten you treat well are your recruitment channel for the next hundred.

**What they will ask, in this order:**

1. *How much do I earn?* — Your share of every completed fare, set per vehicle class.
2. *When do I get paid?* — On the payout schedule you set. Say a real one and keep it.
3. *What do I have to hand in?* — All the cash you collect. Your earnings are paid separately.
4. *Whose vehicle is it?* — The company's. You don't pay for it, and you don't own it.
5. *What if there are no trips?* — Be honest. Early on there will be quiet hours.

Answer three carefully. A rider who thinks the cash in their pocket is theirs will spend it, and then you are having a very different conversation.

---

## 5. Day one checklist

- [ ] Company registered with RDB, TIN issued
- [ ] **RURA operator licence applied for** — start now, it is the long pole
- [ ] Registered as a data controller with NCSA (Law N° 058/2021 — you store phone numbers and live GPS, it applies)
- [ ] Business insurance
- [ ] Mobile money business number for riders to remit cash to
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
pnpm review show <rider-id>                       one rider in full
pnpm review doc <rider-id> <kind> approve         approve a document
pnpm review doc <rider-id> <kind> reject "<why>"  reject, with a reason they see
pnpm review verify <rider-id>                     verify (needs all four approved)
pnpm review suspend <rider-id> "<reason>"         stop them driving, now

pnpm review money <rider-id>                      what they carry, what we owe
pnpm review remit <rider-id> <rwf> "<ref>"        cash they handed in
pnpm review pay <rider-id> <rwf> "<ref>"          pay what they are owed
pnpm review bonus <rider-id> <rwf> "<why>"        add a bonus
pnpm review deduct <rider-id> <rwf> "<why>"       take a deduction
```

Kinds: `national_id`, `driving_licence`, `vehicle_registration`, `insurance`

Against the cloud rather than your laptop:

```bash
GERA_DB_URL="postgresql://postgres.<ref>:<password>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres" \
  pnpm review queue
```
