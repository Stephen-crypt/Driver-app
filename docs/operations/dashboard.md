# The staff dashboard

`apps/dashboard` is the web app for the people who run Nova: the control room, operations, the fleet, finance, safety and support. It is where an emergency alert lands, where riders are approved and given a vehicle, and where cash is recorded.

## Running it

```bash
cd apps/dashboard
cp .env.example .env        # then fill in the two values
pnpm dev                    # http://localhost:5173
```

`.env` needs the project URL and the **anon** key — the same public values the apps use. The dashboard never holds the service key; everything it can do, it does as the signed-in staff member.

To deploy, `pnpm build` produces a static site in `dist/` that any static host serves (Netlify, Vercel, Cloudflare Pages, or a Supabase Storage bucket).

## Giving someone access

Staff roles can only be granted from the command line, with the service key. There is no way to do it from the dashboard or the apps, by design.

```bash
pnpm staff add ange@nova.rw admin "Ange"          # prints a password once
pnpm staff add claudine@nova.rw control_room "Claudine"
pnpm staff add innocent@nova.rw inspector "Innocent"   # works in the Nova Rider app
pnpm staff role claudine@nova.rw safety
pnpm staff disable claudine@nova.rw               # takes effect on their next click
pnpm staff list
```

Against the cloud project, set `NOVA_API_URL`, `NOVA_SERVICE_KEY` and `NOVA_DB_URL` first.

## Who can do what

| | Control room | Operations | Fleet | Finance | Safety | Support |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| See the live map and trips | ✓ | ✓ | | | ✓ | trips only |
| Take and close emergency alerts | ✓ | ✓ | | | ✓ | |
| Review documents, verify riders | | ✓ | ✓ | | ✓ | |
| Suspend a rider | | ✓ | | | ✓ | |
| Add vehicles | | | ✓ | | | |
| Assign and return vehicles | | ✓ | ✓ | | | |
| Record cash handed in | | ✓ | | ✓ | | |
| Pay riders, bonuses, deductions | | | | ✓ | | |
| Search people and trips | ✓ | ✓ | | ✓ | ✓ | ✓ |
| Work cases: take, note, resolve | ✓ | ✓ | read | | ✓ | ✓ |
| Log a phone call as a case | ✓ | ✓ | | | ✓ | ✓ |
| Plan riders for regular trips | ✓ | ✓ | | | | |
| Draw and change zones | read | ✓ | read | | ✓ | |
| Change prices | | read | | ✓ | | |
| Waiting, PIN attempts, booking-ahead settings | | ✓ | | read | read | |
| Cash limit, waiting charge | | read | | ✓ | read | |
| Ride PIN on/off, speed alert limit | | read | | read | ✓ | |
| Reports | | ✓ | | ✓ | ✓ | |
| Audit log | | ✓ | | ✓ | ✓ | |

`admin` can do all of it. These rules live in the database — every read and every action is a function that checks the caller's role before it does anything. Hiding a button in the dashboard is a convenience, not the protection.

## The control room

- **Emergency alerts** arrive within a second, with a chime, a red count on every page, and the tab title flashing. Each shows who raised it and their phone, where they were, the trip, the rider, the plate and the vest number.
- **I'm on it** marks the alert as yours, so a second operator does not also start calling.
- **Resolve** needs a written account — what happened and what was done. It goes on the record and in the audit log.
- **Needs attention** lists passengers who have waited more than 90 seconds for a rider, and booked rides inside 30 minutes of pickup that nobody has yet.
- On the map, riders are their vest patches: **blue** available, **green** on a trip, **grey** on shift but their phone has stopped reporting.

## The audit log

Every action taken from the dashboard or the staff script is recorded with who took it, when, and the details. Nothing can edit or delete it.

## Cases

Anything that happened and needs someone to own it: an incident, a complaint, lost property, a vehicle fault.

- **Passengers** report from a past trip in Activity (*I left something behind*, *Report a problem*) or from Account → Your reports. The trip - and so the rider and the vehicle - is attached for them.
- **Riders' reports** from the rider app become cases automatically.
- **Log a call** turns a phone call into a case, owned by whoever took the call.
- Every case has a number people can read down the phone. Open incidents are marked red at the top of the queue.
- **Notes** are for staff only. The **resolution** is written to the person who reported it: they see it in the app and get a notification.

