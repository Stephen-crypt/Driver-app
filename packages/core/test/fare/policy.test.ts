import { describe, it, expect } from "vitest";
import { roundFareRwf, type FarePolicy } from "../../src/fare/policy";

const MOTO: FarePolicy = {
  vehicleClass: "moto",
  baseRwf: 400,
  perKmRwf: 250,
  perMinuteRwf: 20,
  minimumRwf: 700,
  commissionPct: 15,
};

describe("FarePolicy", () => {
  it("carries the commission rate alongside the fare rates", () => {
    expect(MOTO.commissionPct).toBe(15);
  });

  it("still rounds fares up to whole hundreds", () => {
    expect(roundFareRwf(1701)).toBe(1800);
  });
});
