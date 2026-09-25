// Spawns virtual drivers around Kigali, sets them online, moves them on a
// heartbeat, and - unless --passive is passed - has them actually WORK: accept
// the offers dispatch sends them, arrive, drive, and complete the trip.
//
// Without the working half, a rider books and watches "Finding you a driver"
// forever even when dispatch is healthy, because an offer nobody answers just
// expires. Local stack only - presence and fixtures are written directly to the
// database, but every state change goes through the real RPCs with a real
// driver JWT, so the simulation cannot pass through a transition the product
// would refuse.
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const DB = process.env.GERA_DB_CONTAINER ?? "supabase_db_driver_app";
const API = process.env.GERA_API_URL ?? "http://127.0.0.1:54321";
// The fixed defaults `supabase start` uses locally. This script is local-only.
const JWT_SECRET =
  process.env.GERA_JWT_SECRET ??
  "super-secret-jwt-token-with-at-least-32-characters-long";
const ANON =
  process.env.GERA_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

function psql(sql) {
  return execFileSync("docker", [
    "exec", DB, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-c", sql,
  ]).toString().trim();
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(process.argv[i + 1]);
}

const DRIVERS = arg("drivers", 10);
const MINUTES = arg("minutes", 1);
const PASSIVE = process.argv.includes("--passive");
const TICK_MS = 5000;

// How long a simulated driver takes at each leg. Roughly a short Kigali hop,
// slow enough to watch the rider's sheet morph through every stage.
const ACCEPT_AFTER_MS = 2500;
const ARRIVE_AFTER_MS = 10000;
const START_AFTER_MS = 6000;
const FINISH_AFTER_MS = 20000;

// Roughly the built-up area of Kigali.
const LNG_MIN = 30.03, LNG_MAX = 30.13;
const LAT_MIN = -1.99, LAT_MAX = -1.91;

const rand = (lo, hi) => lo + Math.random() * (hi - lo);

const FIRST_NAMES = [
  "Eric", "Jean", "Claude", "Patrick", "Emmanuel", "Olivier", "Fabrice",
  "Aline", "Chantal", "Divine", "Sandrine", "Yves", "Innocent", "Thierry",
];

// Phones and plates were derived from the index alone, which made every run
// produce the same ones: a second run without a `db reset` in between died on
// profiles_phone_key. The run tag makes each batch its own.
const RUN = Math.floor(Math.random() * 900 + 100);

const drivers = Array.from({ length: DRIVERS }, (_, i) => ({
  id: crypto.randomUUID(),
  name: FIRST_NAMES[i % FIRST_NAMES.length],
  phone: `+25078${RUN}${String(10000 + i).slice(-5)}`,
  plate: `RA${String.fromCharCode(65 + (i % 26))} ${String(100 + i).slice(-3)}${String.fromCharCode(65 + ((RUN + i) % 26))}`,
  vest: String(RUN * 100 + i),
  lng: rand(LNG_MIN, LNG_MAX),
  lat: rand(LAT_MIN, LAT_MAX),
  bearing: rand(0, 2 * Math.PI),
  class: Math.random() < 0.7 ? "moto" : "cab",
}));

