import { describe, it, expect, vi } from "vitest";
import { requestQuote, completeTrip } from "../src/trips";
import type { GeraClient } from "../src/client";

function fakeClient(invokeResult: unknown, error: unknown = null): GeraClient {
  return {
    functions: { invoke: vi.fn().mockResolvedValue({ data: invokeResult, error }) },
  } as unknown as GeraClient;
}

describe("requestQuote", () => {
  it("returns the quote the edge function issued", async () => {
    const client = fakeClient({
      quoteId: "q1", amountRwf: 1700, expiresAt: "2026-09-24T12:00:00Z",
      vehicleClass: "moto", distanceM: 4000, durationS: 720,
    });
    const q = await requestQuote(client, {
      vehicleClass: "moto", distanceM: 4000, durationS: 720,
    });
    expect(q.amountRwf).toBe(1700);
    expect(q.quoteId).toBe("q1");
  });

  it("throws when the edge function reports an error", async () => {
    const client = fakeClient(null, { message: "no_fare_policy" });
    await expect(
      requestQuote(client, { vehicleClass: "moto", distanceM: 4000, durationS: 720 }),
    ).rejects.toThrow("no_fare_policy");
  });

  it("throws when the response is empty", async () => {
    const client = fakeClient(null);
    await expect(
      requestQuote(client, { vehicleClass: "moto", distanceM: 4000, durationS: 720 }),
    ).rejects.toThrow("quote failed");
  });
});

describe("completeTrip", () => {
  it("requires an idempotency key", async () => {
    const client = fakeClient({});
    await expect(
      completeTrip(client, { tripId: "t1", actualDistanceM: 4000, idempotencyKey: "" }),
    ).rejects.toThrow("idempotencyKey is required");
  });

  it("returns the receipt", async () => {
    const client = fakeClient({
      tripId: "t1", state: "completed",
      receipt: { lines: [{ label: "Fare", amountRwf: 1700 }], totalRwf: 1700 },
      commissionRwf: 255,
    });
    const r = await completeTrip(client, {
      tripId: "t1", actualDistanceM: 4000, idempotencyKey: "k1",
    });
    expect(r.receipt.totalRwf).toBe(1700);
    expect(r.commissionRwf).toBe(255);
  });
});
