import { describe, it, expect } from "vitest";
import { SHEET_HEIGHTS, sheetHeightFor, sheetTitleFor } from "../src/sheet";

describe("sheet heights", () => {
  it("are ordered", () => {
    const { collapsed, peek, half, tall } = SHEET_HEIGHTS;
    expect(collapsed).toBeLessThan(peek);
    expect(peek).toBeLessThan(half);
    expect(half).toBeLessThan(tall);
  });

  it("never covers the whole screen, so the map is always visible", () => {
    expect(SHEET_HEIGHTS.tall).toBeLessThan(1);
    expect(SHEET_HEIGHTS.tall).toBeLessThanOrEqual(0.9);
  });
});

describe("sheetHeightFor", () => {
  it("shows a small sheet while idle", () => {
    expect(sheetHeightFor("idle")).toBe(SHEET_HEIGHTS.peek);
  });

  it("grows while searching for a rider", () => {
    expect(sheetHeightFor("requested")).toBe(SHEET_HEIGHTS.half);
  });

  it("makes room for the rider card once a rider is assigned", () => {
    // accepted and arrived carry a route, a fare, a rider card and an action
    // row; at half height the actions were clipped with no way to reach them.
    expect(sheetHeightFor("accepted")).toBe(SHEET_HEIGHTS.tall);
    expect(sheetHeightFor("arrived")).toBe(SHEET_HEIGHTS.tall);
  });

  it("shrinks once the trip is moving, so the map gets more of the screen", () => {
    expect(sheetHeightFor("in_progress")).toBeLessThan(sheetHeightFor("accepted"));
  });

  it("uses the tallest sheet for the receipt", () => {
    expect(sheetHeightFor("completed")).toBe(SHEET_HEIGHTS.tall);
  });

  it("falls back to peek for an unknown state rather than throwing", () => {
    expect(sheetHeightFor("something_new")).toBe(SHEET_HEIGHTS.peek);
  });
});

describe("sheetTitleFor", () => {
  it("tells the passenger what is happening, not what the state is called", () => {
    expect(sheetTitleFor("requested")).toBe("Finding you a rider");
    expect(sheetTitleFor("offered")).toBe("Finding you a rider");
    expect(sheetTitleFor("accepted")).toBe("Rider on the way");
    expect(sheetTitleFor("arrived")).toBe("Your rider is here");
    expect(sheetTitleFor("in_progress")).toBe("On the way");
    expect(sheetTitleFor("completed")).toBe("Trip complete");
    expect(sheetTitleFor("no_riders")).toBe("No riders nearby");
  });

  it("never leaks a raw state name to a passenger", () => {
    const states = [
      "idle",
      "picking",
      "quoted",
      "requested",
      "offered",
      "accepted",
      "arrived",
      "in_progress",
      "completed",
      "no_riders",
      "cancelled_by_passenger",
      "cancelled_by_rider",
      "expired",
    ];
    for (const s of states) {
      const title = sheetTitleFor(s);
      expect(title).not.toContain("_");
      expect(title.length).toBeGreaterThan(0);
    }
  });
});
