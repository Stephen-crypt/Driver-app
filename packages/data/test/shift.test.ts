import { describe, it, expect, vi } from "vitest";
import { startTrip, waitedSecondsNow, shiftErrorMessage, reportNoShow } from "../src/shift";
import { dailyEarnings, describeLedgerRow, type LedgerRow } from "../src/earnings";
import type { GeraClient } from "../src/client";

const rpcClient = (result: { data?: unknown; error?: { message: string } | null }) => {
  const rpc = vi.fn(() => Promise.resolve({ data: result.data ?? null, error: result.error ?? null }));
  return { client: { rpc } as unknown as GeraClient, rpc };
};

describe("startTrip", () => {
  it("reports a wrong PIN as an answer with the attempts left, not an exception", async () => {
    const { client } = rpcClient({ data: { started: false, reason: "wrong_pin", attempts_left: 3 } });
    await expect(startTrip(client, "t1", "0000")).resolves.toEqual({
      started: false,
      reason: "wrong_pin",
      attemptsLeft: 3,
    });
  });

  it("reports a locked trip", async () => {
    const { client } = rpcClient({ data: { started: false, reason: "locked", attempts_left: 0 } });
    const r = await startTrip(client, "t1", "1234");
    expect(r).toEqual({ started: false, reason: "locked", attemptsLeft: 0 });
  });

  it("gives each PIN its own idempotency key", async () => {
    // One key for every attempt would make the right PIN replay the wrong one.
    const { client, rpc } = rpcClient({ data: { started: true } });
    await startTrip(client, "t1", "1111");
    await startTrip(client, "t1", "2222");
    const keys = rpc.mock.calls.map((c) => (c as unknown as [string, { p_idempotency_key: string }])[1].p_idempotency_key);
    expect(new Set(keys).size).toBe(2);
  });
});

describe("reportNoShow", () => {
  it("turns an early report into something the rider can act on", async () => {
    const { client } = rpcClient({ error: { message: "grace_not_elapsed: 120 seconds left" } });
    await expect(reportNoShow(client, "t1", "x", null)).rejects.toThrow(/free waiting time/);
  });
});

describe("waitedSecondsNow", () => {
  it("counts from arrival and never goes negative", () => {
    const arrived = new Date(1_000_000).toISOString();
    expect(waitedSecondsNow(arrived, 1_000_000 + 61_500)).toBe(61);
    expect(waitedSecondsNow(arrived, 900_000)).toBe(0);
    expect(waitedSecondsNow(null)).toBe(0);
  });
});

describe("shiftErrorMessage", () => {
  it("names the fix, not the code", () => {
    expect(shiftErrorMessage("no_vehicle")).toMatch(/fleet office/);
    expect(shiftErrorMessage("safety_check_failed: brakes")).toMatch(/Report the problem/);
  });
});

describe("dailyEarnings", () => {
  const now = new Date(2026, 8, 25, 15, 0, 0);
  const at = (daysAgo: number, hour = 10) =>
    new Date(2026, 8, 25 - daysAgo, hour, 0, 0).toISOString();
  const row = (kind: string, amountRwf: number, createdAt: string, tripId: string | null = null): LedgerRow =>
    ({ id: Math.random(), kind, amountRwf, memo: null, tripId, createdAt });

  it("has every day, oldest first, including days with no work", () => {
    const days = dailyEarnings([], 7, now);
    expect(days).toHaveLength(7);
    expect(days[6]?.day.getDate()).toBe(25);
    expect(days[0]?.day.getDate()).toBe(19);
    expect(days.every((d) => d.earnedRwf === 0)).toBe(true);
  });

  it("counts earnings and bonuses, subtracts deductions, and ignores cash", () => {
    const days = dailyEarnings(
      [
        row("trip_earning", 1445, at(0), "a"),
        row("fare_collected", 1700, at(0), "a"),
        row("trip_earning", 1785, at(0, 12), "b"),
        row("bonus", 500, at(0)),
        row("deduction", 200, at(0)),
        row("cash_remittance", 3000, at(0)),
        row("trip_earning", 1000, at(2), "c"),
      ],
      7,
      now,
    );
    expect(days[6]).toMatchObject({ earnedRwf: 1445 + 1785 + 500 - 200, trips: 2 });
    expect(days[4]).toMatchObject({ earnedRwf: 1000, trips: 1 });
  });

  it("drops rows outside the window rather than piling them onto an edge", () => {
    const days = dailyEarnings([row("trip_earning", 999, at(30), "old")], 7, now);
    expect(days.reduce((t, d) => t + d.earnedRwf, 0)).toBe(0);
  });
});

describe("describeLedgerRow", () => {
  it("keeps cash and what the rider is owed apart", () => {
    const r = (kind: string): LedgerRow => ({ id: 1, kind, amountRwf: 1, memo: null, tripId: null, createdAt: "" });
    expect(describeLedgerRow(r("fare_collected")).affects).toBe("cash");
    expect(describeLedgerRow(r("cash_remittance"))).toMatchObject({ affects: "cash", sign: -1 });
    expect(describeLedgerRow(r("payout"))).toMatchObject({ affects: "owed", sign: -1 });
  });
});

import { pickupLabelFor, distanceLabel, distanceBetween } from "../src/geo";

describe("pickupLabelFor", () => {
  it("names the landmark outright when the passenger is standing at it", () => {
    expect(pickupLabelFor({ name: "Kimironko Market", sector: null, distanceM: 40 })).toBe("Kimironko Market");
  });
  it("says near when it is a short walk", () => {
    expect(pickupLabelFor({ name: "Kimironko Market", sector: null, distanceM: 600 })).toBe("Near Kimironko Market");
  });
  it("falls back to plain words rather than a wrong name", () => {
    expect(pickupLabelFor(null)).toBe("Current location");
  });
});

describe("distanceLabel", () => {
  it("rounds short distances to fifty metres and long ones to a tenth of a km", () => {
    expect(distanceLabel(12)).toBe("50 m");
    expect(distanceLabel(430)).toBe("450 m");
    expect(distanceLabel(1234)).toBe("1.2 km");
    expect(distanceLabel(15_400)).toBe("15 km");
  });
  it("measures Kimironko to Kigali Heights as just over a kilometre", () => {
    const d = distanceBetween({ lat: -1.9441, lng: 30.0619 }, { lat: -1.9536, lng: 30.0588 });
    expect(d).toBeGreaterThan(1000);
    expect(d).toBeLessThan(1200);
  });
});
