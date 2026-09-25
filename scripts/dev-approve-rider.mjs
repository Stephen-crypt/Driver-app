// Approve and fund a rider so they can go online. Local development only.
//
// Real onboarding leaves a rider at `pending`: verification is a human step
// (licence, vehicle, national ID) and no amount of app code should skip it. But
// testing the rider app needs a rider who can actually go online, so this
// does by hand what an ops reviewer would do.
//
//   node scripts/dev-approve-rider.mjs +250730123456
//   node scripts/dev-approve-rider.mjs +250730123456 --class cab
import { execFileSync } from "node:child_process";

const DB = process.env.GERA_DB_CONTAINER ?? "supabase_db_driver_app";

const psql = (sql) =>
  execFileSync("docker", [
    "exec", DB, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-c", sql,
  ]).toString().trim();

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

const phone = process.argv[2];
if (!phone || phone.startsWith("--")) {
  console.error("Usage: node scripts/dev-approve-rider.mjs <phone> [--class moto|cab|cab_xl]");
  process.exit(1);
}

const vehicleClass = arg("class", "moto");
if (!["moto", "cab", "cab_xl"].includes(vehicleClass)) {
  console.error(`Unknown class '${vehicleClass}'.`);
  process.exit(1);
}

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

// The phone may be stored with or without the leading plus depending on which
// path created the row, so match on the digits.
const digits = phone.replace(/[^0-9]/g, "");
const id = psql(
  `select id from public.profiles
    where regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g') = ${lit(digits)}
    limit 1;`,
);

if (!id) {
  console.error(`No profile with phone ${phone}. Sign up in the rider app first.`);
  process.exit(1);
}

const role = psql(`select role from public.profiles where id='${id}';`);
if (role !== "rider") {
  psql(`update public.profiles set role='rider' where id='${id}';`);
  console.log(`role: ${role} -> rider`);
}

psql(`insert into public.riders (id, verification) values ('${id}','verified')
      on conflict (id) do update set verification='verified';`);
console.log("verification: verified");

const plate = `RAD ${String(Math.floor(Math.random() * 900) + 100)}X`;
psql(`insert into public.vehicles (rider_id, class, plate, vest_number, is_active)
      values ('${id}', ${lit(vehicleClass)}, ${lit(plate)}, ${lit(String(Math.floor(Math.random() * 98) + 2))}, true)
      on conflict do nothing;`);
console.log(`vehicle: ${vehicleClass} ${plate}`);

// Nothing to fund. In a fleet the gate is a vehicle, an open shift and a clean
// cash position. The vehicle was assigned above; the shift is the rider's to
// start, in the app, because that is where the safety checks are.
const held = Number(psql(`select public.rider_cash_held_internal('${id}');`));
console.log(`carrying: ${held} RWF of company cash`);
console.log(`\nRider ${id} is ready. Open the rider app and start a shift.`);
