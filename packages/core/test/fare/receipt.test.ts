import { describe, it, expect } from "vitest";
import { buildReceipt } from "../../src/fare/receipt";
import type { FarePolicy } from "../../src/fare/policy";

const MOTO: FarePolicy = {
  vehicleClass: "moto",
  baseRwf: 400,
  perKmRwf: 250,
  perMinuteRwf: 20,
  minimumRwf: 700,
  commissionPct: 15,
};

describe("buildReceipt", () => {
  it("shows a single line when the trip matched its quote", () => {
    const r = buildReceipt(MOTO, 1700, 4000, 4000);
    expect(r.lines).toEqual([{ label: "Fare", amountRwf: 1700 }]);
    expect(r.totalRwf).toBe(1700);
  });

  it("itemises a distance overage as its own line", () => {
    const r = buildReceipt(MOTO, 1700, 4000, 5600);
    expect(r.lines).toEqual([
      { label: "Fare", amountRwf: 1700 },
      { label: "Extra distance", amountRwf: 300 },
    ]);
    expect(r.totalRwf).toBe(2000);
  });

  it("never folds an overage silently into the fare line", () => {
    const r = buildReceipt(MOTO, 1700, 4000, 5600);
    expect(r.lines[0]?.amountRwf).toBe(1700);
  });

  it("computes commission on the total, not the quote", () => {
    const r = buildReceipt(MOTO, 1700, 4000, 5600);
    expect(r.commissionRwf).toBe(300); // 15% of 2000
  });

  it("lines always sum to the total", () => {
    const r = buildReceipt(MOTO, 1700, 4000, 5600);
    expect(r.lines.reduce((t, l) => t + l.amountRwf, 0)).toBe(r.totalRwf);
  });
});
