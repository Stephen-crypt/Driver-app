import { describe, it, expect, vi } from "vitest";
import { addPromoCode, isPromoUnavailable, listMyPromos, promoLabel, promoMisfit, PROMO_RAN_OUT } from "../src/promos";
import { requestQuote } from "../src/trips";
import { getTripTotal } from "../src/shift";
import type { NovaClient } from "../src/client";

const rpcClient = (data: unknown, error: unknown = null) =>
  ({ rpc: vi.fn().mockResolvedValue({ data, error }) }) as unknown as NovaClient;

describe("promoLabel", () => {
  it("says what a fixed amount takes off", () => {
    expect(promoLabel({ kind: "amount", amountRwf: 500, percent: null, maxDiscountRwf: null })).toBe("500 RWF off");
  });
  it("says what a percentage takes off", () => {
    expect(promoLabel({ kind: "percent", amountRwf: null, percent: 30, maxDiscountRwf: null })).toBe("30% off");
  });
  it("and its cap", () => {
    expect(promoLabel({ kind: "percent", amountRwf: null, percent: 30, maxDiscountRwf: 1000 })).toBe(
      "30% off, up to 1,000 RWF",
    );
  });
});

const ROW = {
  promo_id: "p1",
  code: "NOVA50",
  kind: "amount",
  amount_rwf: 500,
  percent: null,
  max_discount_rwf: null,
  ends_at: "2026-10-30T22:00:00Z",
  uses_left: 1,
};

describe("addPromoCode", () => {
  it("sends the code as typed and returns what it gives", async () => {
    const c = rpcClient([{ result: "added", ...ROW }]);
    const r = await addPromoCode(c, " nova 50 ");
    expect(c.rpc).toHaveBeenCalledWith("add_promo_code", { p_code: "nova 50" });
    expect(r).toEqual({
      ok: true,
      already: false,
      promo: {
        id: "p1",
        code: "NOVA50",
        kind: "amount",
        amountRwf: 500,
        percent: null,
        maxDiscountRwf: null,
        endsAt: "2026-10-30T22:00:00Z",
        usesLeft: 1,
      },
    });
  });

  it("treats a code already saved as success", async () => {
    const r = await addPromoCode(rpcClient([{ result: "already_added", ...ROW }]), "NOVA50");
    expect(r.ok && r.already).toBe(true);
  });

  it.each([
    ["not_found", "That code isn't right. Check it and try again."],
    ["ended", "That code has ended."],
    ["used_up", "That code has been used up."],
    ["already_used", "You've already used that code."],
    ["paused", "That code isn't active right now."],
    ["not_started", "That code isn't active yet."],
    ["too_many_tries", "Too many tries. Wait an hour and try again."],
  ])("says why %s", async (result, words) => {
    expect(await addPromoCode(rpcClient([{ result }]), "X1X1")).toEqual({ ok: false, message: words });
  });

  it("asks for a code when the field is blank, without calling the server", async () => {
    const c = rpcClient(null);
    expect(await addPromoCode(c, "  ")).toEqual({ ok: false, message: "Type a code first." });
    expect(c.rpc).not.toHaveBeenCalled();
  });

  it("throws when the server errors", async () => {
    await expect(addPromoCode(rpcClient(null, { message: "boom" }), "NOVA50")).rejects.toThrow("boom");
  });
});

describe("listMyPromos", () => {
  it("maps the saved codes", async () => {
    const c = rpcClient([
      { ...ROW, min_fare_rwf: null, vehicle_classes: ["moto"], status: "ready" },
    ]);
    const [p] = await listMyPromos(c);
    expect(c.rpc).toHaveBeenCalledWith("my_promos");
    expect(p).toMatchObject({ id: "p1", code: "NOVA50", vehicleClasses: ["moto"], usesLeft: 1, status: "ready" });
  });
});

describe("isPromoUnavailable", () => {
  it("knows a booking refused because the code ran out", () => {
    expect(isPromoUnavailable(new Error("promo_unavailable"))).toBe(true);
    expect(isPromoUnavailable(new Error("quote_expired"))).toBe(false);
    expect(PROMO_RAN_OUT).toMatch(/just run out/);
  });
});

describe("requestQuote with a promo", () => {
  const ROUTE = { pickup: { lat: -1.9441, lng: 30.1127 }, dropoff: { lat: -1.9536, lng: 30.0588 } };
  const fn = (data: unknown) =>
    ({ functions: { invoke: vi.fn().mockResolvedValue({ data, error: null }) } }) as unknown as NovaClient;

  it("passes the choice and reads the code and the price to pay", async () => {
    const c = fn({
      quoteId: "q1", amountRwf: 1700, expiresAt: "x", vehicleClass: "moto", distanceM: 4000, durationS: 720,
      promo: { id: "p1", code: "NOVA50", discountRwf: 500 }, payRwf: 1200,
    });
    const q = await requestQuote(c, { vehicleClass: "moto", distanceM: 4000, durationS: 720, ...ROUTE, promo: "none" });
    expect(c.functions.invoke).toHaveBeenCalledWith("quote", {
      body: expect.objectContaining({ promo: "none" }),
    });
    expect(q.promo?.code).toBe("NOVA50");
    expect(q.payRwf).toBe(1200);
  });

  it("reads a quote from a server without promos as paying the full price", async () => {
    const q = await requestQuote(
      fn({ quoteId: "q1", amountRwf: 1700, expiresAt: "x", vehicleClass: "moto", distanceM: 4000, durationS: 720 }),
      { vehicleClass: "moto", distanceM: 4000, durationS: 720, ...ROUTE },
    );
    expect(q.promo).toBeNull();
    expect(q.payRwf).toBe(1700);
  });
});

describe("getTripTotal with a promo", () => {
  const single = (data: unknown) =>
    ({ rpc: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data, error: null }) }) }) as unknown as NovaClient;

  it("reads the promo and what was paid", async () => {
    const t = await getTripTotal(
      single({ total_rwf: 2200, fare_rwf: 2000, waiting_charge_rwf: 200, promo_discount_rwf: 500, paid_rwf: 1700, promo_code: "NOVA50" }),
      "t1",
    );
    expect(t).toEqual({
      totalRwf: 2200, fareRwf: 2000, waitingChargeRwf: 200, promoDiscountRwf: 500, paidRwf: 1700, promoCode: "NOVA50",
    });
  });

  it("reads an older trip as paid in full", async () => {
    const t = await getTripTotal(single({ total_rwf: 2200, fare_rwf: 2000, waiting_charge_rwf: 200 }), "t1");
    expect(t).toMatchObject({ promoDiscountRwf: 0, paidRwf: 2200, promoCode: null });
  });
});

describe("promoMisfit", () => {
  const p = {
    id: "p1", code: "CAB20", kind: "amount" as const, amountRwf: 500, percent: null, maxDiscountRwf: null,
    endsAt: null, usesLeft: 1, status: "ready" as const, minFareRwf: 2000, vehicleClasses: ["cab", "cab_xl"],
  };
  it("names the vehicle types a code is for", () => {
    expect(promoMisfit(p, "moto", 3000)).toBe("Cab and Cab XL only");
  });
  it("names the smallest fare it works on", () => {
    expect(promoMisfit(p, "cab", 1500)).toBe("For rides from 2,000 RWF");
  });
  it("says nothing when it fits", () => {
    expect(promoMisfit(p, "cab", 2500)).toBeNull();
    expect(promoMisfit({ ...p, minFareRwf: null, vehicleClasses: null }, "moto", 100)).toBeNull();
  });
});
