// Spawns virtual drivers around Kigali, sets them online, and moves them on a
// heartbeat so dispatch has something real to match against.
// Local stack only - it writes directly to the database.
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const DB = process.env.GERA_DB_CONTAINER ?? "supabase_db_driver_app";

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
const TICK_MS = 5000;

// Roughly the built-up area of Kigali.
const LNG_MIN = 30.03, LNG_MAX = 30.13;
const LAT_MIN = -1.99, LAT_MAX = -1.91;

const rand = (lo, hi) => lo + Math.random() * (hi - lo);

const drivers = Array.from({ length: DRIVERS }, (_, i) => ({
  id: crypto.randomUUID(),
  phone: `+2507889${String(700000 + i).slice(-6)}`,
  lng: rand(LNG_MIN, LNG_MAX),
  lat: rand(LAT_MIN, LAT_MAX),
  bearing: rand(0, 2 * Math.PI),
  class: Math.random() < 0.7 ? "moto" : "cab",
}));

console.log(`seeding ${DRIVERS} drivers…`);

const values = drivers
  .map((d) => `('00000000-0000-0000-0000-000000000000','${d.id}','authenticated','authenticated','sim.${d.id}@test.local')`)
  .join(",");

psql(`insert into auth.users (instance_id,id,aud,role,email) values ${values};`);
psql(`insert into public.profiles (id,role,first_name,phone) values ${
  drivers.map((d) => `('${d.id}','driver','Sim','${d.phone}')`).join(",")};`);
psql(`insert into public.drivers (id,verification) values ${
  drivers.map((d) => `('${d.id}','verified')`).join(",")};`);
// Funded above the go-online minimum.
psql(`insert into public.ledger_entries (driver_id,kind,amount_rwf) values ${
  drivers.map((d) => `('${d.id}','topup_credit',5000)`).join(",")};`);
psql(`insert into public.driver_presence (driver_id,status,vehicle_class,position,heartbeat_at) values ${
  drivers.map((d) => `('${d.id}','online','${d.class}',st_point(${d.lng},${d.lat})::geography,now())`).join(",")};`);

console.log(`${DRIVERS} drivers online. Moving for ${MINUTES} minute(s); Ctrl-C to stop.`);

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
         where driver_id in (${drivers.map((d) => `'${d.id}'`).join(",")});`);
  console.log("\ndrivers set offline.");
}

// Ctrl-C is the NORMAL way to stop this script, so the teardown cannot live
// only on the finished path. Re-raising as an exit code rather than calling
// process.exit() keeps the signal's meaning for whatever spawned us.
process.on("SIGINT", () => {
  parkDrivers();
  process.exit(130);
});

const timer = setInterval(() => {
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
}, TICK_MS);
