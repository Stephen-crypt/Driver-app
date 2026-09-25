import { describe, it, expect, vi } from "vitest";
import { shareTripText, etaLabel, raiseSos, getRiderPosition } from "../src/safety";
import type { GeraClient } from "../src/client";

describe("etaLabel", () => {
  it("rounds to whole minutes", () => {
    expect(etaLabel(240)).toBe("4 min");
  });

  it("never reads zero, because a rider is never zero minutes away", () => {
    expect(etaLabel(10)).toBe("1 min");
    expect(etaLabel(0)).toBe("1 min");
  });

  it("shows a dash rather than NaN when there is no fix yet", () => {
    expect(etaLabel(null)).toBe("—");
    expect(etaLabel(undefined)).toBe("—");
    expect(etaLabel(Number.NaN)).toBe("—");
  });
});

describe("shareTripText", () => {
  it("names both ends of the trip", () => {
    const t = shareTripText({ pickupLabel: "Kimironko Market", dropoffLabel: "Kigali Heights" });
    expect(t).toContain("Kimironko Market");
    expect(t).toContain("Kigali Heights");
  });

  it("includes the plate, which is what someone would actually look for", () => {
    const t = shareTripText({
      pickupLabel: "a", dropoffLabel: "b", riderName: "Eric", plate: "RAB 123C",
    });
    expect(t).toContain("Eric");
    expect(t).toContain("RAB 123C");
  });

  it("omits the rider line entirely before one is assigned", () => {
    const t = shareTripText({ pickupLabel: "a", dropoffLabel: "b" });
    expect(t).not.toContain("rider is");
  });

  it("does not invent a link to a page that does not exist", () => {
    const t = shareTripText({ pickupLabel: "a", dropoffLabel: "b" });
    expect(t).not.toMatch(/https?:\/\//);
  });
});

describe("raiseSos", () => {
  it("can be called with nothing at all", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "alert-1", error: null });
    const client = { rpc } as unknown as GeraClient;
    // Somebody in trouble should not be filling in a form.
    await expect(raiseSos(client)).resolves.toBe("alert-1");
    expect(rpc).toHaveBeenCalledWith("raise_sos", {
      p_trip_id: null, p_lng: null, p_lat: null, p_note: null,
    });
  });

  it("passes position and trip when it has them", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "alert-2", error: null });
    const client = { rpc } as unknown as GeraClient;
    await raiseSos(client, { tripId: "t1", at: { lng: 30.1, lat: -1.9 } });
    expect(rpc).toHaveBeenCalledWith("raise_sos", expect.objectContaining({
      p_trip_id: "t1", p_lng: 30.1, p_lat: -1.9,
    }));
  });
});

describe("getRiderPosition", () => {
  it("returns null before the first fix, rather than throwing", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    const client = { rpc } as unknown as GeraClient;
    expect(await getRiderPosition(client, "t1")).toBeNull();
  });

  it("maps the row the server returns", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ lng: 30.1, lat: -1.94, recorded_at: "2026-09-25T12:00:00Z", metres_away: 900, eta_seconds: 120 }],
      error: null,
    });
    const client = { rpc } as unknown as GeraClient;
    const p = await getRiderPosition(client, "t1");
    expect(p?.metresAway).toBe(900);
    expect(p?.etaSeconds).toBe(120);
  });
});
