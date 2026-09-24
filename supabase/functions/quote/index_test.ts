import { assertEquals } from "jsr:@std/assert@1";
import { quoteFare } from "../_shared/core.ts";
import type { FarePolicy } from "../_shared/core.ts";

const MOTO: FarePolicy = {
  vehicleClass: "moto",
  baseRwf: 400,
  perKmRwf: 250,
  perMinuteRwf: 20,
  minimumRwf: 700,
  commissionPct: 15,
};

Deno.test("a 4km, 12min moto trip quotes at 1700 RWF", () => {
  assertEquals(quoteFare(MOTO, 4000, 720), 1700);
});

Deno.test("a very short trip is floored at the minimum", () => {
  assertEquals(quoteFare(MOTO, 200, 60), 700);
});

Deno.test("quotes are always whole hundreds", () => {
  const q = quoteFare(MOTO, 3333, 401);
  assertEquals(q % 100, 0);
});
