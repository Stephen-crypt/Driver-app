import { describe, it, expect, vi } from "vitest";
import { getTrip, isTripLive, LIVE_TRIP_STATES } from "../src/trip-watch";
import type { GeraClient } from "../src/client";

function client(data: unknown, error: unknown = null): GeraClient {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error }),
  };
  return { from: vi.fn().mockReturnValue(chain) } as unknown as GeraClient;
}

describe("isTripLive", () => {
  it("counts every pre-terminal state as live", () => {
    for (const s of ["requested", "offered", "accepted", "arrived", "in_progress"]) {
      expect(isTripLive(s)).toBe(true);
    }
  });

  it("does not count terminal states as live", () => {
    for (const s of [
      "completed",
      "cancelled_by_rider",
      "cancelled_by_driver",
      "no_drivers",
      "expired",
    ]) {
      expect(isTripLive(s)).toBe(false);
    }
  });

  it("lists exactly the five live states", () => {
    expect([...LIVE_TRIP_STATES].sort()).toEqual([
      "accepted",
      "arrived",
      "in_progress",
      "offered",
      "requested",
    ]);
  });
});

describe("getTrip", () => {
  it("maps the row into a snapshot", async () => {
    const c = client({
      id: "t1",
      state: "offered",
      driver_id: "d1",
      quoted_amount_rwf: 1700,
      pickup_label: "Kimironko",
      dropoff_label: "Heights",
    });
    const t = await getTrip(c, "t1");
    expect(t.state).toBe("offered");
    expect(t.driverId).toBe("d1");
    expect(t.quotedAmountRwf).toBe(1700);
    expect(t.pickupLabel).toBe("Kimironko");
  });

  it("keeps a null driver null rather than inventing one", async () => {
    const c = client({
      id: "t1",
      state: "requested",
      driver_id: null,
      quoted_amount_rwf: 1700,
      pickup_label: "a",
      dropoff_label: "b",
    });
    expect((await getTrip(c, "t1")).driverId).toBeNull();
  });

  it("throws when the trip cannot be read", async () => {
    const c = client(null, { message: "not found" });
    await expect(getTrip(c, "t1")).rejects.toThrow("not found");
  });
});
