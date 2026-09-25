import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { balanceOf, canGoOnline, type LedgerEntry } from "../../src/ledger/commission";

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

/**
 * The credit/debit classification exists in TypeScript (for the apps) and in
 * SQL (for the go-online gate, which the database must enforce). Duplication is
 * deliberate; this test is what makes drift between them impossible.
 */
describe("rider_balance SQL mirrors balanceOf", () => {
  const cases: { label: string; entries: LedgerEntry[] }[] = [
    { label: "empty", entries: [] },
    { label: "single top-up", entries: [{ kind: "topup_credit", amountRwf: 5000 }] },
    {
      label: "top-up minus commission",
      entries: [
        { kind: "topup_credit", amountRwf: 5000 },
        { kind: "commission_debit", amountRwf: 255 },
      ],
    },
    {
      label: "all four kinds",
      entries: [
        { kind: "topup_credit", amountRwf: 1000 },
        { kind: "adjustment_credit", amountRwf: 100 },
        { kind: "commission_debit", amountRwf: 400 },
        { kind: "adjustment_debit", amountRwf: 50 },
      ],
    },
    {
      label: "in arrears",
      entries: [
        { kind: "topup_credit", amountRwf: 100 },
        { kind: "commission_debit", amountRwf: 300 },
      ],
    },
  ];

  for (const { label, entries } of cases) {
    it(`agrees with SQL: ${label}`, () => {
      const rows = entries
        .map((e) => `('11111111-2222-4333-8444-555555555555','${e.kind}',${e.amountRwf})`)
        .join(",");

      const insert = rows
        ? `insert into public.ledger_entries (rider_id, kind, amount_rwf) values ${rows};`
        : "";

      const out = sql(`
        begin;
        insert into auth.users (instance_id,id,aud,role,email) values
          ('00000000-0000-0000-0000-000000000000',
           '11111111-2222-4333-8444-555555555555',
           'authenticated','authenticated','parity@test.local');
        insert into public.profiles (id,role,first_name,phone) values
          ('11111111-2222-4333-8444-555555555555','rider','P','+250788999001');
        insert into public.riders (id,verification) values
          ('11111111-2222-4333-8444-555555555555','verified');
        ${insert}
        select public.rider_balance('11111111-2222-4333-8444-555555555555');
        rollback;
      `);

      const sqlBalance = Number(out.split("\n").filter(Boolean).pop());
      expect(sqlBalance).toBe(balanceOf(entries));
    });
  }

  it("agrees with SQL on the go-online threshold", () => {
    const out = sql(`select min_rider_balance_rwf from public.platform_settings;`);
    const minimum = Number(out);
    expect(canGoOnline(minimum, minimum)).toBe(true);
    expect(canGoOnline(minimum - 1, minimum)).toBe(false);
  });
});
