import { describe, it, expect } from "vitest";
import { roundFareRwf } from "../../src/fare/policy";
import { quoteFare } from "../../src/fare/quote";
import type { FarePolicy } from "../../src/fare/policy";

const MOTO: FarePolicy = {
  vehicleClass: "moto",
  baseRwf: 400,
  perKmRwf: 250,
  perMinuteRwf: 20,
  minimumRwf: 700,
  commissionPct: 15,
};

describe("roundFareRwf", () => {
  it("rounds up to the nearest hundred", () => {
    expect(roundFareRwf(1847)).toBe(1900);
  });

  it("leaves exact hundreds alone", () => {
    expect(roundFareRwf(1800)).toBe(1800);
  });

  it("rounds a single franc up a whole step", () => {
    expect(roundFareRwf(1801)).toBe(1900);
  });

  it("handles zero", () => {
    expect(roundFareRwf(0)).toBe(0);
  });
});

describe("quoteFare", () => {
  it("charges base plus distance plus time, rounded up", () => {
    // 400 base + (4.0km x 250) + (12min x 20) = 400 + 1000 + 240 = 1640 -> 1700
    expect(quoteFare(MOTO, 4000, 720)).toBe(1700);
  });

  it("applies the minimum fare to very short trips", () => {
    // 400 + (0.2km x 250) + (1min x 20) = 400 + 50 + 20 = 470 -> below 700 minimum
    expect(quoteFare(MOTO, 200, 60)).toBe(700);
  });

  it("returns the minimum for a zero-length trip", () => {
    expect(quoteFare(MOTO, 0, 0)).toBe(700);
  });

  it("returns an integer for fractional inputs", () => {
    const result = quoteFare(MOTO, 3333, 401);
    expect(Number.isInteger(result)).toBe(true);
  });

  it("rejects negative distance", () => {
    expect(() => quoteFare(MOTO, -1, 60)).toThrow("distanceMetres must be >= 0");
  });

  it("rejects negative duration", () => {
    expect(() => quoteFare(MOTO, 1000, -1)).toThrow("durationSeconds must be >= 0");
  });
});
