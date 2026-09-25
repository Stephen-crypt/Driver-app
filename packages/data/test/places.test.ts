import { describe, it, expect, vi } from "vitest";
import { searchLandmarks } from "../src/places";
import type { GeraClient } from "../src/client";

function client(data: unknown, error: unknown = null): GeraClient {
  return { rpc: vi.fn().mockResolvedValue({ data, error }) } as unknown as GeraClient;
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
