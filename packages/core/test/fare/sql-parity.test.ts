import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { finalizeFare } from "../../src/fare/finalize";
import { roundFareRwf, type FarePolicy } from "../../src/fare/policy";
import { commissionFor } from "../../src/ledger/commission";

/**
 * The guard that makes the SQL copy of the fare arithmetic safe.
 *
 * Phase 2a was built on "the arithmetic is authored once, in packages/core, and
 * never duplicated in SQL". That was wrong: complete_trip is granted to
 * `authenticated`, so any rider can call it straight through PostgREST and
 * hand it whatever amounts they like. A rule the database must enforce has to
 * live in the database, so 0014_lock_trip_writes.sql derives the money in SQL -
 * and this file is what stops the two copies drifting.
 *
 * It runs BOTH copies over the same table of cases: the TypeScript in-process,
 * the SQL against the live local database through `docker exec ... psql`. There
 * is deliberately no skip-when-unavailable branch: a parity guard that quietly
 * disappears when the stack is down is not a guard. If this file cannot reach
 * the database it fails, and the message says how to bring it back.
 */

/**
 * The local database container. Its name is derived from the checkout's
 * directory name, so a checkout named anything else - or a CI runner that
 * reaches its database another way - must set GERA_DB_CONTAINER. The test stays
 * mandatory either way; only where it looks is configurable.
 */
const CONTAINER = process.env.GERA_DB_CONTAINER ?? "supabase_db_driver_app";

