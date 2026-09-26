#!/usr/bin/env node
// Books a trip near a rider and runs real dispatch, so the rider's phone gets an
// offer without anyone opening the passenger app. Local stack only.
//
//   node scripts/dev-offer-trip.mjs +250788123456
//
// The rider must be online in the app (presence is what dispatch matches on).
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const API = "http://127.0.0.1:54321";
const JWT_SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";

// Kong checks the apikey header against the project's real keys, so these come
// from the running stack rather than being minted.
const keys = {};
const status = execFileSync("npx", ["supabase", "status", "-o", "env"], {
  shell: true,
  stdio: ["ignore", "pipe", "ignore"],
}).toString();
for (const line of status.split("\n")) {
  const eq = line.indexOf("=");
  if (eq > 0) keys[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replaceAll('"', "");
}
const ANON = keys.ANON_KEY;
const SERVICE = keys.SERVICE_ROLE_KEY;

const phone = process.argv[2];
if (!phone) {
  console.error("Usage: node scripts/dev-offer-trip.mjs <rider phone>");
  process.exit(1);
}

const psql = (sql) =>
  execFileSync("docker", ["exec", "supabase_db_driver_app", "psql", "-U", "postgres", "-d", "postgres", "-tA", "-c", sql])
    .toString()
    .trim();

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function mint(sub) {
  const h = b64({ alg: "HS256", typ: "JWT" });
  const p = b64({ sub, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 });
  const s = crypto.createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${s}`;
}

const digits = phone.replace(/[^0-9]/g, "");
const rider = psql(`select p.id || '|' || st_x(r.position::geometry) || '|' || st_y(r.position::geometry)
                      from public.profiles p join public.rider_presence r on r.rider_id = p.id
                     where regexp_replace(coalesce(p.phone,''),'[^0-9]','','g') = '${digits}'
                       and r.status = 'online';`);
if (!rider) {
  console.error("That rider is not online. Start a shift and go online in the app first.");
  process.exit(1);
}
const [riderId, lng, lat] = rider.split("|");

// A fresh passenger each time: profiles.phone is unique.
const passenger = crypto.randomUUID();
const suffix = crypto.randomInt(1_000_000, 9_999_999);
psql(`insert into auth.users (instance_id,id,aud,role,email,confirmation_token,recovery_token,email_change_token_new,email_change,created_at,updated_at)
      values ('00000000-0000-0000-0000-000000000000','${passenger}','authenticated','authenticated','dev.offer.${passenger}@test.local','','','','',now(),now());`);
psql(`insert into public.profiles (id,role,first_name,phone) values ('${passenger}','passenger','Aline','+2507${suffix}');`);

const passengerJwt = mint(passenger);
const call = async (path, jwt, body) => {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

// Pickup a few hundred metres from the rider, drop-off at Kigali Heights.
const pickup = { lng: Number(lng) + 0.004, lat: Number(lat) - 0.002 };
const quote = await call("/functions/v1/quote", passengerJwt, { vehicleClass: "moto", distanceM: 5200, durationS: 900, pickup, dropoff: { lng: 30.0936, lat: -1.9536 } });
if (quote.status !== 200) throw new Error(`quote: ${JSON.stringify(quote.body)}`);

const trip = await call("/rest/v1/rpc/create_trip_from_quote", passengerJwt, {
  p_quote_id: quote.body.quoteId,
  p_pickup: `POINT(${pickup.lng} ${pickup.lat})`,
  p_pickup_label: "Kibagabaga Hospital",
  p_pickup_note: "By the main gate, blue jacket",
  p_dropoff: "POINT(30.0936 -1.9536)",
  p_dropoff_label: "Kigali Heights",
});
if (trip.status !== 200) throw new Error(`trip: ${JSON.stringify(trip.body)}`);

const dispatched = await call("/functions/v1/dispatch", SERVICE, { tripId: trip.body.id });
console.log(`trip ${trip.body.id}: ${quote.body.amountRwf} RWF`);
console.log(
  dispatched.body?.riderId === riderId
    ? "offered to your rider - check the app, it has fifteen seconds"
    : `dispatch chose someone else: ${JSON.stringify(dispatched.body)}`,
);
console.log(`passenger PIN: ${psql(`select pin from public.trip_pins where trip_id='${trip.body.id}';`)}`);
