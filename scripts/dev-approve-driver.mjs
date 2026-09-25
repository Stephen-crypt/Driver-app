// Approve and fund a driver so they can go online. Local development only.
//
// Real onboarding leaves a driver at `pending`: verification is a human step
// (licence, vehicle, national ID) and no amount of app code should skip it. But
// testing the driver app needs a driver who can actually go online, so this
// does by hand what an ops reviewer would do.
//
//   node scripts/dev-approve-driver.mjs +250730123456
//   node scripts/dev-approve-driver.mjs +250730123456 --class cab --topup 10000
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
  console.error("Usage: node scripts/dev-approve-driver.mjs <phone> [--class moto|cab|cab_xl] [--topup 5000]");
  process.exit(1);
}

const vehicleClass = arg("class", "moto");
const topup = Number(arg("topup", "5000"));
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
  console.error(`No profile with phone ${phone}. Sign up in the driver app first.`);
  process.exit(1);
}

const role = psql(`select role from public.profiles where id='${id}';`);
if (role !== "driver") {
  psql(`update public.profiles set role='driver' where id='${id}';`);
  console.log(`role: ${role} -> driver`);
}

psql(`insert into public.drivers (id, verification) values ('${id}','verified')
      on conflict (id) do update set verification='verified';`);
console.log("verification: verified");

const plate = `RAD ${String(Math.floor(Math.random() * 900) + 100)}X`;
psql(`insert into public.vehicles (driver_id, class, plate, vest_number, is_active)
      values ('${id}', ${lit(vehicleClass)}, ${lit(plate)}, ${lit(String(Math.floor(Math.random() * 9000) + 1000))}, true)
      on conflict do nothing;`);
console.log(`vehicle: ${vehicleClass} ${plate}`);

const balance = Number(psql(`select public.driver_balance('${id}');`));
if (balance < topup) {
  psql(`insert into public.ledger_entries (driver_id, kind, amount_rwf)
        values ('${id}','topup_credit',${topup - balance});`);
}
console.log(`wallet: ${psql(`select public.driver_balance('${id}');`)} RWF`);

const allowed = psql(`select public.can_go_online('${id}');`);
console.log(`can go online: ${allowed}`);
console.log(`\nDriver ${id} is ready. Toggle online in the driver app.`);
