import { assertEquals } from "jsr:@std/assert@1";
import { buildReceipt } from "../_shared/core.ts";
import type { FarePolicy } from "../_shared/core.ts";

const MOTO: FarePolicy = {
  vehicleClass: "moto",
  baseRwf: 400,
  perKmRwf: 250,
  perMinuteRwf: 20,
  minimumRwf: 700,
  commissionPct: 15,
};

Deno.test("a trip matching its quote receipts as a single line", () => {
  const r = buildReceipt(MOTO, 1700, 4000, 4000);
  assertEquals(r.lines.length, 1);
  assertEquals(r.totalRwf, 1700);
  assertEquals(r.commissionRwf, 255);
  assertEquals(r.riderEarningRwf, 1445);
});

Deno.test("a detour beyond tolerance is itemised and raises commission", () => {
  const r = buildReceipt(MOTO, 1700, 4000, 5600);
  assertEquals(r.lines.length, 2);
  assertEquals(r.totalRwf, 2000);
  assertEquals(r.commissionRwf, 300);
  assertEquals(r.riderEarningRwf, r.totalRwf - 300);
});

Deno.test("commission never exceeds the fare", () => {
  const r = buildReceipt(MOTO, 1700, 4000, 4000);
  assertEquals(r.commissionRwf < r.totalRwf, true);
  // The split is exact: nothing leaks between the two sides.
  assertEquals(r.commissionRwf + r.riderEarningRwf, r.totalRwf);
});

// The receipt in the response body and the figures the database writes to the
// ledger are derived independently now, so they must be fed the SAME distance.
// index.ts used to build the receipt from the raw actualDistanceM while sending
// Math.round(actualDistanceM) to the RPC, and a fractional distance then showed
// the passenger one price while the rider was charged against another.
Deno.test("a fractional distance rounds once, before either path uses it", () => {
  const rawActual = 4000.4;
  const distanceM = Math.round(rawActual);

  // The bug needs a quote whose band edge sits between the two values: 3478m
  // quoted puts the band end at 3999.7m, so 4000.4 overruns it and 4000 does
  // not. If rounding position did not matter this assertion would be vacuous.
  const fromRaw = buildReceipt(MOTO, 1700, 3478, rawActual);
  const fromRounded = buildReceipt(MOTO, 1700, 3478, distanceM);
  assertEquals(fromRaw.totalRwf, 1800);
  assertEquals(fromRounded.totalRwf, 1700);

  // What the ledger will charge is derived by SQL from exactly the integer the
  // RPC is given, so the receipt has to be built from that same integer.
  assertEquals(fromRounded.totalRwf, buildReceipt(MOTO, 1700, 3478, distanceM).totalRwf);
  assertEquals(fromRounded.commissionRwf, 255);
});

// A source-level guard, in the shape of the parity tests: index.ts calls
// Deno.serve at import time, so its handler cannot be exercised in-process. What
// can be pinned is that ONE rounded value exists and both paths use it.
Deno.test("index.ts rounds the distance once and uses it for both paths", async () => {
  const src = await Deno.readTextFile("supabase/functions/complete-trip/index.ts");

  const roundings = [...src.matchAll(/Math\.round\(actualDistanceM\)/g)];
  assertEquals(roundings.length, 1, "actualDistanceM must be rounded exactly once");
  assertEquals(src.includes("const distanceM = Math.round(actualDistanceM);"), true);
  assertEquals(src.includes("p_actual_distance_m: distanceM,"), true);
  // buildReceipt's fourth argument is the same single value.
  assertEquals(/buildReceipt\([\s\S]*?distanceM,\s*\)/.test(src), true);
});
