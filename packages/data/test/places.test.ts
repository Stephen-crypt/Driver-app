import { describe, it, expect, vi } from "vitest";
import { getRoute, searchLandmarks, searchPlaces } from "../src/places";
import { describePickup } from "../src/geo";
import type { NovaClient } from "../src/client";

function client(data: unknown, error: unknown = null): NovaClient {
  return { rpc: vi.fn().mockResolvedValue({ data, error }) } as unknown as NovaClient;
}

describe("searchLandmarks", () => {
  it("maps rows into places", async () => {
    const c = client([
      { id: "1", name: "Kimironko Market", sector: "Kimironko", lng: 30.1128, lat: -1.9403 },
    ]);
    const out = await searchLandmarks(c, "kimironko");
    expect(out[0]?.name).toBe("Kimironko Market");
    expect(out[0]?.lat).toBeCloseTo(-1.9403, 4);
    expect(out[0]?.lng).toBeCloseTo(30.1128, 4);
  });

  it("passes the trimmed query and the limit to the server", async () => {
    const c = client([]);
    await searchLandmarks(c, "  kim  ", 3);
    expect(c.rpc).toHaveBeenCalledWith("search_landmarks", { p_query: "kim", p_limit: 3 });
  });

  it("returns an empty list for a blank query without calling the server", async () => {
    const c = client(null);
    expect(await searchLandmarks(c, "   ")).toEqual([]);
    expect(c.rpc).not.toHaveBeenCalled();
  });

  it("throws when the server errors", async () => {
    const c = client(null, { message: "boom" });
    await expect(searchLandmarks(c, "kim")).rejects.toThrow("boom");
  });

  it("returns an empty list when the server returns nothing", async () => {
    const c = client(null);
    expect(await searchLandmarks(c, "zzz")).toEqual([]);
  });
});

describe("getRoute", () => {
  const A = { lat: -1.9441, lng: 30.0619 };
  const B = { lat: -1.9536, lng: 30.0925 };
  const fn = (data: unknown, error: unknown = null) =>
    ({ functions: { invoke: vi.fn().mockResolvedValue({ data, error }) } }) as unknown as NovaClient;

  it("turns the road's [lat, lng] pairs into points", async () => {
    const c = fn({ distanceM: 4869, durationS: 458, path: [[-1.9441, 30.0619], [-1.95, 30.07]] });
    expect(await getRoute(c, A, B)).toEqual({
      distanceM: 4869,
      durationS: 458,
      path: [{ lat: -1.9441, lng: 30.0619 }, { lat: -1.95, lng: 30.07 }],
    });
  });

  it("keeps the figures when the router sent no shape, and drops broken points", async () => {
    expect((await getRoute(fn({ distanceM: 5012, durationS: 600 }), A, B))?.path).toEqual([]);
    expect((await getRoute(fn({ distanceM: 1, durationS: 1, path: [[1, 2], [null, 3], "x"] }), A, B))?.path).toEqual([{ lat: 1, lng: 2 }]);
  });

  it("returns null rather than throwing when routing is down", async () => {
    expect(await getRoute(fn(null, { message: "502" }), A, B)).toBeNull();
    expect(await getRoute(fn({ error: "directions_failed" }), A, B)).toBeNull();
  });
});

/** A client whose landmark search and places function answer as given. */
function both(landmarks: unknown[], places: unknown, placesError: unknown = null) {
  return {
    rpc: vi.fn().mockResolvedValue({ data: landmarks, error: null }),
    functions: { invoke: vi.fn().mockResolvedValue({ data: places, error: placesError }) },
  } as unknown as NovaClient & { rpc: ReturnType<typeof vi.fn>; functions: { invoke: ReturnType<typeof vi.fn> } };
}

describe("searchPlaces", () => {
  const market = { id: "1", name: "Kimironko Market", sector: "Kimironko", lng: 30.1263, lat: -1.9498 };

  it("puts Nova's landmarks first, then the map's places", async () => {
    const c = both([market], { places: [{ id: "x", name: "Kimironko Bus Park", detail: "KG 11 Avenue, Kigali", lat: -1.9464, lng: 30.1282 }] });
    const out = await searchPlaces(c, "kimironko");
    expect(out.map((p) => [p.name, p.source, p.sector])).toEqual([
      ["Kimironko Market", "landmark", "Kimironko"],
      ["Kimironko Bus Park", "geoapify", "KG 11 Avenue, Kigali"],
    ]);
  });

  it("drops a map result that is one of our landmarks again", async () => {
    const c = both([market], { places: [{ id: "x", name: "kimironko market", detail: null, lat: -1.9497, lng: 30.1262 }] });
    expect((await searchPlaces(c, "kimironko")).map((p) => p.source)).toEqual(["landmark"]);
  });

  it("biases the map search towards the passenger", async () => {
    const c = both([], { places: [] });
    await searchPlaces(c, "serena", { lat: -1.95, lng: 30.09 });
    expect(c.functions.invoke).toHaveBeenCalledWith("places", { body: { search: "serena", near: { lat: -1.95, lng: 30.09 } } });
  });

  it("keeps two-letter searches local", async () => {
    const c = both([market], { places: [] });
    await searchPlaces(c, "ki");
    expect(c.functions.invoke).not.toHaveBeenCalled();
  });

  it("still answers with landmarks when the map search is down", async () => {
    const c = both([market], null, { message: "502" });
    expect((await searchPlaces(c, "kimironko")).map((p) => p.name)).toEqual(["Kimironko Market"]);
  });
});

describe("describePickup", () => {
  const at = { lat: -1.9393, lng: 30.0446 };
  const client = (landmark: unknown, label: unknown) =>
    ({
      rpc: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: landmark, error: null }) })),
      functions: { invoke: vi.fn().mockResolvedValue({ data: label === undefined ? null : { label }, error: label === undefined ? { message: "down" } : null }) },
    }) as unknown as NovaClient & { functions: { invoke: ReturnType<typeof vi.fn> } };

  it("uses a close landmark without asking the map", async () => {
    const c = client({ name: "Nyabugogo Bus Park", sector: null, distance_m: 220 }, "Near RITCO");
    expect(await describePickup(c, at)).toBe("Near Nyabugogo Bus Park");
    expect(c.functions.invoke).not.toHaveBeenCalled();
  });

  it("asks the map when the nearest landmark is a walk away", async () => {
    const c = client({ name: "Nyabugogo Bus Park", sector: null, distance_m: 800 }, "KN 7 Road, Kimisagara");
    expect(await describePickup(c, at)).toBe("KN 7 Road, Kimisagara");
    expect(c.functions.invoke).toHaveBeenCalledWith("places", { body: { reverse: at } });
  });

  it("falls back to the far landmark, then to Current location", async () => {
    expect(await describePickup(client({ name: "Nyabugogo Bus Park", sector: null, distance_m: 800 }, undefined), at)).toBe("Near Nyabugogo Bus Park");
    expect(await describePickup(client(null, null), at)).toBe("Current location");
  });
});
