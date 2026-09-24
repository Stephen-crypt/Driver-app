import { describe, it, expect } from "vitest";
import { finalizeFare, OVERAGE_TOLERANCE } from "../../src/fare/finalize";
import type { FarePolicy } from "../../src/fare/policy";

const MOTO: FarePolicy = {
  vehicleClass: "moto",
  baseRwf: 400,
  perKmRwf: 250,
  perMinuteRwf: 20,
  minimumRwf: 700,
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
});
