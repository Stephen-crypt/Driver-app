// Staff accounts for the web dashboard.
//
// This script is the ONLY way to grant a staff role. staff_members has no
// client write access at all, so a role cannot be given from the dashboard, the
// apps or the API - only by someone holding the service key, here.
//
//   node scripts/staff.mjs add <email> <role> "<name>"   create or re-enable, prints a password
//   node scripts/staff.mjs role <email> <role>           change a role
//   node scripts/staff.mjs disable <email>               take all access away, now
//   node scripts/staff.mjs list
//
// Roles: admin, operations, control_room, fleet, safety, support, finance
//
// Against the cloud project instead of the local stack:
//   NOVA_API_URL=https://<ref>.supabase.co NOVA_SERVICE_KEY=... \
//   NOVA_DB_URL="postgresql://..." node scripts/staff.mjs list
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const ROLES = ["admin", "operations", "control_room", "fleet", "safety", "support", "finance", "inspector"];
const DB = process.env.NOVA_DB_CONTAINER ?? "supabase_db_driver_app";
const DB_URL = process.env.NOVA_DB_URL ?? "";

function psql(sql) {
  const args = DB_URL
    ? ["exec", DB, "psql", DB_URL, "-tA", "-c", sql]
    : ["exec", DB, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-c", sql];
  return execFileSync("docker", args).toString().trim();
}
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

function localKeys() {
  const keys = {};
  const out = execFileSync("npx", ["supabase", "status", "-o", "env"], {
    shell: true,
    stdio: ["ignore", "pipe", "ignore"],
  }).toString();
  for (const line of out.split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) keys[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replaceAll('"', "");
  }
  return keys;
}

const [, , command, ...rest] = process.argv;

function usage(msg) {
  if (msg) console.error(msg + "\n");
  console.log(`Nova staff accounts

  add <email> <role> "<name>"   create an account (or re-enable one) and print its password
  role <email> <role>           change someone's role
  disable <email>               remove all access immediately
  list                          everyone with a role

  roles: ${ROLES.join(", ")}`);
  process.exit(msg ? 1 : 0);
}

async function add(email, role, name) {
  if (!email || !role || !name) usage("add needs an email, a role and a name.");
  if (!ROLES.includes(role)) usage(`Unknown role '${role}'.`);

  const api = process.env.NOVA_API_URL ?? "http://127.0.0.1:54321";
  const service = process.env.NOVA_SERVICE_KEY ?? localKeys().SERVICE_ROLE_KEY;

  let userId = psql(`select id from auth.users where lower(email) = lower(${lit(email)});`);
  // A generated password, shown once. Staff change it after first sign-in; it
  // is never chosen by whoever runs this script, so it is never "Nova2026".
  const password = crypto.randomBytes(12).toString("base64url");

  if (!userId) {
    const res = await fetch(`${api}/auth/v1/admin/users`, {
      method: "POST",
      headers: { apikey: service, Authorization: `Bearer ${service}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`could not create the account: ${JSON.stringify(body)}`);
    userId = body.id;
    console.log(`account created for ${email}`);
    console.log(`password (shown once): ${password}`);
  } else {
    console.log(`${email} already has an account - their password is unchanged`);
  }

  psql(`insert into public.staff_members (user_id, role, display_name, active)
        values (${lit(userId)}, ${lit(role)}, ${lit(name)}, true)
        on conflict (user_id) do update
          set role = excluded.role, display_name = excluded.display_name, active = true;`);
  psql(`insert into public.audit_log (actor_name, action, target_type, target_id, detail)
        values ('staff.mjs', 'staff.grant', 'staff', ${lit(userId)},
                jsonb_build_object('email', ${lit(email)}, 'role', ${lit(role)}));`);
  console.log(`${name} <${email}> is ${role}`);
}

function setRole(email, role) {
  if (!ROLES.includes(role)) usage(`Unknown role '${role}'.`);
  const n = psql(`with u as (select id from auth.users where lower(email) = lower(${lit(email)}))
                  update public.staff_members set role = ${lit(role)}
                   where user_id in (select id from u) returning 1;`);
  if (!n) usage(`${email} is not staff.`);
  psql(`insert into public.audit_log (actor_name, action, target_type, target_id, detail)
        select 'staff.mjs', 'staff.role', 'staff', id::text, jsonb_build_object('email', ${lit(email)}, 'role', ${lit(role)})
          from auth.users where lower(email) = lower(${lit(email)});`);
  console.log(`${email} is now ${role}`);
}

function disable(email) {
  const n = psql(`with u as (select id from auth.users where lower(email) = lower(${lit(email)}))
                  update public.staff_members set active = false
                   where user_id in (select id from u) returning 1;`);
  if (!n) usage(`${email} is not staff.`);
  psql(`insert into public.audit_log (actor_name, action, target_type, target_id, detail)
        select 'staff.mjs', 'staff.disable', 'staff', id::text, jsonb_build_object('email', ${lit(email)})
          from auth.users where lower(email) = lower(${lit(email)});`);
  // is_staff() is read on every call, so this takes effect on their very next
  // request - there is no session to wait out.
  console.log(`${email} has no staff access from their next request`);
}

function list() {
  const rows = psql(`select s.display_name || ' | ' || u.email || ' | ' || s.role || ' | ' ||
                            case when s.active then 'active' else 'disabled' end
                       from public.staff_members s join auth.users u on u.id = s.user_id
                      order by s.active desc, s.role, s.display_name;`);
  console.log(rows || "No staff yet. Add the first admin with: node scripts/staff.mjs add <email> admin \"<name>\"");
}

switch (command) {
  case "add":
    await add(rest[0], rest[1], rest[2]);
    break;
  case "role":
    setRole(rest[0], rest[1]);
    break;
  case "disable":
    disable(rest[0]);
    break;
  case "list":
    list();
    break;
  default:
    usage();
}
