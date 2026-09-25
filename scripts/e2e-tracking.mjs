// Live tracking and safety, end to end on a real trip.
//
// Books a trip, waits for a driver to accept it, then exercises the tracking
// surface as each party: the driver publishes a position, the rider reads it
// back with an ETA, and a stranger gets nothing from either direction.
//
// Requires the local stack AND `pnpm simulate` running.
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

const STRANGER = "11111111-1111-1111-1111-111111111111";
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

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}  ${detail}`); }
};

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

  psql(`insert into auth.users (instance_id,id,aud,role,email,confirmation_token,recovery_token,email_change_token_new,email_change,created_at,updated_at)
        values ('00000000-0000-0000-0000-000000000000','${RIDER}','authenticated','authenticated','t.rider.${suffix}@test.local','','','','',now(),now());`);
  psql(`insert into public.profiles (id,role,first_name,phone)
        values ('${RIDER}','rider','Aline','+2507886${suffix}');`);

  const riderJwt = mint(RIDER);

  const quote = await call("/functions/v1/quote", riderJwt, {
    vehicleClass: "moto", distanceM: 4000, durationS: 720,
  });
  const created = await call("/rest/v1/rpc/create_trip_from_quote", riderJwt, {
    p_quote_id: quote.body.quoteId,
    p_pickup: wkt(PICKUP), p_pickup_label: "Kimironko Market", p_pickup_note: null,
    p_dropoff: wkt(DROPOFF), p_dropoff_label: "Kigali Heights",
  });
  const tripId = created.body?.id;
  console.log(`\ntrip ${tripId}\nwaiting for a driver to accept…`);

  let driverId = null;
  for (let i = 0; i < 40 && !driverId; i++) {
    await sleep(2000);
    const row = psql(
      `select coalesce(driver_id::text,'') || '|' || state from public.trips where id='${tripId}';`);
    const [d, state] = row.split("|");
    if (d && (state === "accepted" || state === "arrived" || state === "in_progress")) driverId = d;
    if (["no_drivers", "expired"].includes(state)) break;
  }

  if (!driverId) {
    console.error("No driver accepted in time; cannot test tracking.");
    process.exit(1);
  }
  console.log(`accepted by ${driverId}\n`);

  const driverJwt = mint(driverId);
  const strangerJwt = mint(STRANGER);

  console.log("Tracking");
  {
    const r = await call("/rest/v1/rpc/publish_track_point", driverJwt, {
      p_trip_id: tripId, p_lng: 30.1100, p_lat: -1.9380, p_accuracy_m: 12,
    });
    // void-returning RPCs answer 204 No Content, not 200.
    check("the driver can publish their position", r.status === 200 || r.status === 204,
      `got ${r.status}`);
  }
  {
    const r = await call("/rest/v1/rpc/trip_driver_position", riderJwt, { p_trip_id: tripId });
    const row = r.body?.[0];
    check("the rider reads it back", Boolean(row), JSON.stringify(r.body));
    check("with real coordinates",
      Math.abs(Number(row?.lng) - 30.11) < 0.001 && Math.abs(Number(row?.lat) + 1.938) < 0.001,
      JSON.stringify(row));
    check("and a distance to the pickup", Number(row?.metres_away) > 0, String(row?.metres_away));
    check("and an ETA of at least thirty seconds", Number(row?.eta_seconds) >= 30,
      String(row?.eta_seconds));
  }
  {
    const r = await call("/rest/v1/rpc/trip_driver_position", strangerJwt, { p_trip_id: tripId });
    check("a stranger cannot follow the driver",
      Array.isArray(r.body) && r.body.length === 0, JSON.stringify(r.body));
  }
  {
    const r = await call("/rest/v1/rpc/publish_track_point", strangerJwt, {
      p_trip_id: tripId, p_lng: 0, p_lat: 0,
    });
    check("a stranger cannot forge a position", r.status >= 400, `got ${r.status}`);
    check("and the forged point was not stored",
      psql(`select count(*) from public.trip_track_points
             where trip_id='${tripId}' and st_x(position::geometry)=0;`) === "0");
  }

  console.log("\nSafety");
  {
    const r = await call("/rest/v1/rpc/raise_sos", riderJwt, {
      p_trip_id: tripId, p_lng: 30.11, p_lat: -1.94, p_note: "e2e",
    });
    check("a rider can raise an alert", r.status === 200 && Boolean(r.body), `got ${r.status}`);
    check("recorded against the trip and the rider",
      psql(`select count(*) from public.sos_alerts
             where trip_id='${tripId}' and raised_by='${RIDER}' and source='rider';`) === "1");
  }
  {
    const r = await call("/rest/v1/rpc/raise_sos", driverJwt, { p_trip_id: tripId });
    check("a driver can raise one too", r.status === 200);
    check("and it is attributed to the driver",
      psql(`select count(*) from public.sos_alerts
             where trip_id='${tripId}' and source='driver';`) === "1");
  }
  {
    const r = await call("/rest/v1/rpc/raise_sos", riderJwt, {});
    check("an alert with no details at all still records", r.status === 200 && Boolean(r.body));
  }
  {
    // Anyone reading somebody else's alerts would be a safety problem in
    // itself - it maps exactly who felt unsafe and where.
    const res = await fetch(`${API}/rest/v1/sos_alerts?select=id,note`, {
      headers: { apikey: ANON, Authorization: `Bearer ${strangerJwt}` },
    });
    const rows = await res.json().catch(() => null);
    check("a stranger reads no alerts", Array.isArray(rows) && rows.length === 0,
      JSON.stringify(rows));
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
