// The rider desk.
//
// Onboarding put documents in a bucket and left riders at `submitted`. Nothing
// in the product could move them past it, so no rider could ever go online
// without someone hand-writing SQL. This is that job, made ordinary.
//
// Everything here runs as service_role through the database functions, which
// hold the rules - notably "a rider is not verified until every document is
// approved", which lives in verify_rider so a reviewer in a hurry cannot skip
// it.
//
//   node scripts/review.mjs queue
//   node scripts/review.mjs show <rider-id>
//   node scripts/review.mjs doc <rider-id> <kind> approve
//   node scripts/review.mjs doc <rider-id> <kind> reject "Photo is blurred"
//   node scripts/review.mjs verify <rider-id>
//   node scripts/review.mjs suspend <rider-id> "Reason"
//   node scripts/review.mjs remit <rider-id> 5000 "MoMo ref 884213"
//   node scripts/review.mjs pay <rider-id> 12000 "Week 40 payout"
//   node scripts/review.mjs bonus <rider-id> 500 "Weekend cover"
//   node scripts/review.mjs deduct <rider-id> 2000 "Damaged mirror"
//   node scripts/review.mjs money <rider-id>
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
The Gera rider desk.

  queue                                  everyone waiting on a decision
  show <rider-id>                       one rider in full
  doc <rider-id> <kind> approve         approve a document
  doc <rider-id> <kind> reject "<why>"  reject it, with a reason the rider sees
  verify <rider-id>                     verify - refused unless all documents pass
  suspend <rider-id> "<reason>"         stop them driving, immediately
  remit <rider-id> <rwf> "<ref>"        record cash they handed in
  pay <rider-id> <rwf> "<ref>"          pay them what they are owed
  bonus <rider-id> <rwf> "<why>"        add a bonus
  deduct <rider-id> <rwf> "<why>"       take a deduction
  money <rider-id>                      cash they carry, and what we owe them

  kinds: ${KINDS.join(", ")}
`);
}

function queue() {
  const rows = psql(`
    select rider_id || '|' || coalesce(first_name,'?') || '|' || coalesce(phone,'?')
           || '|' || verification || '|' || coalesce(vehicle_class,'-')
           || '|' || coalesce(plate,'-') || '|' || cash_held_rwf
           || '|' || (select count(*) from jsonb_each(documents) where value->>'status' = 'approved')
      from public.review_queue();`);

  if (!rows) {
    console.log("\nNobody is waiting.\n");
    return;
  }

  console.log("\nWaiting on a decision:\n");
  for (const line of rows.split("\n")) {
    const [id, name, phone, verification, cls, plate, cash, approved] = line.split("|");
    console.log(`  ${name}  ${phone}`);
    console.log(`    ${id}`);
    console.log(
      `    ${verification} · ${cls} ${plate} · carrying ${Number(cash).toLocaleString()} RWF` +
        ` · ${approved}/${KINDS.length} documents approved`,
    );
    console.log("");
  }
}

function show(id) {
  const row = psql(`
    select coalesce(first_name,'?') || '|' || coalesce(phone,'?') || '|' || verification
           || '|' || coalesce(vehicle_class,'-') || '|' || coalesce(plate,'-')
           || '|' || cash_held_rwf || '|' || documents::text
      from public.review_queue() where rider_id = ${lit(id)};`);

  if (!row) {
    // Not in the queue means either no such rider, or already verified.
    const verified = psql(
      `select verification from public.riders where id = ${lit(id)};`);
    console.log(verified ? `\nRider is ${verified}.\n` : "\nNo such rider.\n");
    return;
  }

  const [name, phone, verification, cls, plate, cash, docs] = row.split("|");
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
  console.log(`    supabase storage download ss:///rider-documents/${id}/<file> ./<file>`);
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
    // A rejection without a reason makes the rider guess, and they will
    // re-upload the same photo.
    console.error("A rejection needs a reason - the rider is shown it.");
    process.exit(1);
  }

  psql(`select public.review_document(${lit(id)}, ${lit(kind)}::document_kind,
          ${approve}, ${note ? lit(note) : "null"});`);
  console.log(`${kind}: ${approve ? "approved" : "rejected"}`);

  if (approve) {
    const left = psql(`
      select count(*) from unnest(enum_range(null::document_kind)) k(kind)
       where not exists (select 1 from public.rider_documents d
                          where d.rider_id = ${lit(id)} and d.kind = k.kind
                            and d.status = 'approved');`);
    console.log(
      Number(left) === 0
        ? "All documents approved - run `verify` to let them go online."
        : `${left} document(s) still outstanding.`,
    );
  }
}

function verify(id) {
  const result = psql(`select public.verify_rider(${lit(id)});`);
  console.log(result);
  if (result === "verified") {
    const canGo = psql(`select public.can_go_online(${lit(id)});`);
    console.log(`can go online: ${canGo}`);
    if (canGo !== "t") {
      // Two different reasons, and telling them the wrong one wastes a day.
      const hasVehicle = psql(
        `select exists(select 1 from public.vehicles where rider_id=${lit(id)} and is_active);`);
      console.log(
        hasVehicle === "t"
          ? "Verified, but carrying too much cash. Record a remittance first."
          : "Verified, but no vehicle assigned yet. Assign one before they can work.",
      );
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
      psql(`select public.suspend_rider(${lit(rest[0])}, ${lit(rest[1])});`);
      return console.log("Suspended and taken offline.");
    case "remit": {
      if (rest.length < 3) return usage();
      const held = psql(
        `select public.record_remittance(${lit(rest[0])}, ${Number(rest[1])}, ${lit(rest[2])});`);
      return console.log(`still carrying ${Number(held).toLocaleString()} RWF`);
    }
    case "pay": {
      if (rest.length < 3) return usage();
      const owed = psql(
        `select public.pay_rider(${lit(rest[0])}, ${Number(rest[1])}, ${lit(rest[2])});`);
      return console.log(`still owed ${Number(owed).toLocaleString()} RWF`);
    }
    case "bonus":
    case "deduct": {
      if (rest.length < 3) return usage();
      const kind = command === "bonus" ? "bonus" : "deduction";
      const owed = psql(
        `select public.adjust_rider_earnings(${lit(rest[0])}, ${Number(rest[1])},` +
        ` ${lit(kind)}::ledger_entry_kind, ${lit(rest[2])});`);
      return console.log(`now owed ${Number(owed).toLocaleString()} RWF`);
    }
    case "money": {
      if (!rest[0]) return usage();
      // Two numbers, never netted. One is ours and has to come back; the other
      // is theirs and has to go out.
      const held = Number(psql(`select public.rider_cash_held(${lit(rest[0])});`));
      const owed = Number(psql(`select public.rider_net_owed(${lit(rest[0])});`));
      console.log(`  carrying (ours):  ${held.toLocaleString()} RWF`);
      console.log(`  owed (theirs):    ${owed.toLocaleString()} RWF`);
      return;
    }
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
