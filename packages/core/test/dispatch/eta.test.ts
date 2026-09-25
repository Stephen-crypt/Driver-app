import { describe, it, expect } from "vitest";
import {
  OFFER_TTL_SECONDS,
  DISPATCH_RADII_M,
  CANDIDATE_SHORTLIST,
  straightLineEta,
  rankByEta,
} from "../../src/dispatch/eta";

describe("dispatch constants", () => {
  it("offers are exclusive for fifteen seconds", () => {
    expect(OFFER_TTL_SECONDS).toBe(15);
  });

  it("the search widens 1km, 2km, 4km", () => {
    expect([...DISPATCH_RADII_M]).toEqual([1000, 2000, 4000]);
  });

  it("only five candidates get a real ETA lookup", () => {
    expect(CANDIDATE_SHORTLIST).toBe(5);
  });
});

describe("straightLineEta", () => {
  it("is longer for a cab than a moto over the same distance", async () => {
    const moto = await straightLineEta.estimate(4000, "moto");
    const cab = await straightLineEta.estimate(4000, "cab");
    expect(cab).toBeGreaterThan(moto);
  });

  it("returns whole seconds", async () => {
    const eta = await straightLineEta.estimate(3333, "moto");
    expect(Number.isInteger(eta)).toBe(true);
  });

  it("is zero for a zero-distance trip", async () => {
    expect(await straightLineEta.estimate(0, "moto")).toBe(0);
  });

  it("rejects a negative distance", async () => {
    await expect(straightLineEta.estimate(-1, "moto")).rejects.toThrow(
      "distanceMetres must be >= 0",
    );
  });
});

describe("rankByEta", () => {
  it("orders by ETA, not by the order it was given", async () => {
    const ranked = await rankByEta(
      [
        { driverId: "far", distanceM: 3000 },
        { driverId: "near", distanceM: 500 },
        { driverId: "mid", distanceM: 1500 },
      ],
      "moto",
      straightLineEta,
    );
    expect(ranked.map((r) => r.driverId)).toEqual(["near", "mid", "far"]);
  });

  it("attaches the eta it ranked on", async () => {
    const ranked = await rankByEta([{ driverId: "a", distanceM: 1000 }], "moto", straightLineEta);
    expect(ranked[0]?.etaSeconds).toBeGreaterThan(0);
  });

  it("returns an empty list unchanged", async () => {
    expect(await rankByEta([], "moto", straightLineEta)).toEqual([]);
  });
});
