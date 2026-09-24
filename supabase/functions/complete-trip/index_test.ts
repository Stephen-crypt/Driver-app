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
});

Deno.test("a detour beyond tolerance is itemised and raises commission", () => {
  const r = buildReceipt(MOTO, 1700, 4000, 5600);
  assertEquals(r.lines.length, 2);
  assertEquals(r.totalRwf, 2000);
  assertEquals(r.commissionRwf, 300);
});

Deno.test("commission never exceeds the fare", () => {
  const r = buildReceipt(MOTO, 1700, 4000, 4000);
  assertEquals(r.commissionRwf < r.totalRwf, true);
});