const byId = new Map(drivers.map((d) => [d.id, d]));
const idList = drivers.map((d) => `'${d.id}'`).join(",");

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function mint(sub) {
  const h = b64({ alg: "HS256", typ: "JWT" });
  const p = b64({
    sub, role: "authenticated", aud: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 24 * 3600,
  });
  const s = crypto.createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${s}`;
}
for (const d of drivers) d.jwt = mint(d.id);

async function call(path, jwt, body) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

console.log(`seeding ${DRIVERS} drivers…`);

// The token columns must be '' and not NULL. PostgREST only checks a JWT's
// signature, so accept_offer and trip_transition worked with them null - but an
// Edge Function calls auth.getUser(), which asks GoTrue, and GoTrue errors on a
// user row with null confirmation_token. The trip then walked itself all the
// way to in_progress and died on complete-trip with a bare 401.
const values = drivers
  .map((d) => `('00000000-0000-0000-0000-000000000000','${d.id}','authenticated','authenticated','sim.${d.id}@test.local','','','','',now(),now())`)
  .join(",");

psql(`insert into auth.users
        (instance_id,id,aud,role,email,confirmation_token,recovery_token,
         email_change_token_new,email_change,created_at,updated_at)
      values ${values};`);
psql(`insert into public.profiles (id,role,first_name,phone) values ${
  drivers.map((d) => `('${d.id}','driver','${d.name}','${d.phone}')`).join(",")};`);
psql(`insert into public.drivers (id,verification) values ${
  drivers.map((d) => `('${d.id}','verified')`).join(",")};`);
// A plate is what a rider actually looks for at the kerb, so a simulated driver
// that has none makes the rider's driver card untestable.
psql(`insert into public.vehicles (driver_id,class,plate,vest_number,is_active) values ${
  drivers.map((d) => `('${d.id}','${d.class}','${d.plate}','${d.vest}',true)`).join(",")};`);
// Funded above the go-online minimum.
psql(`insert into public.ledger_entries (driver_id,kind,amount_rwf) values ${
  drivers.map((d) => `('${d.id}','topup_credit',5000)`).join(",")};`);
psql(`insert into public.driver_presence (driver_id,status,vehicle_class,position,heartbeat_at) values ${
  drivers.map((d) => `('${d.id}','online','${d.class}',st_point(${d.lng},${d.lat})::geography,now())`).join(",")};`);

console.log(
  `${DRIVERS} drivers online (${PASSIVE ? "passive - they will NOT take trips" : "they will accept and complete trips"}).`,
);
console.log(`Moving for ${MINUTES} minute(s); Ctrl-C to stop.`);

const until = Date.now() + MINUTES * 60_000;

// Leaving simulated drivers `online` poisons everything that runs next: they
// stay in driver_presence_dispatchable_idx, they are matched to real trips by
// find_candidate_drivers for as long as their heartbeat looks fresh, and
// scripts/e2e-dispatch.mjs starts losing its "only eligible driver" check to
// them. The rows themselves stay - ledger_entries has no cascade by design -
// but the presence goes.
let parked = false;
function parkDrivers() {
  if (parked) return;
  parked = true;
  psql(`update public.driver_presence set status = 'offline', updated_at = now()
         where driver_id in (${idList});`);
  console.log("\ndrivers set offline.");
}

process.on("SIGINT", () => {
  parkDrivers();
  process.exit(130);
});

// tripId -> when this driver will take its next action. Kept in memory on
// purpose: a restart adopting trips mid-flight is a dev convenience nobody
// needs, and deriving it from the database would add a schema dependency this
// script does not otherwise have.
const nextActionAt = new Map();
const due = (tripId, ms) => {
  if (!nextActionAt.has(tripId)) nextActionAt.set(tripId, Date.now() + ms);
  return Date.now() >= nextActionAt.get(tripId);
};
const rearm = (tripId, ms) => nextActionAt.set(tripId, Date.now() + ms);

async function work() {
  // 1. Answer outstanding offers.
  const offerRows = psql(
    `select o.id || '|' || o.driver_id || '|' || o.trip_id
       from public.trip_offers o
      where o.outcome is null and o.driver_id in (${idList});`,
  );
  for (const line of offerRows.split("\n").filter(Boolean)) {
    const [offerId, driverId, tripId] = line.split("|");
    if (!due(`offer:${offerId}`, ACCEPT_AFTER_MS)) continue;
    const d = byId.get(driverId);
    if (!d) continue;
    const r = await call("/rest/v1/rpc/accept_offer", d.jwt, {
      p_offer_id: offerId, p_idempotency_key: `sim-acc-${offerId}`,
    });
    if (r.body?.state === "accepted") {
      console.log(`\n  ${d.name} (${d.plate}) accepted a ${d.class} trip`);
      rearm(tripId, ARRIVE_AFTER_MS);
    } else {
      // The offer lapsed or another driver got there first. Nothing to do.
      rearm(`offer:${offerId}`, 30_000);
    }
  }

  // 2. Move trips already in hand along.
  const tripRows = psql(
    `select t.id || '|' || t.driver_id || '|' || t.state
       from public.trips t
      where t.driver_id in (${idList})
        and t.state in ('accepted','arrived','in_progress');`,
  );
  for (const line of tripRows.split("\n").filter(Boolean)) {
    const [tripId, driverId, state] = line.split("|");
    const d = byId.get(driverId);
    if (!d) continue;

    if (state === "accepted") {
      if (!due(tripId, ARRIVE_AFTER_MS)) continue;
      const r = await call("/rest/v1/rpc/trip_transition", d.jwt, {
        p_trip_id: tripId, p_to: "arrived", p_idempotency_key: `sim-arr-${tripId}`,
      });
      if (r.body?.state === "arrived") {
        console.log(`  ${d.name} arrived at the pickup`);
        rearm(tripId, START_AFTER_MS);
      } else rearm(tripId, 10_000);
    } else if (state === "arrived") {
      if (!due(tripId, START_AFTER_MS)) continue;
      const r = await call("/rest/v1/rpc/trip_transition", d.jwt, {
        p_trip_id: tripId, p_to: "in_progress", p_idempotency_key: `sim-go-${tripId}`,
      });
      if (r.body?.state === "in_progress") {
        console.log(`  ${d.name} started the trip`);
        rearm(tripId, FINISH_AFTER_MS);
      } else rearm(tripId, 10_000);
    } else if (state === "in_progress") {
      if (!due(tripId, FINISH_AFTER_MS)) continue;
      // Within the detour tolerance of the quote, so the rider pays what they
      // were promised - the ordinary case, not the exception.
      const quoted = Number(
        psql(`select coalesce(quoted_distance_m, 4000) from public.trips where id='${tripId}';`),
      );
      const actual = Math.round(quoted * rand(0.97, 1.03));
      const r = await call("/functions/v1/complete-trip", d.jwt, {
        tripId, actualDistanceM: actual, idempotencyKey: `sim-done-${tripId}`,
      });
      if (r.body?.state === "completed") {
        console.log(`  ${d.name} completed the trip — ${r.body.receipt?.totalRwf} RWF`);
        nextActionAt.delete(tripId);
      } else {
        // Silence here cost a whole diagnosis round: the trip sat in
        // in_progress and the log showed only dots.
        console.error(
          `  ! ${d.name} could not complete ${tripId}: ${r.status} ${JSON.stringify(r.body)}`,
        );
        rearm(tripId, 10_000);
      }
    }
  }
}

let ticking = false;
const timer = setInterval(async () => {
  if (Date.now() > until) {
    clearInterval(timer);
    parkDrivers();
    console.log("simulation finished. Drivers left offline, funded and verified.");
    console.log("Run `supabase db reset` to clear them entirely.");
    return;
  }

  for (const d of drivers) {
    // ~7.5 m/s for a tick, with a small random turn.
    d.bearing += rand(-0.4, 0.4);
    const metres = 7.5 * (TICK_MS / 1000);
    d.lat += (metres * Math.cos(d.bearing)) / 111_320;
    d.lng += (metres * Math.sin(d.bearing)) / (111_320 * Math.cos((d.lat * Math.PI) / 180));
    d.lng = Math.min(Math.max(d.lng, LNG_MIN), LNG_MAX);
    d.lat = Math.min(Math.max(d.lat, LAT_MIN), LAT_MAX);
  }

  const updates = drivers
    .map((d) => `('${d.id}'::uuid, st_point(${d.lng},${d.lat})::geography)`)
    .join(",");

  psql(`update public.driver_presence p
           set position = v.pos, heartbeat_at = now(), updated_at = now()
          from (values ${updates}) as v(id, pos)
         where p.driver_id = v.id;`);

  process.stdout.write(".");

  // Overlapping ticks would double-accept and double-transition. A tick that
  // runs long simply yields this round.
  if (!PASSIVE && !ticking) {
    ticking = true;
    try {
      await work();
    } catch (err) {
      console.error("\nwork tick failed:", err.message);
    } finally {
      ticking = false;
    }
  }
}, TICK_MS);
