import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import {
  cashHeldOf,
  netOwedOf,
  canGoOnline,
  type LedgerEntry,
} from "../../src/ledger/entries";

const DB_CONTAINER = process.env.GERA_DB_CONTAINER ?? "supabase_db_driver_app";

function sql(query: string): string {
  // -q (quiet) suppresses psql's per-statement command tags (BEGIN,
  // INSERT 0 1, ROLLBACK) in a multi-statement -c batch. Without it the last
  // line of output is the ROLLBACK tag, not the SELECT result, and every
  // case below parses to NaN.
  return execFileSync("docker", [
    "exec", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-q", "-c", query,
  ]).toString().trim();
}

const RIDER = "11111111-2222-4333-8444-555555555555";

/**
 * The ledger classification exists in TypeScript (for the apps) and in SQL (for
 * the go-online gate, which the database must enforce). Duplication is
 * deliberate; this file is what makes drift between them impossible.
 *
 * Both readings are checked on the same rows. Checking only one would let the
 * other silently mis-sign a kind - and the two disagree on purpose: a
 * remittance moves cash without touching what the rider is owed, and a bonus
 * moves what they are owed without touching the cash in their pocket.
 */
describe("the two ledger readings match SQL", () => {
  const cases: { label: string; entries: LedgerEntry[] }[] = [
    { label: "empty", entries: [] },
    {
      label: "one completed trip",
      entries: [
        { kind: "fare_collected", amountRwf: 1700 },
        { kind: "trip_earning", amountRwf: 1445 },
      ],
    },
    {
      label: "a day, part remitted",
      entries: [
        { kind: "fare_collected", amountRwf: 1700 },
        { kind: "trip_earning", amountRwf: 1445 },
        { kind: "fare_collected", amountRwf: 2100 },
        { kind: "trip_earning", amountRwf: 1785 },
        { kind: "cash_remittance", amountRwf: 3000 },
      ],
    },
    {
      label: "bonus and deduction",
      entries: [
        { kind: "trip_earning", amountRwf: 1445 },
        { kind: "bonus", amountRwf: 500 },
        { kind: "deduction", amountRwf: 200 },
      ],
    },
    {
      label: "paid out",
      entries: [
        { kind: "trip_earning", amountRwf: 1445 },
        { kind: "payout", amountRwf: 1445 },
      ],
    },
    {
      label: "owing the company",
      entries: [
        { kind: "trip_earning", amountRwf: 300 },
        { kind: "deduction", amountRwf: 900 },
      ],
    },
    {
      label: "retired marketplace rows",
      entries: [
        { kind: "topup_credit", amountRwf: 5000 },
        { kind: "commission_debit", amountRwf: 255 },
        { kind: "adjustment_credit", amountRwf: 100 },
        { kind: "adjustment_debit", amountRwf: 50 },
      ],
    },
  ];

  for (const { label, entries } of cases) {
    it(`agrees with SQL: ${label}`, () => {
      const rows = entries
        .map((e) => `('${RIDER}','${e.kind}',${e.amountRwf})`)
        .join(",");

      const insert = rows
        ? `insert into public.ledger_entries (rider_id, kind, amount_rwf) values ${rows};`
        : "";

      const out = sql(`
        begin;
        insert into auth.users (instance_id,id,aud,role,email) values
          ('00000000-0000-0000-0000-000000000000','${RIDER}',
           'authenticated','authenticated','parity@test.local');
        insert into public.profiles (id,role,first_name,phone) values
          ('${RIDER}','rider','P','+250788999001');
        insert into public.riders (id,verification) values ('${RIDER}','verified');
        ${insert}
        select public.rider_cash_held_internal('${RIDER}')
               || '|' || public.rider_net_owed_internal('${RIDER}');
        rollback;
      `);

      const [cash, owed] = out.split("\n").filter(Boolean).pop()!.split("|").map(Number);
      expect(cash, `${label}: cash held`).toBe(cashHeldOf(entries));
      expect(owed, `${label}: net owed`).toBe(netOwedOf(entries));
    });
  }
});

describe("the go-online gate matches SQL", () => {
  it("agrees on the cash ceiling", () => {
    const limit = Number(sql("select max_cash_held_rwf from public.platform_settings;"));

    expect(canGoOnline({ hasActiveVehicle: true, cashHeldRwf: limit, maxCashHeldRwf: limit }))
      .toBe(true);
    expect(canGoOnline({ hasActiveVehicle: true, cashHeldRwf: limit + 1, maxCashHeldRwf: limit }))
      .toBe(false);
  });

  it("agrees that no vehicle means no work, whatever the cash", () => {
    // Asserted against SQL rather than assumed: a rider with an empty ledger
    // and no vehicle must still be refused, and the database is what enforces
    // it when a rider flips their own presence row.
    const out = sql(`
      begin;
      insert into auth.users (instance_id,id,aud,role,email) values
        ('00000000-0000-0000-0000-000000000000','${RIDER}',
         'authenticated','authenticated','parity@test.local');
      insert into public.profiles (id,role,first_name,phone) values
        ('${RIDER}','rider','P','+250788999001');
      insert into public.riders (id,verification) values ('${RIDER}','verified');
      select public.can_go_online_internal('${RIDER}');
      rollback;
    `);

    const sqlSaysYes = out.split("\n").filter(Boolean).pop() === "t";
    expect(sqlSaysYes).toBe(false);
    expect(canGoOnline({ hasActiveVehicle: false, cashHeldRwf: 0, maxCashHeldRwf: 50_000 }))
      .toBe(false);
  });
});
