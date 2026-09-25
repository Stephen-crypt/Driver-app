// Walks exactly the server calls the rider booking screens make: authenticated
// landmark search, quote, book, read back, dispatch, accept. Local stack only.
//
// The screens themselves cannot be driven from here, but every call they make
// can - and a screen that typechecks against a call that 403s is a failure this
// project has already shipped once, in Phase 1 onboarding.
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
  const p = b64({
    sub, role: "authenticated", aud: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  const s = crypto.createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${s}`;
}

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}  ${detail}`);
  }
};

const call = async (path, jwt, body) => {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

// Kimironko Market and Kigali Heights, straight out of the gazetteer - the same
// two rows the destination picker would hand the ride screen.
const PICKUP = { lng: 30.1128, lat: -1.9403 };
const DROPOFF = { lng: 30.0925, lat: -1.9536 };
const wkt = (p) => `POINT(${p.lng} ${p.lat})`;

function parkDriver() {
  try {
    psql(`update public.driver_presence set status='offline', updated_at=now()
           where driver_id='${DRIVER}';`);
  } catch (err) {
    console.error("warning: could not park the fixture driver offline", err.message);
  }
}

async function main() {
  console.log("\nSeeding a rider and one nearby moto…");
  psql(`insert into auth.users (instance_id,id,aud,role,email,confirmation_token,recovery_token,email_change_token_new,email_change,created_at,updated_at) values
   ('00000000-0000-0000-0000-000000000000','${RIDER}','authenticated','authenticated','b.rider.${suffix}@test.local','','','','',now(),now()),
   ('00000000-0000-0000-0000-000000000000','${DRIVER}','authenticated','authenticated','b.driver.${suffix}@test.local','','','','',now(),now());`);
  psql(`insert into public.profiles (id,role,first_name,phone) values
   ('${RIDER}','rider','Aline','+2507883${suffix}'),
   ('${DRIVER}','driver','Eric','+2507884${suffix}');`);
  psql(`insert into public.drivers (id,verification) values ('${DRIVER}','verified');`);
  psql(`insert into public.ledger_entries (driver_id,kind,amount_rwf) values ('${DRIVER}','topup_credit',5000);`);
  psql(`insert into public.driver_presence (driver_id,status,vehicle_class,position,heartbeat_at)
        values ('${DRIVER}','online','moto',
                st_point(${PICKUP.lng + 0.003},${PICKUP.lat})::geography, now());`);

  const riderJwt = mint(RIDER);
  const driverJwt = mint(DRIVER);

  console.log("\nLandmark search — spec 3.7");
  {
    const r = await call("/rest/v1/rpc/search_landmarks", ANON, { p_query: "kim", p_limit: 5 });
    check("anonymous callers cannot search the gazetteer",
      r.status === 401 || r.status === 403 || r.status === 404, `got ${r.status}`);
  }
  {
    const r = await call("/rest/v1/rpc/search_landmarks", riderJwt, { p_query: "kim", p_limit: 5 });
    check("a signed-in rider can search", r.status === 200, `got ${r.status}`);
    check("'kim' returns a name-prefix match first",
      r.body?.[0]?.name === "Kimihurura", JSON.stringify(r.body?.[0]));
    check("results carry usable coordinates",
      Number.isFinite(r.body?.[0]?.lng) && Number.isFinite(r.body?.[0]?.lat));
  }
  {
    const r = await call("/rest/v1/rpc/search_landmarks", riderJwt, { p_query: "simba", p_limit: 10 });
    check("a mid-string query finds both Simba branches", r.body?.length === 2, `got ${r.body?.length}`);
  }
  {
    const r = await call("/rest/v1/rpc/search_landmarks", riderJwt, { p_query: "   ", p_limit: 10 });
    check("a blank query returns nothing", Array.isArray(r.body) && r.body.length === 0);
  }

  console.log("\nQuote — the number on the vehicle card");
  const quote = await call("/functions/v1/quote", riderJwt, {
    vehicleClass: "moto", distanceM: 4000, durationS: 720,
  });
  check("the rider gets a quote", quote.status === 200, `got ${quote.status}`);
  check("the quote is a whole hundred of RWF",
    Number.isInteger(quote.body?.amountRwf) && quote.body.amountRwf % 100 === 0,
    String(quote.body?.amountRwf));
  check("the quote carries an id the Book button can spend", Boolean(quote.body?.quoteId));

  console.log("\nBooking — the Book button");
  const created = await call("/rest/v1/rpc/create_trip_from_quote", riderJwt, {
    p_quote_id: quote.body.quoteId,
    p_pickup: wkt(PICKUP),
    p_pickup_label: "Kimironko Market",
    p_pickup_note: "blue gate opposite the pharmacy",
    p_dropoff: wkt(DROPOFF),
    p_dropoff_label: "Kigali Heights",
  });
  check("the trip is created", created.status === 200, JSON.stringify(created.body));
  const tripId = created.body?.id;
  check("it starts in requested", created.body?.state === "requested", created.body?.state);

  console.log("\nThe sheet's own read — getTrip");
  {
    const cols = "id,state,driver_id,quoted_amount_rwf,pickup_label,dropoff_label";
    const res = await fetch(`${API}/rest/v1/trips?id=eq.${tripId}&select=${cols}`, {
      headers: { apikey: ANON, Authorization: `Bearer ${riderJwt}` },
    });
    const rows = await res.json().catch(() => null);
    check("the rider reads back exactly the columns the sheet renders",
      res.status === 200 && rows?.length === 1, `${res.status} ${JSON.stringify(rows)}`);
    check("the fare quoted is the fare stored",
      rows?.[0]?.quoted_amount_rwf === quote.body.amountRwf,
      `${rows?.[0]?.quoted_amount_rwf} vs ${quote.body.amountRwf}`);
    check("no driver is attached yet", rows?.[0]?.driver_id === null);
  }

  console.log("\nDispatch — what makes the sheet morph on its own");
  const dispatched = await call("/functions/v1/dispatch", SERVICE, { tripId });
  check("dispatch accepts the trip", dispatched.status === 200, `got ${dispatched.status}`);
  check("a driver was offered the trip", dispatched.body?.offered === true,
    JSON.stringify(dispatched.body));
  check("the sheet would read 'Finding you a driver'",
    psql(`select state from public.trips where id='${tripId}';`) === "offered");

  const offerId = psql(
    `select id from public.trip_offers where trip_id='${tripId}' and outcome is null;`);
  check("an offer is outstanding", Boolean(offerId));

  const accepted = await call("/rest/v1/rpc/accept_offer", driverJwt, {
    p_offer_id: offerId, p_idempotency_key: `book-${suffix}`,
  });
  check("the driver accepts", accepted.body?.state === "accepted", JSON.stringify(accepted.body));
  check("the sheet would now read 'Driver on the way'",
    psql(`select state from public.trips where id='${tripId}';`) === "accepted");

  const note = psql(`select pickup_note from public.trips where id='${tripId}';`);
  check("the how-to-find-me note survived the booking",
    note === "blue gate opposite the pharmacy", note);

  parkDriver();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  parkDriver();
  console.error(e);
  process.exit(1);
});