function psql(sql: string): string {
  try {
    return execFileSync(
      "docker",
      [
        "exec", CONTAINER,
        "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-tA", "-c", sql,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  } catch (error) {
    throw new Error(
      `could not run psql in ${CONTAINER}. This test compares the SQL fare ` +
        `functions against packages/core, so it needs the local Supabase stack ` +
        `running and migrated (\`pnpm dlx supabase@latest db reset\`).\n` +
        `Underlying failure: ${(error as Error).message}`,
    );
  }
}

interface Case {
  readonly name: string;
  readonly quotedRwf: number;
  readonly quotedDistanceM: number;
  readonly actualDistanceM: number;
  readonly perKmRwf: number;
  readonly commissionPct: number;
}

/**
 * Every case names the property it pins. Two commission rates are exercised
 * because a single rate cannot tell a percentage apart from a constant.
 */
const CASES: readonly Case[] = [
  // The ordinary trip: actual distance equals the quote, so the passenger pays the
  // number they were shown.
  { name: "exact-quote moto trip", quotedRwf: 1700, quotedDistanceM: 4000, actualDistanceM: 4000, perKmRwf: 250, commissionPct: 15 },
  // Shorter than quoted: the quote is a lock, not a meter - no refund either.
  { name: "shorter than quoted", quotedRwf: 1700, quotedDistanceM: 4000, actualDistanceM: 3000, perKmRwf: 250, commissionPct: 15 },
  // Inside the 15% tolerance band: absorbed.
  { name: "detour inside the tolerance band", quotedRwf: 1700, quotedDistanceM: 4000, actualDistanceM: 4500, perKmRwf: 250, commissionPct: 15 },
  // Exactly at the band edge (4000 x 1.15 = 4600): the last free metre.
  { name: "exactly at the band edge", quotedRwf: 1700, quotedDistanceM: 4000, actualDistanceM: 4600, perKmRwf: 250, commissionPct: 15 },
  // One metre past it. The overage rounds up to a whole hundred, so this metre
  // costs 100 RWF - a cliff, and both copies must fall off it identically.
  { name: "one metre past the band edge", quotedRwf: 1700, quotedDistanceM: 4000, actualDistanceM: 4601, perKmRwf: 250, commissionPct: 15 },
  // Well beyond the band, at the second commission rate.
  { name: "well beyond the band, 20% commission", quotedRwf: 1700, quotedDistanceM: 4000, actualDistanceM: 5600, perKmRwf: 250, commissionPct: 20 },
  // A zero-distance trip still owes the quoted minimum.
  { name: "zero-distance trip", quotedRwf: 700, quotedDistanceM: 0, actualDistanceM: 0, perKmRwf: 250, commissionPct: 15 },
  // A minimum-fare trip that then runs past its (tiny) band: 200 x 1.15 = 230.
  { name: "minimum-fare trip that overruns", quotedRwf: 700, quotedDistanceM: 200, actualDistanceM: 1230, perKmRwf: 250, commissionPct: 15 },
  // A cab, so the per-km rate and the fare are both different.
  { name: "long cab detour, 20% commission", quotedRwf: 8000, quotedDistanceM: 12000, actualDistanceM: 20000, perKmRwf: 600, commissionPct: 20 },
  // A fare whose commission lands on a half franc: 15% of 1750 = 262.5.
  { name: "commission landing on a half franc", quotedRwf: 1750, quotedDistanceM: 4000, actualDistanceM: 4000, perKmRwf: 250, commissionPct: 15 },
  // A rate at which the two copies USED to disagree. 1000 RWF/km with a 16100m
  // overage (band ends at 4600m on a 4000m quote): the TypeScript divided by
  // 1000 in binary floating point first and charged 16200, the exact-numeric SQL
  // charged 16100. The seeded rates (250/600/800) are not affected, so only a
  // case at a multiple of 125 catches it - which is why this one is here.
  { name: "1000 RWF/km, the rate where float and numeric split", quotedRwf: 8000, quotedDistanceM: 4000, actualDistanceM: 20700, perKmRwf: 1000, commissionPct: 15 },
];

function policyFor(c: Case): FarePolicy {
  return {
    vehicleClass: "moto",
    baseRwf: 400,
    perKmRwf: c.perKmRwf,
    perMinuteRwf: 20,
    minimumRwf: 700,
    commissionPct: c.commissionPct,
  };
}

/** One round trip for the whole table: `idx|total|commission` per case. */
function sqlResults(): Map<number, { total: number; commission: number }> {
  const values = CASES.map(
    (c, i) =>
      `(${i},${c.quotedRwf},${c.quotedDistanceM},${c.actualDistanceM},` +
      `${c.perKmRwf},${c.commissionPct.toFixed(2)})`,
  ).join(",");

  const out = psql(
    `select c.idx,
            public.final_fare_rwf(c.quoted, c.qdist, c.adist, c.perkm),
            public.commission_rwf(
              public.final_fare_rwf(c.quoted, c.qdist, c.adist, c.perkm), c.pct)
       from (values ${values})
         as c(idx, quoted, qdist, adist, perkm, pct)
      order by c.idx;`,
  );

  const rows = out.split("\n").filter((line) => line.trim() !== "");
  const parsed = new Map<number, { total: number; commission: number }>();
  for (const row of rows) {
    const [idx, total, commission] = row.split("|");
    parsed.set(Number(idx), { total: Number(total), commission: Number(commission) });
  }
  return parsed;
}

describe("TS/SQL fare parity", () => {
  it("finds the SQL mirrors installed by 0014_lock_trip_writes.sql", () => {
    const names = psql(
      `select proname from pg_proc
        where proname in ('round_fare_rwf','final_fare_rwf','commission_rwf')
        order by proname;`,
    ).split("\n").map((s) => s.trim()).filter(Boolean);

    expect(names).toEqual(["commission_rwf", "final_fare_rwf", "round_fare_rwf"]);
  });

  const results = () => sqlResults();

  it("final_fare_rwf() matches finalizeFare() on every case", () => {
    const sql = results();
    expect(sql.size).toBe(CASES.length);

    for (const [i, c] of CASES.entries()) {
      const ts = finalizeFare(
        policyFor(c), c.quotedRwf, c.quotedDistanceM, c.actualDistanceM,
      );
      expect(sql.get(i)!.total, `${c.name}: SQL total != finalizeFare total`)
        .toBe(ts.totalRwf);
    }
  });

  it("commission_rwf() matches commissionFor() on every case", () => {
    const sql = results();

    for (const [i, c] of CASES.entries()) {
      const ts = finalizeFare(
        policyFor(c), c.quotedRwf, c.quotedDistanceM, c.actualDistanceM,
      );
      expect(
        sql.get(i)!.commission,
        `${c.name}: SQL commission != commissionFor(${ts.totalRwf}, ${c.commissionPct})`,
      ).toBe(commissionFor(ts.totalRwf, c.commissionPct));
    }
  });

  it("round_fare_rwf() matches roundFareRwf() across the rounding boundary", () => {
    const amounts = [0, 1, 99, 100, 101, 250, 299.5, 300, 400.0000001, 1234.56];
    const out = psql(
      `select a, public.round_fare_rwf(a)
         from unnest(array[${amounts.join(",")}]::numeric[]) as a
        order by a;`,
    );

    const sql = new Map<string, number>();
    for (const row of out.split("\n").filter((l) => l.trim() !== "")) {
      const [amount, rounded] = row.split("|");
      sql.set(String(Number(amount)), Number(rounded));
    }

    for (const amount of amounts) {
      expect(sql.get(String(amount)), `round_fare_rwf(${amount})`)
        .toBe(roundFareRwf(amount));
    }
  });

  it("covers the cases the ruling requires", () => {
    // Guards the table itself: a case deleted here is a case nobody checks.
    expect(CASES.length).toBeGreaterThanOrEqual(8);
    expect(new Set(CASES.map((c) => c.commissionPct))).toEqual(new Set([15, 20]));
    expect(CASES.some((c) => c.actualDistanceM === c.quotedDistanceM)).toBe(true);
    expect(CASES.some((c) => c.actualDistanceM === 0)).toBe(true);
    expect(
      CASES.some((c) => c.actualDistanceM === Math.round(c.quotedDistanceM * 1.15)),
    ).toBe(true);
  });
});
