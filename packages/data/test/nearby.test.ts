import { describe, expect, it, vi } from "vitest";
import { landmarksNear, pickupMinutes, ridersNearby } from "../src/nearby";
import type { NovaClient } from "../src/client";

function client(result: { data: unknown; error: { message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { client: { rpc } as unknown as NovaClient, rpc };
}

describe("pickupMinutes", () => {
  it("is never zero, so a rider next door is not 'already here'", () => {
    expect(pickupMinutes(0)).toBe(1);
    expect(pickupMinutes(40)).toBe(1);
  });

  it("allows for winding roads and town speed", () => {
    // 1 km in a straight line: about 1.35 km of road at 22 km/h.
    expect(pickupMinutes(1000)).toBe(4);
    expect(pickupMinutes(3000)).toBe(11);
  });
});

describe("ridersNearby", () => {
  it("asks with longitude first, the way the database takes a point", async () => {
    const { client: c, rpc } = client({ data: [], error: null });
    await ridersNearby(c, { lat: -1.94, lng: 30.06 });
    expect(rpc).toHaveBeenCalledWith("riders_nearby", { p_lng: 30.06, p_lat: -1.94 });
  });

  it("reads counts and distances as numbers", async () => {
    const { client: c } = client({ data: [{ vehicle_class: "moto", riders: "3", nearest_m: "420" }], error: null });
    expect(await ridersNearby(c, { lat: -1.94, lng: 30.06 })).toEqual([{ vehicleClass: "moto", riders: 3, nearestM: 420 }]);
  });

  it("throws rather than reporting nobody when the question fails", async () => {
    const { client: c } = client({ data: null, error: { message: "boom" } });
    await expect(ridersNearby(c, { lat: -1.94, lng: 30.06 })).rejects.toThrow();
  });
});

describe("landmarksNear", () => {
  it("passes the limit and maps the rows", async () => {
    const { client: c, rpc } = client({
      data: [{ id: "a", name: "Kigali Heights", sector: "Kimihurura", lng: 30.09, lat: -1.95, distance_m: 850 }],
      error: null,
    });
    const places = await landmarksNear(c, { lat: -1.94, lng: 30.06 }, 3);
    expect(rpc).toHaveBeenCalledWith("landmarks_near", { p_lng: 30.06, p_lat: -1.94, p_limit: 3 });
    expect(places[0]).toMatchObject({ name: "Kigali Heights", distanceM: 850, lat: -1.95 });
  });
});
