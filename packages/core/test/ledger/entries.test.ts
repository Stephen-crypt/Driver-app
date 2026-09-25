import { describe, it, expect } from "vitest";
import {
  LEDGER_ENTRY_KINDS,
  cashHeldOf,
  netOwedOf,
  commissionFor,
  riderEarningFor,
  canGoOnline,
  type LedgerEntry,
} from "../../src/ledger/entries";

const entry = (kind: LedgerEntry["kind"], amountRwf: number): LedgerEntry => ({
  kind,
  amountRwf,
});

describe("the two readings", () => {
  // The whole reason the fleet ledger is not a single balance.
  const day: LedgerEntry[] = [
    entry("fare_collected", 1700),
    entry("trip_earning", 1445),
    entry("fare_collected", 1700),
    entry("trip_earning", 1445),
    entry("cash_remittance", 2000),
    entry("bonus", 500),
  ];

  it("counts cash held from fares and remittances only", () => {
    expect(cashHeldOf(day)).toBe(1700 + 1700 - 2000);
  });

  it("counts net owed from earnings, bonuses and payouts only", () => {
    expect(netOwedOf(day)).toBe(1445 + 1445 + 500);
  });

  it("does not let a bonus reduce cash exposure", () => {
    // Netting the two readings would say this rider is carrying less than they
    // are. They are carrying 1400 whatever we owe them.
    const before = cashHeldOf(day);
    expect(cashHeldOf([...day, entry("bonus", 100000)])).toBe(before);
  });

  it("does not let a remittance reduce what the rider is owed", () => {
    const before = netOwedOf(day);
    expect(netOwedOf([...day, entry("cash_remittance", 100000)])).toBe(before);
  });

  it("goes negative on net owed when deductions outrun earnings", () => {
    expect(netOwedOf([entry("trip_earning", 500), entry("deduction", 900)])).toBe(-400);
  });

  it("rejects a negative amount rather than silently flipping direction", () => {
    expect(() => cashHeldOf([entry("fare_collected", -100)])).toThrow();
  });

  it("classifies every kind in the enum", () => {
    // The old version let an implicit else treat anything unclassified as a
    // debit, which would have mis-signed every fleet kind added later.
    for (const kind of LEDGER_ENTRY_KINDS) {
      expect(() => cashHeldOf([entry(kind, 1)])).not.toThrow();
      expect(() => netOwedOf([entry(kind, 1)])).not.toThrow();
    }
  });

  it("keeps retired marketplace kinds readable, so old rows still total", () => {
    expect(netOwedOf([entry("topup_credit", 5000), entry("commission_debit", 255)]))
      .toBe(5000 - 255);
  });
});

describe("the split of a fare", () => {
  it("gives the rider the remainder after commission", () => {
    expect(commissionFor(1700, 15)).toBe(255);
    expect(riderEarningFor(1700, 15)).toBe(1445);
  });

  it("always sums back to the fare exactly, at every rate", () => {
    // Two independent roundings would leak a franc on most fares; a rider who
    // adds up their own trips finds it.
    for (let fare = 100; fare <= 20000; fare += 100) {
      for (const pct of [0, 7, 15, 30, 33, 50, 99, 100]) {
        expect(commissionFor(fare, pct) + riderEarningFor(fare, pct)).toBe(fare);
      }
    }
  });

  it("gives the rider everything at zero commission", () => {
    expect(riderEarningFor(1700, 0)).toBe(1700);
  });

  it("gives the rider nothing at full commission", () => {
    expect(riderEarningFor(1700, 100)).toBe(0);
  });

  it("refuses a rate outside nought to a hundred", () => {
    expect(() => commissionFor(1000, 101)).toThrow();
    expect(() => commissionFor(1000, -1)).toThrow();
  });
});

describe("canGoOnline", () => {
  const under = { hasActiveVehicle: true, cashHeldRwf: 10_000, maxCashHeldRwf: 50_000 };

  it("lets a rider with a vehicle and little cash work", () => {
    expect(canGoOnline(under)).toBe(true);
  });

  it("stops a rider carrying too much of the company's cash", () => {
    expect(canGoOnline({ ...under, cashHeldRwf: 50_001 })).toBe(false);
  });

  it("allows exactly the limit", () => {
    expect(canGoOnline({ ...under, cashHeldRwf: 50_000 })).toBe(true);
  });

  it("stops a rider with no vehicle, however little cash they hold", () => {
    // A fleet owns the vehicles. No vehicle means not working today.
    expect(canGoOnline({ ...under, hasActiveVehicle: false, cashHeldRwf: 0 })).toBe(false);
  });
});