## Prices and settings

A price change is a new price, never an edit: it applies to trips quoted after it starts, and every trip already quoted keeps the price its passenger saw. A price can start now or at a set time, never in the past. Before saving, the page shows what three ordinary trips cost now and after the change, and what the rider earns from each.

Operating settings (free waiting time, the cash limit, the ride PIN, the speed alert and the booking-ahead limits) each belong to one desk, and each change goes in the audit log.

## Speed alerts

While a trip is live, the server works out speed from the rider's GPS, using points at least ten seconds apart and only fixes the phone reports as accurate to 40 m. A trip faster than the speed limit set on the settings page (60 km/h to start with) shows up in the control room's *Last 12 hours* rail, at most once every five minutes per trip. An alert is for review: mark it reviewed with a note. Nothing is sent to the rider automatically.

## Zones and route alerts

**Zones** are drawn on the map on the Zones page: click each corner, name it, pick a kind. Each kind comes with sensible alerts that you can change:

| Kind | For | Alerts by default |
|---|---|---|
| Restricted | Closed roads, road works, secure sites | when a rider goes in |
| Service area | Where Nova operates | when a rider leaves |
| Operating | A team's or shift's area | when a rider leaves |
| Parking, Pickup | Waiting areas, marked pickup points | none |

Alerts come from any rider on shift, whether or not they're on a trip. Riding along an edge raises at most one alert per rider, zone and direction every ten minutes. Rough GPS fixes (worse than 50 m) are ignored. A zone that's no longer needed is switched off rather than deleted, so its past alerts still make sense.

**Route alerts** appear during a trip in two cases:
- **Moving away from the drop-off:** the rider is now well over the margin further from the drop-off than the closest they've been.
- **Long detour:** they've travelled more than one and a half times the quoted distance, plus the margin.

The margin is 1,500 m to start with (Prices & settings → Route alert margin). A block the wrong way round a one-way system never trips it. Like speed alerts, these are for someone to look at and mark reviewed; nothing happens to the rider automatically.

## Inspections

Inspectors work from the **Nova Rider app**: on its first screen, tap **Staff sign in** and use the email and password from the staff script. An inspector account opens straight onto the inspection screens. It has nothing to open on this dashboard.

- **Finding who to check:** scan the QR on the rider's phone (Me → My QR code) or the sticker on the vehicle, or type a vest number or plate.
- **The check:** identity, documents, vest and helmets, then brakes, lights, tyres, mirrors, bodywork and safety kit. An optional alcohol test records negative, positive (with the reading) or refused, plus the device. Add photos and notes.
- **The result:** pass, advisory or fail. A pass can't be recorded over a failed item or a positive or refused test.
- **What happens next:** a failed inspection, or a positive or refused alcohol test, opens a case for the safety desk. Nothing is done to the rider automatically (NOVA §48). A person reviews the case and decides.
- **Where results show:** inspections appear on the rider's page, with photos, and the rider can see what was recorded about them. Every lookup is in the audit log.

**Vehicle stickers:** on the Fleet page, **Sticker** opens a print-sized sticker with the QR, plate and vest number. **Replace** prints one with a new code and retires the old one. Use it when a sticker is lost or might have been copied.

## Regular trips

Passengers change their own regular trips in the app: they can move one ride to another time that day, or change the days, time and end date from now on. A ride they moved by hand keeps its time when the schedule changes. Prices don't change.

On the **Regular trips** page, operations plans who takes each one:

- **Primary rider:** planned for every ride, and the passenger sees their name ("Aline planned"). Changing the primary sends the passenger one notification.
- **Preferred** and **backup:** offered the ride next, in that order.
- **One ride:** under *Next rides*, hand a single ride to someone else, or to *Nearest available*. The passenger is notified, and that ride keeps its rider when the primary changes later.

This is a plan, not a promise (NOVA §13):

- When a ride is released, dispatch offers it to the planned riders first, if they're online, on shift and free, in the order above.
- If they don't take it, it goes to the nearest riders as usual. Planned riders never use up the ordinary search.
- A rider only takes a ride by accepting the offer. Riders see the rides planned for them under Trips → *Planned for you*.
- A ride that's already looking for a rider can't be moved by the passenger. A ride a rider has accepted can't be reassigned; cancel it instead.
