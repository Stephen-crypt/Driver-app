import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { waitingChargeFor, graceRemaining } from "../../src/trip/waiting";
import { SHIFT_CHECKS } from "../../src/trip/shift";

const DB_CONTAINER = process.env.NOVA_DB_CONTAINER ?? "supabase_db_driver_app";

function sql(query: string): string {
  return execFileSync("docker", [
    "exec", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-q", "-c", query,
  ]).toString().trim();
}

/**
 * The app draws the waiting clock and the shift checklist; the database bills
 * the one and enforces the other. These prove the two copies agree - against
 * the live schema, not a frozen migration file.
 */
describe("waiting charge parity", () => {
  // Either side of every boundary: the grace itself, the first whole minute,
  // and a long wait.
  const cases = [
    [0, 300, 50], [299, 300, 50], [300, 300, 50], [301, 300, 50],
    [359, 300, 50], [360, 300, 50], [419, 300, 50], [420, 300, 50],
    [1000, 300, 50], [3600, 300, 75], [120, 0, 50], [59, 0, 50],
  ] as const;

  it("waitingChargeFor() matches waiting_charge_rwf() on every case", () => {
    const query = cases
      .map(([w, g, p]) => `select public.waiting_charge_rwf(${w}, ${g}, ${p});`)
      .join("\n");
    const fromSql = sql(query).split("\n").filter(Boolean).map(Number);
    expect(fromSql).toEqual(cases.map(([w, g, p]) => waitingChargeFor(w, g, p)));
  });

  it("counts free time down to zero and no further", () => {
    expect(graceRemaining(0, 300)).toBe(300);
    expect(graceRemaining(299, 300)).toBe(1);
    expect(graceRemaining(900, 300)).toBe(0);
  });
});

describe("shift checklist parity", () => {
  it("SHIFT_CHECKS is exactly what start_shift() demands, in order", () => {
    const fromSql = sql("select array_to_string(public.shift_check_keys(), ',');").split(",");
    expect(SHIFT_CHECKS.map((c) => c.key)).toEqual(fromSql);
  });
});
