// The full loop with nobody choosing the rider. Local stack only.
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

const PASSENGER = crypto.randomUUID();
const RIDER = crypto.randomUUID();
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

// Every run places its whole scene somewhere else in Kigali. Back to back, the
// PREVIOUS run's rider is still `online` with a heartbeat inside the 30-second
// window; at fixed coordinates it sat at exactly the same distance from exactly
// the same pickup as this run's rider, and "and it is the only eligible
// rider" lost that tie about half the time. Pickup, dropoff and rider are
// offset together, so the geometry the test depends on - one moto ~300m from
// the pickup - is unchanged; only its position on the map moves.
const LNG_MIN = 30.03, LNG_MAX = 30.13;
const LAT_MIN = -1.99, LAT_MAX = -1.91;
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const originLng = rand(LNG_MIN, LNG_MAX);
const originLat = rand(LAT_MIN, LAT_MAX);
const M_PER_DEG_LAT = 111_320;
const mPerDegLng = M_PER_DEG_LAT * Math.cos((originLat * Math.PI) / 180);
const east = (metres) => originLng + metres / mPerDegLng;
const north = (metres) => originLat + metres / M_PER_DEG_LAT;

const PICKUP = { lng: originLng, lat: originLat };
const RIDER_AT = { lng: east(300), lat: originLat };
// The same ~1.1km hop the fixed fixture used, kept so the trip still looks like
// a real short Kigali ride.
const DROPOFF = { lng: east(-344), lat: north(-1058) };
const point = (p) => `st_point(${p.lng},${p.lat})::geography`;
const wkt = (p) => `POINT(${p.lng} ${p.lat})`;

// The other half of the same flake: a run that leaves its rider online is the
// run that breaks the NEXT one. Jitter makes a collision unlikely; parking the
// rider makes a clean run leave nothing behind at all.
function parkRider() {
  try {
    psql(`update public.rider_presence set status='offline', updated_at=now()
           where rider_id='${RIDER}';`);
  } catch (err) {
    console.error("warning: could not park the fixture rider offline", err.message);
  }
}

function check(label, actual, expected) {
  if (String(actual) !== String(expected)) {
    console.error(`FAIL ${label}: expected ${expected}, got ${actual}`);
    parkRider();
    process.exit(1);
  }
  console.log(`ok   ${label}`);
}

// Fixtures. No deletes: ledger rows are append-only by design.
psql(`insert into auth.users (instance_id,id,aud,role,email,confirmation_token,recovery_token,email_change_token_new,email_change,created_at,updated_at) values
 ('00000000-0000-0000-0000-000000000000','${PASSENGER}','authenticated','authenticated','d.passenger.${suffix}@test.local','','','','',now(),now()),
 ('00000000-0000-0000-0000-000000000000','${RIDER}','authenticated','authenticated','d.rider.${suffix}@test.local','','','','',now(),now());`);
psql(`insert into public.profiles (id,role,first_name,phone) values
 ('${PASSENGER}','passenger','Aline','+2507881${suffix}'),
 ('${RIDER}','rider','Eric','+2507882${suffix}');`);
psql(`insert into public.riders (id,verification) values ('${RIDER}','verified');`);
psql(`insert into public.ledger_entries (rider_id,kind,amount_rwf) values ('${RIDER}','topup_credit',5000);`);
// One moto, online, 300m from the pickup - wherever this run's pickup landed.
psql(`insert into public.rider_presence (rider_id,status,vehicle_class,position,heartbeat_at)
      values ('${RIDER}','online','moto',${point(RIDER_AT)},now());`);

const passengerJwt = mint(PASSENGER);
const riderJwt = mint(RIDER);

const call = async (path, jwt, body) => {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const quote = await call("/functions/v1/quote", passengerJwt, {
  vehicleClass: "moto", distanceM: 4000, durationS: 720,
});
check("quote returns 200", quote.status, 200);

const created = await call("/rest/v1/rpc/create_trip_from_quote", passengerJwt, {
  p_quote_id: quote.body.quoteId,
  p_pickup: wkt(PICKUP),
  p_pickup_label: "Kimironko Market",
  p_pickup_note: "blue gate opposite the pharmacy",
  p_dropoff: wkt(DROPOFF),
  p_dropoff_label: "Kigali Heights",
});
check("trip created", created.status, 200);
const tripId = created.body.id;

// Nobody names a rider here. The dispatcher chooses.
const dispatched = await call("/functions/v1/dispatch", SERVICE, { tripId });
check("dispatch returns 200", dispatched.status, 200);
check("a rider was offered the trip", dispatched.body.offered, true);
check("and it is the only eligible rider", dispatched.body.riderId, RIDER);
check("trip is offered", psql(`select state from public.trips where id='${tripId}';`), "offered");

const offerId = psql(
  `select id from public.trip_offers where trip_id='${tripId}' and outcome is null;`);

const accepted = await call("/rest/v1/rpc/accept_offer", riderJwt, {
  p_offer_id: offerId, p_idempotency_key: "acc-1",
});
check("rider accepts", accepted.body.state, "accepted");
check("offer records the outcome",
  psql(`select outcome from public.trip_offers where id='${offerId}';`), "accepted");

for (const [to, key] of [["arrived", "a2"], ["in_progress", "a3"]]) {
  const r = await call("/rest/v1/rpc/trip_transition", riderJwt, {
    p_trip_id: tripId, p_to: to, p_idempotency_key: key,
  });
  check(`transition to ${to}`, r.body.state, to);
}

const done = await call("/functions/v1/complete-trip", riderJwt, {
  tripId, actualDistanceM: 4100, idempotencyKey: "done-1",
});
check("completion returns 200", done.status, 200);
check("trip completed", done.body.state, "completed");
check("exactly one commission debit",
  psql(`select count(*) from public.ledger_entries where trip_id='${tripId}';`), "1");
check("rider balance is 5000 - 255",
  psql(`select public.rider_balance('${RIDER}');`), "4745");

parkRider();

console.log("\nDispatch end-to-end passed: nobody chose the rider.");
