import { describe, it, expect, vi } from "vitest";
import { secondsLeft, getLiveOffer, heartbeat, acceptOffer } from "../src/driver";
import type { GeraClient } from "../src/client";

describe("secondsLeft", () => {
  const now = new Date("2026-09-25T12:00:00Z").getTime();

  it("counts down to the expiry", () => {
    expect(secondsLeft("2026-09-25T12:00:15Z", now)).toBe(15);
  });

  it("floors at zero rather than going negative", () => {
    expect(secondsLeft("2026-09-25T11:59:50Z", now)).toBe(0);
  });

  it("is zero exactly at the expiry", () => {
    expect(secondsLeft("2026-09-25T12:00:00Z", now)).toBe(0);
  });
});

describe("heartbeat", () => {
  it("never sends status, so dispatch cannot be overwritten", async () => {
    const update = vi.fn().mockReturnThis();
    const chain = { update, eq: vi.fn().mockResolvedValue({ error: null }) };
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as GeraClient;

    await heartbeat(client, "d1", { lat: -1.94, lng: 30.11 });

    const payload = update.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload).toHaveProperty("position");
    expect(payload).toHaveProperty("heartbeat_at");
    // A heartbeat that carried status would flip an on_trip driver back to
    // online and get them offered a second trip.
    expect(payload).not.toHaveProperty("status");
  });
});

describe("getLiveOffer", () => {
  function client(data: unknown) {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "gt", "order", "limit"]) {
      chain[m] = vi.fn().mockReturnValue(chain);
    }
    chain.maybeSingle = vi.fn().mockResolvedValue({ data, error: null });
    return {
      client: { from: vi.fn().mockReturnValue(chain) } as unknown as GeraClient,
      chain,
    };
  }

  it("returns null when there is no offer", async () => {
    const { client: c } = client(null);
    expect(await getLiveOffer(c, "d1")).toBeNull();
  });

  it("flattens the joined trip into the offer", async () => {
    const { client: c } = client({
      id: "o1",
      trip_id: "t1",
      expires_at: "2026-09-25T12:00:15Z",
      eta_seconds: 90,
      trips: {
        pickup_label: "Kimironko Market",
        pickup_note: "blue gate",
        dropoff_label: "Kigali Heights",
        quoted_amount_rwf: 1700,
        vehicle_class: "moto",
      },
    });
    const offer = await getLiveOffer(c, "d1");
    expect(offer?.offerId).toBe("o1");
    expect(offer?.fareRwf).toBe(1700);
    expect(offer?.pickupNote).toBe("blue gate");
  });

  it("filters out offers that have already expired", async () => {
    const { client: c, chain } = client(null);
    await getLiveOffer(c, "d1");
    // Showing a lapsed offer invites the driver to tap accept and be refused.
    expect(chain.gt).toHaveBeenCalledWith("expires_at", expect.any(String));
    expect(chain.is).toHaveBeenCalledWith("outcome", null);
  });
});

describe("acceptOffer", () => {
  it("derives the idempotency key from the offer so a retry cannot double-accept", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { id: "t1", state: "accepted" }, error: null });
    const c = { rpc } as unknown as GeraClient;

    await acceptOffer(c, "o1");
    await acceptOffer(c, "o1");

    expect(rpc.mock.calls[0]?.[1]).toEqual(rpc.mock.calls[1]?.[1]);
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_idempotency_key: "accept-o1" });
  });
});
