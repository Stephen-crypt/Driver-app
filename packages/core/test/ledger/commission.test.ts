import { describe, it, expect } from "vitest";
import {
  commissionFor,
  balanceOf,
  canGoOnline,
  type LedgerEntry,
} from "../../src/ledger/commission";

describe("commissionFor", () => {
  it("takes the configured percentage of the fare", () => {
    expect(commissionFor(2000, 15)).toBe(300);
  });

  it("rounds to a whole franc", () => {
    // 15% of 1700 = 255
    expect(commissionFor(1700, 15)).toBe(255);
    // 15% of 1750 = 262.5 -> 263
    expect(commissionFor(1750, 15)).toBe(263);
  });

  it("returns zero for a zero fare", () => {
    expect(commissionFor(0, 15)).toBe(0);
  });

  it("rejects a rate outside 0-100", () => {
    expect(() => commissionFor(2000, -1)).toThrow("ratePercent must be between 0 and 100");
    expect(() => commissionFor(2000, 101)).toThrow("ratePercent must be between 0 and 100");
  });

  it("accepts the boundary rates", () => {
    expect(commissionFor(2000, 0)).toBe(0);
    expect(commissionFor(2000, 100)).toBe(2000);
  });
});

describe("balanceOf", () => {
  it("is zero for an empty ledger", () => {
    expect(balanceOf([])).toBe(0);
  });

  it("adds credits and subtracts debits", () => {
    const entries: LedgerEntry[] = [
      { kind: "topup_credit", amountRwf: 5000 },
      { kind: "commission_debit", amountRwf: 300 },
      { kind: "commission_debit", amountRwf: 255 },
    ];
    expect(balanceOf(entries)).toBe(4445);
  });

  it("applies adjustments in both directions", () => {
    const entries: LedgerEntry[] = [
      { kind: "topup_credit", amountRwf: 1000 },
      { kind: "adjustment_debit", amountRwf: 200 },
      { kind: "adjustment_credit", amountRwf: 50 },
    ];
    expect(balanceOf(entries)).toBe(850);
  });

  it("can go negative when commission outruns top-ups", () => {
    const entries: LedgerEntry[] = [
      { kind: "topup_credit", amountRwf: 100 },
      { kind: "commission_debit", amountRwf: 300 },
    ];
    expect(balanceOf(entries)).toBe(-200);
  });

  it("rejects a negative amount", () => {
    expect(() => balanceOf([{ kind: "topup_credit", amountRwf: -1 }])).toThrow(
      "amountRwf must be >= 0",
    );
  });

  it("classifies every ledger entry kind", () => {
    expect(
      balanceOf([
        { kind: "topup_credit", amountRwf: 1000 },
        { kind: "adjustment_credit", amountRwf: 100 },
        { kind: "commission_debit", amountRwf: 400 },
        { kind: "adjustment_debit", amountRwf: 50 },
      ]),
    ).toBe(650);
  });
});

describe("canGoOnline", () => {
  it("permits a driver at exactly the minimum", () => {
    expect(canGoOnline(500, 500)).toBe(true);
  });

  it("blocks a driver below the minimum", () => {
    expect(canGoOnline(499, 500)).toBe(false);
  });

  it("blocks a driver in arrears", () => {
    expect(canGoOnline(-200, 500)).toBe(false);
  });
});
