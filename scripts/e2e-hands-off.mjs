// The regression test for "it stops at Finding you a driver".
//
// A rider creates a trip and NOTHING else is called - no dispatch, no accept,
// no transition. If the product is whole, the trip reaches `completed` on its
// own: dispatch_pending_trips makes the first offer, a driver answers it, and
// the trip walks itself to the end. Every earlier e2e script hand-called
// /functions/v1/dispatch, which is exactly why this gap survived them all.
//
// Requires the local stack AND `pnpm simulate` running with working drivers.
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const API = "http://127.0.0.1:54321";
const JWT_SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";
const DB = process.env.GERA_DB_CONTAINER ?? "supabase_db_driver_app";
const ANON = process.env.GERA_ANON_KEY;
if (!ANON) {
  console.error("Set GERA_ANON_KEY from `supabase status`.");
  process.exit(1);
}

const TIMEOUT_MS = Number(process.env.GERA_HANDS_OFF_TIMEOUT_MS ?? 120_000);
const RIDER = crypto.randomUUID();
const suffix = String(Math.floor(Math.random() * 1e6)).padStart(6, "0");

const psql = (sql) =>
  execFileSync("docker", [
    "exec", DB, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-c", sql,
  ]).toString().trim();

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const mint = (sub) => {
  const h = b64({ alg: "HS256", typ: "JWT" });
  const p = b64({
    sub, role: "authenticated", aud: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  const s = crypto.createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${s}`;
};

const call = async (path, jwt, body) => {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Kimironko Market to Kigali Heights - both straight out of the gazetteer.
const PICKUP = { lng: 30.1128, lat: -1.9403 };
const DROPOFF = { lng: 30.0925, lat: -1.9536 };
const wkt = (p) => `POINT(${p.lng} ${p.lat})`;

async function main() {
  const online = Number(psql(
    `select count(*) from public.driver_presence
      where status='online' and vehicle_class='moto'
        and heartbeat_at > now() - interval '30 seconds';`));
  if (online === 0) {
    console.error("No moto drivers online. Start `pnpm simulate` first.");
    process.exit(1);
  }
  console.log(`${online} moto driver(s) online.\n`);

  psql(`insert into auth.users (instance_id,id,aud,role,email,confirmation_token,recovery_token,email_change_token_new,email_change,created_at,updated_at)
        values ('00000000-0000-0000-0000-000000000000','${RIDER}','authenticated','authenticated','h.rider.${suffix}@test.local','','','','',now(),now());`);
  psql(`insert into public.profiles (id,role,first_name,phone)
        values ('${RIDER}','rider','Aline','+2507885${suffix}');`);

  const riderJwt = mint(RIDER);

  const quote = await call("/functions/v1/quote", riderJwt, {
    vehicleClass: "moto", distanceM: 4000, durationS: 720,
  });
  if (quote.status !== 200) throw new Error(`quote failed: ${quote.status}`);
  console.log(`quoted ${quote.body.amountRwf} RWF`);

  const created = await call("/rest/v1/rpc/create_trip_from_quote", riderJwt, {
    p_quote_id: quote.body.quoteId,
    p_pickup: wkt(PICKUP),
    p_pickup_label: "Kimironko Market",
    p_pickup_note: "blue gate opposite the pharmacy",
    p_dropoff: wkt(DROPOFF),
    p_dropoff_label: "Kigali Heights",
  });
  if (created.status !== 200) throw new Error(`create failed: ${JSON.stringify(created.body)}`);
  const tripId = created.body.id;
  console.log(`trip ${tripId} created in state '${created.body.state}'\n`);
  console.log("Hands off from here. Watching…\n");

  const TERMINAL = new Set([
    "completed", "no_drivers", "cancelled_by_rider", "cancelled_by_driver", "expired",
  ]);
  const seen = [];
  const started = Date.now();
  let state = created.body.state;
  seen.push(state);

  while (!TERMINAL.has(state) && Date.now() - started < TIMEOUT_MS) {
    await sleep(2000);
    const next = psql(`select state from public.trips where id='${tripId}';`);
    if (next !== state) {
      state = next;
      seen.push(state);
      console.log(`  → ${state}  (${Math.round((Date.now() - started) / 1000)}s)`);
    }
  }

  console.log(`\npath: ${seen.join(" → ")}`);

  if (state !== "completed") {
    console.error(`\nFAIL: the trip ended in '${state}', not 'completed'.`);
    if (state === "requested") {
      console.error("It never got a first offer - dispatch_pending_trips is not running.");
    }
    process.exit(1);
  }

  const ledger = psql(
    `select count(*) from public.ledger_entries where trip_id='${tripId}';`);
  const fare = psql(`select quoted_amount_rwf from public.trips where id='${tripId}';`);
  console.log(`fare ${fare} RWF, ${ledger} commission entry`);
  console.log("\nHands-off loop passed: nobody touched the trip after booking.");
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
