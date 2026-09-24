import { describe, it, expect } from "vitest";
import { finalizeFare, OVERAGE_TOLERANCE } from "../../src/fare/finalize";
import type { FarePolicy } from "../../src/fare/policy";

const MOTO: FarePolicy = {
  vehicleClass: "moto",
  baseRwf: 400,
  perKmRwf: 250,
  perMinuteRwf: 20,
  minimumRwf: 700,
  commissionPct: 15,
};

describe("finalizeFare", () => {
  it("honours the quote when the trip matches", () => {
    const f = finalizeFare(MOTO, 1700, 4000, 4000);
    expect(f).toEqual({
      totalRwf: 1700,
      quotedRwf: 1700,
      overageRwf: 0,
      overageMetres: 0,
    });
  });

  it("honours the quote when the trip is shorter than quoted", () => {
    const f = finalizeFare(MOTO, 1700, 4000, 3000);
    expect(f.totalRwf).toBe(1700);
    expect(f.overageRwf).toBe(0);
  });

  it("absorbs a detour inside the tolerance band", () => {
    // 15% of 4000m = 600m band; 4500m is inside it.
    const f = finalizeFare(MOTO, 1700, 4000, 4500);
    expect(f.totalRwf).toBe(1700);
    expect(f.overageMetres).toBe(0);
  });

  it("charges only the distance beyond the tolerance band", () => {
    // band ends at 4600m; actual 5600m -> 1000m chargeable at 250/km = 250 -> 300
    const f = finalizeFare(MOTO, 1700, 4000, 5600);
    expect(f.overageMetres).toBe(1000);
    expect(f.overageRwf).toBe(300);
    expect(f.totalRwf).toBe(2000);
  });

  it("exposes the quote unchanged alongside the overage", () => {
    const f = finalizeFare(MOTO, 1700, 4000, 5600);
    expect(f.quotedRwf).toBe(1700);
    expect(f.totalRwf).toBe(f.quotedRwf + f.overageRwf);
  });

  it("uses the declared tolerance constant", () => {
    expect(OVERAGE_TOLERANCE).toBe(0.15);
  });

  it("rejects a negative actual distance", () => {
    expect(() => finalizeFare(MOTO, 1700, 4000, -1)).toThrow(
      "actualDistanceMetres must be >= 0",
    );
  });

  it("charges nothing at exactly the tolerance band edge", () => {
    // 4000m x 1.15 = 4600m exactly - the last metre that is still free.
    const f = finalizeFare(MOTO, 1700, 4000, 4600);
    expect(f.overageMetres).toBe(0);
    expect(f.overageRwf).toBe(0);
    expect(f.totalRwf).toBe(1700);
  });

  // Observed, not endorsed. One metre past the band costs a whole 100 RWF,
  // because the overage is priced and THEN rounded up to the next hundred, and
  // rider-facing fares are always whole hundreds. It is a real cliff at the band
  // edge: 4600m is free, 4601m is 100 RWF. Pinned here so that if the pricing
  // rule is ever softened (say, by rounding the overage to the nearest hundred
  // instead of up) it is a deliberate change with a failing test, not a drift.
  it("charges a whole hundred for the first metre past the band", () => {
    const f = finalizeFare(MOTO, 1700, 4000, 4601);
    expect(f.overageMetres).toBe(1);
    expect(f.overageRwf).toBe(100);
    expect(f.totalRwf).toBe(1800);
  });

  it("leaves a zero fare at zero", () => {
    // A zero-distance, zero-price trip: nothing to charge, nothing to round up
    // to. roundFareRwf is never reached, because a zero overage short-circuits.
    const f = finalizeFare(MOTO, 0, 0, 0);
    expect(f).toEqual({
      totalRwf: 0,
      quotedRwf: 0,
      overageRwf: 0,
      overageMetres: 0,
    });
  });
});
