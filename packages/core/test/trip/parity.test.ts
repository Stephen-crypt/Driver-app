import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { TRANSITIONS } from "../../src/trip/transitions";
import { TRIP_STATES, TERMINAL_STATES, isTerminal } from "../../src/trip/states";
import { VEHICLE_CLASSES } from "../../src/fare/policy";
import { LEDGER_ENTRY_KINDS } from "../../src/ledger/commission";
import { OFFER_TTL_SECONDS } from "../../src/dispatch/eta";

function migration(file: string): string {
  return readFileSync(
    new URL(`../../../../supabase/migrations/${file}`, import.meta.url),
    "utf8",
  );
}

/** Every quoted word inside the first parenthesised group after `marker`. */
function quotedAfter(sql: string, marker: string): string[] {
  const tail = sql.split(marker)[1];
  expect(tail, `marker not found: ${marker}`).toBeDefined();
  const group = tail!.split(")")[0]!;
  return [...group.matchAll(/'(\w+)'/g)].map((m) => m[1]!);
}

/**
 * Each of these rules exists twice: in TypeScript, for instant client feedback,
 * and in SQL, for enforcement. Drift between the two copies is silent and
 * dangerous, so every duplicated list is asserted here rather than only the
 * transition table.
 */
describe("TS/SQL transition parity", () => {
  it("matches the rows seeded in 0006_transition_fn.sql", () => {
    const sql = migration("0006_transition_fn.sql");

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

describe("TS/SQL terminal state parity", () => {
  it("TERMINAL_STATES matches is_terminal() in 0006_transition_fn.sql", () => {
    const sqlTerminal = quotedAfter(
      migration("0006_transition_fn.sql"),
      "select p_state in (",
    ).sort();

    expect(sqlTerminal).toEqual([...TERMINAL_STATES].sort());
  });

  it("classifies every one of the ten states", () => {
    const terminal = new Set<string>(TERMINAL_STATES);

    // Not a restatement of TERMINAL_STATES: it walks TRIP_STATES, so a state
    // added to the machine without being classified fails here.
    for (const state of TRIP_STATES) {
      expect(isTerminal(state), state).toBe(terminal.has(state));
    }

    expect(TRIP_STATES).toHaveLength(10);
  });
});

describe("TS/SQL enum parity", () => {
  it("VEHICLE_CLASSES matches the vehicle_class enum in 0001", () => {
    const sqlClasses = quotedAfter(
      migration("0001_extensions_and_enums.sql"),
      "create type vehicle_class as enum (",
    ).sort();

    expect(sqlClasses).toEqual([...VEHICLE_CLASSES].sort());
  });

  it("LEDGER_ENTRY_KINDS matches the ledger_entry_kind enum in 0001", () => {
    const sqlKinds = quotedAfter(
      migration("0001_extensions_and_enums.sql"),
      "create type ledger_entry_kind as enum (",
    ).sort();

    expect(sqlKinds).toEqual([...LEDGER_ENTRY_KINDS].sort());
  });
});

describe("TS/SQL dispatch constant parity", () => {
  it("OFFER_TTL_SECONDS matches offer_ttl_seconds() in 0020_dispatch_chain.sql", () => {
    // The sweeper creates offers now, and it never sees a TypeScript constant,
    // so the TTL had to be authored a second time in SQL. Two copies of the
    // number that decides how long a driver holds a trip is exactly the drift
    // this file exists to make impossible - and 017_dispatch_chain.test.sql
    // asserts the cron sweep interval is shorter than the SQL copy, so a silent
    // divergence here would quietly un-tune that guard too.
    const sql = migration("0020_dispatch_chain.sql");

    const body = sql
      .split("create or replace function public.offer_ttl_seconds()")[1]
      ?.split("$$")[1];

    expect(body, "offer_ttl_seconds() body not found in migration").toBeDefined();

    const literal = body!.match(/select\s+(\d+)\s*;/)?.[1];
    expect(literal, "offer_ttl_seconds() does not return a plain literal").toBeDefined();
    expect(Number(literal)).toBe(OFFER_TTL_SECONDS);
  });
});
