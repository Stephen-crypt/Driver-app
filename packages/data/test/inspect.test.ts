import { describe, it, expect, vi } from "vitest";
import { INSPECTION_ITEMS, bestResultFor, inspectLookup } from "../src/inspect";
import type { NovaClient } from "../src/client";

describe("the checklist", () => {
  it("has the same keys as public.inspection_items(), in order", () => {
    // The database refuses unknown keys; this catches the drift before it does.
    expect(INSPECTION_ITEMS.map((i) => i.key)).toEqual([
      "identity", "documents", "vest", "helmets", "brakes", "lights", "tyres", "mirrors", "bodywork", "safety_kit",
    ]);
  });
});

describe("bestResultFor", () => {
  it("allows a pass only when nothing failed and the test was clean", () => {
    expect(bestResultFor({ brakes: "pass", lights: "na" }, "negative")).toBe("pass");
    expect(bestResultFor({ brakes: "fail" }, null)).toBe("fail");
    expect(bestResultFor({}, "refused")).toBe("fail");
  });
});

describe("inspectLookup", () => {
  it("explains a code that matches nobody", async () => {
    const rpc = vi.fn(() => Promise.resolve({ data: null, error: { message: "not_found" } }));
    await expect(inspectLookup({ rpc } as unknown as NovaClient, " 9999 ")).rejects.toThrow(/Nobody matches/);
    expect(rpc).toHaveBeenCalledWith("inspect_lookup", { p_code: "9999" });
  });
});
