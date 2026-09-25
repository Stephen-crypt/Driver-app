// The full loop with nobody choosing the driver. Local stack only.
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const API = "http://127.0.0.1:54321";
const JWT_SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";
const DB = process.env.GERA_DB_CONTAINER ?? "supabase_db_driver_app";
const ANON = process.env.GERA_ANON_KEY;
const SERVICE = process.env.GERA_SERVICE_KEY;
if (!ANON || !SERVICE) {
  console.error("Set GERA_ANON_KEY and GERA_SERVICE_KEY from `supabase status`.");
  process.exit(1);
}

const RIDER = crypto.randomUUID();
const DRIVER = crypto.randomUUID();
const suffix = String(Math.floor(Math.random() * 1e6)).padStart(6, "0");

const psql = (sql) =>
  execFileSync("docker", [
    "exec", DB, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-c", sql,
  ]).toString().trim();

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function mint(sub) {
  const h = b64({ alg: "HS256", typ: "JWT" });
  const p = b64({ sub, role: "authenticated", aud: "authenticated",
                  exp: Math.floor(Date.now() / 1000) + 3600 });
  const s = crypto.createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${s}`;
}

function check(label, actual, expected) {
  if (String(actual) !== String(expected)) {
    console.error(`FAIL ${label}: expected ${expected}, got ${actual}`);
    process.exit(1);
  }
  console.log(`ok   ${label}`);
}

// Fixtures. No deletes: ledger rows are append-only by design.
psql(`insert into auth.users (instance_id,id,aud,role,email,confirmation_token,recovery_token,email_change_token_new,email_change,created_at,updated_at) values
 ('00000000-0000-0000-0000-000000000000','${RIDER}','authenticated','authenticated','d.rider.${suffix}@test.local','','','','',now(),now()),
 ('00000000-0000-0000-0000-000000000000','${DRIVER}','authenticated','authenticated','d.driver.${suffix}@test.local','','','','',now(),now());`);
psql(`insert into public.profiles (id,role,first_name,phone) values
 ('${RIDER}','rider','Aline','+2507881${suffix}'),
 ('${DRIVER}','driver','Eric','+2507882${suffix}');`);
psql(`insert into public.drivers (id,verification) values ('${DRIVER}','verified');`);
psql(`insert into public.ledger_entries (driver_id,kind,amount_rwf) values ('${DRIVER}','topup_credit',5000);`);
// One moto, online, 300m from the pickup.
psql(`insert into public.driver_presence (driver_id,status,vehicle_class,position,heartbeat_at)
      values ('${DRIVER}','online','moto',st_point(30.0650,-1.9441)::geography,now());`);

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

const quote = await call("/functions/v1/quote", riderJwt, {
  vehicleClass: "moto", distanceM: 4000, durationS: 720,
});
check("quote returns 200", quote.status, 200);

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

// Nobody names a driver here. The dispatcher chooses.
const dispatched = await call("/functions/v1/dispatch", SERVICE, { tripId });
check("dispatch returns 200", dispatched.status, 200);
check("a driver was offered the trip", dispatched.body.offered, true);
check("and it is the only eligible driver", dispatched.body.driverId, DRIVER);
check("trip is offered", psql(`select state from public.trips where id='${tripId}';`), "offered");

const offerId = psql(
  `select id from public.trip_offers where trip_id='${tripId}' and outcome is null;`);

const accepted = await call("/rest/v1/rpc/accept_offer", driverJwt, {
  p_offer_id: offerId, p_idempotency_key: "acc-1",
});
check("driver accepts", accepted.body.state, "accepted");
check("offer records the outcome",
  psql(`select outcome from public.trip_offers where id='${offerId}';`), "accepted");

for (const [to, key] of [["arrived", "a2"], ["in_progress", "a3"]]) {
  const r = await call("/rest/v1/rpc/trip_transition", driverJwt, {
    p_trip_id: tripId, p_to: to, p_idempotency_key: key,
  });
  check(`transition to ${to}`, r.body.state, to);
}

const done = await call("/functions/v1/complete-trip", driverJwt, {
  tripId, actualDistanceM: 4100, idempotencyKey: "done-1",
});
check("completion returns 200", done.status, 200);
check("trip completed", done.body.state, "completed");
check("exactly one commission debit",
  psql(`select count(*) from public.ledger_entries where trip_id='${tripId}';`), "1");
check("driver balance is 5000 - 255",
  psql(`select public.driver_balance('${DRIVER}');`), "4745");

console.log("\nDispatch end-to-end passed: nobody chose the driver.");
