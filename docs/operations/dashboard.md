# The staff dashboard

`apps/dashboard` is the web app for the people who run Gera: the control room, operations, the fleet, finance, safety and support. It is where an emergency alert lands, where riders are approved and given a vehicle, and where cash is recorded.

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
pnpm staff add ange@gera.rw admin "Ange"          # prints a password once
pnpm staff add claudine@gera.rw control_room "Claudine"
pnpm staff role claudine@gera.rw safety
pnpm staff disable claudine@gera.rw               # takes effect on their next click
pnpm staff list
```

Against the cloud project, set `GERA_API_URL`, `GERA_SERVICE_KEY` and `GERA_DB_URL` first.

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
