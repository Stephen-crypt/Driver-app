import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { TRANSITIONS } from "../../src/trip/transitions";
import { TRIP_STATES, TERMINAL_STATES, isTerminal } from "../../src/trip/states";
import { VEHICLE_CLASSES } from "../../src/fare/policy";
import { LEDGER_ENTRY_KINDS } from "../../src/ledger/commission";
import { OFFER_TTL_SECONDS } from "../../src/dispatch/eta";

/**
 * The live schema, not a migration file.
 *
 * These two assertions used to read 0006_transition_fn.sql. That worked until
 * the NOVA rename, which moved the vocabulary in a LATER migration and left
 * 0006 frozen with the old words - so the guard began comparing today's
 * TypeScript against last month's SQL and failed on a difference that was not
 * drift. A migration file is history; only the database holds the current rule.
 */
const CONTAINER = process.env.GERA_DB_CONTAINER ?? "supabase_db_driver_app";

function query(sql: string): string[] {
  let out: string;
  try {
    out = execFileSync("docker", [
      "exec", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-c", sql,
    ]).toString();
  } catch (error) {
    throw new Error(
      [
        `Could not reach the local database (container ${CONTAINER}).`,
        "Start it with: supabase start   (or set GERA_DB_CONTAINER)",
        String(error),
      ].join(String.fromCharCode(10)),
    );
  }
  return out
    .split(String.fromCharCode(10))
    .map((line) => line.trim())
    .filter(Boolean);
}

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
  it("matches the rows in trip_transition_rules", () => {
    const sqlRules = query(
      "select from_state || '>' || to_state || '>' || actor from public.trip_transition_rules;",
    ).sort();

    const tsRules = TRANSITIONS.flatMap((r) =>
      r.actors.map((a) => `${r.from}>${r.to}>${a}`),
    ).sort();

    expect(sqlRules).toEqual(tsRules);
  });
});

describe("TS/SQL terminal state parity", () => {
  it("TERMINAL_STATES matches what is_terminal() actually returns", () => {
    // Asked of the function itself rather than parsed out of its source, so it
    // cannot drift from what the database does at runtime.
    const sqlTerminal = query(
      "select s from unnest(enum_range(null::trip_state)) s where public.is_terminal(s);",
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
    // number that decides how long a rider holds a trip is exactly the drift
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
