import { describe, it, expect, vi } from "vitest";
import { PAYMENT_KINDS, setDefaultPaymentMethod, cancelTrip, getTripContact } from "../src/account";
import type { GeraClient } from "../src/client";

describe("PAYMENT_KINDS", () => {
  it("lists cash first and as the only live method", () => {
    expect(PAYMENT_KINDS[0]?.kind).toBe("cash");
    expect(PAYMENT_KINDS.filter((p) => p.live).map((p) => p.kind)).toEqual(["cash"]);
  });

  it("keeps the unlive methods visible rather than hidden", () => {
    // Hiding them makes the product look thinner than it is; the UI shows them
    // as named, disabled choices.
    expect(PAYMENT_KINDS.length).toBeGreaterThan(1);
    for (const p of PAYMENT_KINDS) expect(p.label.length).toBeGreaterThan(0);
  });
});

describe("setDefaultPaymentMethod", () => {
  it("clears the old default before writing the new one", async () => {
    const order: string[] = [];
    const update = vi.fn(() => {
      order.push("clear");
      return { eq: () => ({ eq: () => Promise.resolve({ error: null }) }) };
    });
    const upsert = vi.fn(() => {
      order.push("set");
      return Promise.resolve({ error: null });
    });
    const client = { from: () => ({ update, upsert }) } as unknown as GeraClient;

    await setDefaultPaymentMethod(client, "u1", "cash");
    // A partial unique index allows one default per user; writing before
    // clearing would be rejected.
    expect(order).toEqual(["clear", "set"]);
  });
});

describe("cancelTrip", () => {
  it("routes through trip_transition rather than a second cancellation path", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = { rpc } as unknown as GeraClient;
    await cancelTrip(client, "t1", "rider");
    expect(rpc).toHaveBeenCalledWith("trip_transition", expect.objectContaining({
      p_to: "cancelled_by_rider",
    }));
  });

  it("uses a stable idempotency key so a retry cannot double-cancel", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = { rpc } as unknown as GeraClient;
    await cancelTrip(client, "t1", "driver");
    await cancelTrip(client, "t1", "driver");
    expect(rpc.mock.calls[0]?.[1]).toEqual(rpc.mock.calls[1]?.[1]);
  });
});

describe("getTripContact", () => {
  it("returns null when the trip is outside the live window", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    const client = { rpc } as unknown as GeraClient;
    expect(await getTripContact(client, "t1")).toBeNull();
  });

  it("flattens the single row the server returns", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ counterparty: "driver", display_name: "Eric", phone: "+250788000000" }],
      error: null,
    });
    const client = { rpc } as unknown as GeraClient;
    const c = await getTripContact(client, "t1");
    expect(c?.counterparty).toBe("driver");
    expect(c?.displayName).toBe("Eric");
  });
});
