import { describe, it, expect } from "vitest";
import { ROUTE_DOT, railGeometry, statusFor } from "../src/route";
import { theme } from "../src/theme";
import { contrastRatio } from "../src/tokens";

describe("route geometry", () => {
  it("joins the two dots without a gap", () => {
    const { top, height } = railGeometry();
    // The rail must start at the bottom of the first dot and reach the second.
    expect(top).toBe(ROUTE_DOT.size);
    expect(height).toBe(ROUTE_DOT.gap);
  });

  it("keeps the rail thinner than the dots, so it reads as a connector", () => {
    expect(ROUTE_DOT.railWidth).toBeLessThan(ROUTE_DOT.size);
  });
});

describe("statusFor", () => {
  it("never shows a raw state name", () => {
    const states = [
      "completed", "cancelled_by_rider", "cancelled_by_driver", "no_drivers",
      "expired", "requested", "offered", "accepted", "arrived", "in_progress",
    ];
    for (const s of states) {
      expect(statusFor(s).label).not.toContain("_");
    }
  });

  it("marks a completed trip as success and a cancelled one as danger", () => {
    expect(statusFor("completed").tone).toBe("success");
    expect(statusFor("cancelled_by_rider").tone).toBe("danger");
    expect(statusFor("cancelled_by_driver").tone).toBe("danger");
  });

  it("does not colour a trip still running as either", () => {
    for (const s of ["requested", "offered", "accepted", "arrived", "in_progress"]) {
      expect(statusFor(s).tone).toBe("muted");
    }
  });

  it("falls back rather than throwing on a state it has not seen", () => {
    expect(statusFor("something_new").label).toBe("In progress");
  });

  it("every tone it can return is legible on a card", () => {
    // The status is the one word that says whether the rider was charged.
    const tones = { success: theme.success, danger: theme.danger, muted: theme.textMuted };
    for (const colour of Object.values(tones)) {
      expect(contrastRatio(colour, theme.surfaceRaised)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
