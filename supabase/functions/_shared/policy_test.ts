import { assertEquals } from "jsr:@std/assert@1";
import { policyFromRow, type FarePolicyRow } from "./policy.ts";

const REAL_ROW: FarePolicyRow = {
  id: "11111111-1111-1111-1111-111111111111",
  vehicle_class: "moto",
  base_rwf: 400,
  per_km_rwf: 250,
  per_minute_rwf: 20,
  minimum_rwf: 700,
  commission_pct: "15.00",
};

Deno.test("a real policy row becomes a policy, with numeric commission", () => {
  const policy = policyFromRow(REAL_ROW);
  assertEquals(policy, {
    vehicleClass: "moto",
    baseRwf: 400,
    perKmRwf: 250,
    perMinuteRwf: 20,
    minimumRwf: 700,
    commissionPct: 15,
  });
});

// The whole point. current_fare_policy() returns a composite, so "no effective
// policy" arrives as one row of nulls rather than as no rows at all. Treated as
// a policy, its null rates coerce to 0 and the passenger is quoted 0 RWF.
Deno.test("an all-null composite row is no policy, not a free ride", () => {
  const nullRow = {
    id: null,
    vehicle_class: "moto",
    base_rwf: null,
    per_km_rwf: null,
    per_minute_rwf: null,
    minimum_rwf: null,
    commission_pct: null,
  } as FarePolicyRow;

  assertEquals(policyFromRow(nullRow), null);
});

Deno.test("no row at all is no policy", () => {
  assertEquals(policyFromRow(null), null);
  assertEquals(policyFromRow(undefined), null);
});
