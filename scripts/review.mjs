// The driver desk.
//
// Onboarding put documents in a bucket and left drivers at `submitted`. Nothing
// in the product could move them past it, so no driver could ever go online
// without someone hand-writing SQL. This is that job, made ordinary.
//
// Everything here runs as service_role through the database functions, which
// hold the rules - notably "a driver is not verified until every document is
// approved", which lives in verify_driver so a reviewer in a hurry cannot skip
// it.
//
//   node scripts/review.mjs queue
//   node scripts/review.mjs show <driver-id>
//   node scripts/review.mjs doc <driver-id> <kind> approve
//   node scripts/review.mjs doc <driver-id> <kind> reject "Photo is blurred"
//   node scripts/review.mjs verify <driver-id>
//   node scripts/review.mjs suspend <driver-id> "Reason"
//   node scripts/review.mjs credit <driver-id> 5000 "MoMo ref 884213"
//   node scripts/review.mjs balance <driver-id>
//
// Against the cloud project instead of the local stack:
//   GERA_DB_URL="postgresql://..." node scripts/review.mjs queue
import { execFileSync } from "node:child_process";

const DB = process.env.GERA_DB_CONTAINER ?? "supabase_db_driver_app";
const DB_URL = process.env.GERA_DB_URL ?? "";

function psql(sql) {
  const args = DB_URL
    ? ["exec", DB, "psql", DB_URL, "-tA", "-c", sql]
    : ["exec", DB, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-c", sql];
  return execFileSync("docker", args).toString().trim();
}

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

const KINDS = ["national_id", "driving_licence", "vehicle_registration", "insurance"];

const [, , command, ...rest] = process.argv;

function usage() {
  console.log(`
The Gera driver desk.

  queue                                  everyone waiting on a decision
  show <driver-id>                       one driver in full
  doc <driver-id> <kind> approve         approve a document
  doc <driver-id> <kind> reject "<why>"  reject it, with a reason the driver sees
  verify <driver-id>                     verify - refused unless all documents pass
  suspend <driver-id> "<reason>"         stop them driving, immediately
  credit <driver-id> <rwf> "<reference>" top up their wallet
  balance <driver-id>                    what they have left

  kinds: ${KINDS.join(", ")}
`);
}

function queue() {
  const rows = psql(`
    select driver_id || '|' || coalesce(first_name,'?') || '|' || coalesce(phone,'?')
           || '|' || verification || '|' || coalesce(vehicle_class,'-')
           || '|' || coalesce(plate,'-') || '|' || balance_rwf
           || '|' || (select count(*) from jsonb_each(documents) where value->>'status' = 'approved')
      from public.review_queue();`);

  if (!rows) {
    console.log("\nNobody is waiting.\n");
    return;
  }

  console.log("\nWaiting on a decision:\n");
  for (const line of rows.split("\n")) {
    const [id, name, phone, verification, cls, plate, balance, approved] = line.split("|");
    console.log(`  ${name}  ${phone}`);
    console.log(`    ${id}`);
    console.log(
      `    ${verification} · ${cls} ${plate} · wallet ${Number(balance).toLocaleString()} RWF` +
        ` · ${approved}/${KINDS.length} documents approved`,
    );
    console.log("");
  }
}

function show(id) {
  const row = psql(`
    select coalesce(first_name,'?') || '|' || coalesce(phone,'?') || '|' || verification
           || '|' || coalesce(vehicle_class,'-') || '|' || coalesce(plate,'-')
           || '|' || balance_rwf || '|' || documents::text
      from public.review_queue() where driver_id = ${lit(id)};`);

  if (!row) {
    // Not in the queue means either no such driver, or already verified.
    const verified = psql(
      `select verification from public.drivers where id = ${lit(id)};`);
    console.log(verified ? `\nDriver is ${verified}.\n` : "\nNo such driver.\n");
    return;
  }

  const [name, phone, verification, cls, plate, balance, docs] = row.split("|");
  console.log(`\n${name}  ${phone}`);
  console.log(`${verification} · ${cls} ${plate} · wallet ${Number(balance).toLocaleString()} RWF\n`);

  const parsed = JSON.parse(docs);
  for (const kind of KINDS) {
    const d = parsed[kind];
    console.log(`  ${kind.padEnd(22)} ${d ? d.status : "not uploaded"}`);
    if (d) console.log(`  ${" ".repeat(22)} ${d.path}`);
  }
  console.log("");
  console.log("  Download a document to look at it:");
  console.log(`    supabase storage download ss:///driver-documents/${id}/<file> ./<file>`);
  console.log("");
}

function doc(id, kind, decision, note) {
  if (!KINDS.includes(kind)) {
    console.error(`Unknown kind '${kind}'. One of: ${KINDS.join(", ")}`);
    process.exit(1);
  }
  const approve = decision === "approve";
  if (!approve && decision !== "reject") {
    console.error("Decision must be 'approve' or 'reject'.");
    process.exit(1);
  }
  if (!approve && !note) {
    // A rejection without a reason makes the driver guess, and they will
    // re-upload the same photo.
    console.error("A rejection needs a reason - the driver is shown it.");
    process.exit(1);
  }

  psql(`select public.review_document(${lit(id)}, ${lit(kind)}::document_kind,
          ${approve}, ${note ? lit(note) : "null"});`);
  console.log(`${kind}: ${approve ? "approved" : "rejected"}`);

  if (approve) {
    const left = psql(`
      select count(*) from unnest(enum_range(null::document_kind)) k(kind)
       where not exists (select 1 from public.driver_documents d
                          where d.driver_id = ${lit(id)} and d.kind = k.kind
                            and d.status = 'approved');`);
    console.log(
      Number(left) === 0
        ? "All documents approved - run `verify` to let them go online."
        : `${left} document(s) still outstanding.`,
    );
  }
}

function verify(id) {
  const result = psql(`select public.verify_driver(${lit(id)});`);
  console.log(result);
  if (result === "verified") {
    const balance = Number(psql(`select public.driver_balance(${lit(id)});`));
    const canGo = psql(`select public.can_go_online(${lit(id)});`);
    console.log(`wallet ${balance.toLocaleString()} RWF · can go online: ${canGo}`);
    if (canGo !== "t") {
      console.log("They are verified but cannot go online yet - top the wallet up:");
      console.log(`  node scripts/review.mjs credit ${id} 5000 "<reference>"`);
    }
  }
}

function main() {
  switch (command) {
    case "queue":
      return queue();
    case "show":
      if (!rest[0]) return usage();
      return show(rest[0]);
    case "doc":
      if (rest.length < 3) return usage();
      return doc(rest[0], rest[1], rest[2], rest[3]);
    case "verify":
      if (!rest[0]) return usage();
      return verify(rest[0]);
    case "suspend":
      if (rest.length < 2) return usage();
      psql(`select public.suspend_driver(${lit(rest[0])}, ${lit(rest[1])});`);
      return console.log("Suspended and taken offline.");
    case "credit": {
      if (rest.length < 3) return usage();
      const balance = psql(
        `select public.credit_driver_wallet(${lit(rest[0])}, ${Number(rest[1])}, ${lit(rest[2])});`);
      return console.log(`wallet is now ${Number(balance).toLocaleString()} RWF`);
    }
    case "balance":
      if (!rest[0]) return usage();
      return console.log(
        `${Number(psql(`select public.driver_balance(${lit(rest[0])});`)).toLocaleString()} RWF`);
    default:
      return usage();
  }
}

try {
  main();
} catch (e) {
  console.error(e.stderr?.toString?.().trim() || e.message);
  process.exit(1);
}
