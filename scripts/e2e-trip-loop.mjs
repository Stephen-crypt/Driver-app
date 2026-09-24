#!/usr/bin/env node
// Drives a whole trip through the real API surface, the way a device would:
// quote -> create -> assign -> accept -> arrive -> start -> complete, then a
// replayed completion to prove the ledger stays append-once. This is the only
// thing that exercises PostgREST, RLS-as-a-real-JWT and the Edge Functions
// together - unit tests and pgTAP both mock or bypass the HTTP layer.
//
// Uses the local stack's published demo keys - never run this against production.
//
// Every run mints its own rider/driver UUIDs and phone numbers instead of
// deleting fixtures afterwards: ledger_entries.driver_id has no cascade (by
// design - erasing a driver's financial history is exactly what the
// append-only ledger exists to prevent), so a teardown `delete from
// auth.users` collides with rows this same run just wrote. `supabase db
// reset` is the way to clear accumulated local fixtures between sessions.
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

const RIDER = crypto.randomUUID();
const DRIVER = crypto.randomUUID();
// profiles.phone is unique, so each run needs its own numbers too.
const phoneSuffix = crypto.randomInt(1_000_000, 10_000_000);
const RIDER_PHONE = `+2507${String(phoneSuffix).padStart(7, "0")}`;
const DRIVER_PHONE = `+2508${String(phoneSuffix).padStart(7, "0")}`;
const TOPUP_RWF = 5000;

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

// --- fixtures ---------------------------------------------------------------
// Fresh per run - never deleted. See header comment for why.
//
// confirmation_token / recovery_token / email_change_token_new / email_change
// have no column default and are otherwise NULL, which GoTrue's Go sql.Scan
// cannot read into a string (`converting NULL to string is unsupported`, 500
// on /auth/v1/user). created_at/updated_at are NULL for the same reason,
// scanned into *time.Time. All six must be set explicitly.
psql(`insert into auth.users
  (instance_id,id,aud,role,email,confirmation_token,recovery_token,
   email_change_token_new,email_change,created_at,updated_at) values
  ('00000000-0000-0000-0000-000000000000','${RIDER}','authenticated','authenticated','e2e.rider.${RIDER}@test.local','','','','',now(),now()),
  ('00000000-0000-0000-0000-000000000000','${DRIVER}','authenticated','authenticated','e2e.driver.${DRIVER}@test.local','','','','',now(),now());`);
psql(`insert into public.profiles (id,role,first_name,phone) values
  ('${RIDER}','rider','Aline','${RIDER_PHONE}'),
  ('${DRIVER}','driver','Eric','${DRIVER_PHONE}');`);
psql(`insert into public.drivers (id,verification) values ('${DRIVER}','verified');`);
psql(`insert into public.ledger_entries (driver_id,kind,amount_rwf)
      values ('${DRIVER}','topup_credit',${TOPUP_RWF});`);

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

// --- 1. quote ---------------------------------------------------------------
const quote = await call("/functions/v1/quote", riderJwt, {
  vehicleClass: "moto", distanceM: 4000, durationS: 720,
});
check("quote returns 200", quote.status, 200);
check("quote is 1700 RWF", quote.body.amountRwf, 1700);

// --- 2. create the trip ------------------------------------------------------
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

// --- 3. dispatch assigns the driver (service role) ---------------------------
const assigned = await call("/rest/v1/rpc/assign_driver_to_trip", SERVICE, {
  p_trip_id: tripId, p_driver_id: DRIVER, p_idempotency_key: "offer-1",
});
check("driver assigned", assigned.status, 200);
check("trip is offered", assigned.body.state, "offered");

// --- 4. driver accepts, arrives, starts --------------------------------------
for (const [to, key] of [["accepted","a1"],["arrived","a2"],["in_progress","a3"]]) {
  const r = await call("/rest/v1/rpc/trip_transition", driverJwt, {
    p_trip_id: tripId, p_to: to, p_idempotency_key: key,
  });
  check(`transition to ${to}`, r.body.state, to);
}

// --- 5. complete --------------------------------------------------------------
const done = await call("/functions/v1/complete-trip", driverJwt, {
  tripId, actualDistanceM: 4100, idempotencyKey: "done-1",
});
check("completion returns 200", done.status, 200);
check("trip completed", done.body.state, "completed");
check("total is the quoted fare", done.body.receipt.totalRwf, 1700);
check("commission is 15%", done.body.commissionRwf, 255);

// --- 6. replay must not double-charge -----------------------------------------
await call("/functions/v1/complete-trip", driverJwt, {
  tripId, actualDistanceM: 4100, idempotencyKey: "done-1",
});
check("exactly one commission debit",
  psql(`select count(*) from public.ledger_entries where trip_id='${tripId}';`), "1");

// Scoped to THIS run's driver: with no teardown, other runs' rows share the
// table, so a global sum would be meaningless. The expected figure is derived
// from this run's own top-up and commission, not a hardcoded constant.
const commissionRwf = done.body.commissionRwf;
check(`driver balance is ${TOPUP_RWF} - ${commissionRwf}`,
  psql(`select sum(case when kind in ('topup_credit','adjustment_credit')
        then amount_rwf else -amount_rwf end) from public.ledger_entries
        where driver_id='${DRIVER}';`), TOPUP_RWF - commissionRwf);

console.log("\nAll end-to-end checks passed.");
