import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { TRANSITIONS } from "../../src/trip/transitions";

/**
 * The legality rules exist in TypeScript (for instant client feedback) and in
 * SQL (for enforcement). This test makes drift between them a build failure.
 */
describe("TS/SQL transition parity", () => {
  it("matches the rows seeded in 0006_transition_fn.sql", () => {
    const sql = readFileSync(
      new URL("../../../../supabase/migrations/0006_transition_fn.sql", import.meta.url),
      "utf8",
    );

    const insertBlock = sql
      .split("insert into public.trip_transition_rules (from_state, to_state, actor) values")[1]
      ?.split(";")[0];

    expect(insertBlock, "seed block not found in migration").toBeDefined();

    const sqlRules = [...insertBlock!.matchAll(/\(\s*'(\w+)'\s*,\s*'(\w+)'\s*,\s*'(\w+)'\s*\)/g)]
      .map((m) => `${m[1]}>${m[2]}>${m[3]}`)
      .sort();

    const tsRules = TRANSITIONS.flatMap((r) =>
      r.actors.map((a) => `${r.from}>${r.to}>${a}`),
    ).sort();

    expect(sqlRules).toEqual(tsRules);
  });
});
