import { assertEquals } from "jsr:@std/assert@1";
import { quoteFare, buildReceipt } from "./core.ts";
import type { FarePolicy } from "./core.ts";

const MOTO: FarePolicy = {
  vehicleClass: "moto",
  baseRwf: 400,
  perKmRwf: 250,
  perMinuteRwf: 20,
  minimumRwf: 700,
  commissionPct: 15,
};

Deno.test("Deno runs the workspace fare arithmetic unchanged", () => {
  assertEquals(quoteFare(MOTO, 4000, 720), 1700);
});

Deno.test("Deno runs the workspace receipt builder unchanged", () => {
  const r = buildReceipt(MOTO, 1700, 4000, 5600);
  assertEquals(r.totalRwf, 2000);
  assertEquals(r.commissionRwf, 300);
});
