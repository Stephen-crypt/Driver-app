import { describe, it, expect } from "vitest";
import { TRIP_STATES, type TripState, type Actor } from "../../src/trip/states";
import { canTransition, applyTransition, TRANSITIONS } from "../../src/trip/machine";

describe("legal transitions", () => {
  it("system may offer a requested trip", () => {
    expect(canTransition("requested", "offered", "system")).toBe(true);
  });

  it("driver may accept an offered trip", () => {
    expect(canTransition("offered", "accepted", "driver")).toBe(true);
  });

  it("driver may mark arrival after accepting", () => {
    expect(canTransition("accepted", "arrived", "driver")).toBe(true);
  });

  it("driver may start the trip after arriving", () => {
    expect(canTransition("arrived", "in_progress", "driver")).toBe(true);
  });

  it("driver may complete a trip in progress", () => {
    expect(canTransition("in_progress", "completed", "driver")).toBe(true);
  });

  it("an offer may bounce back to offered when declined", () => {
    expect(canTransition("offered", "offered", "system")).toBe(true);
  });

  it("applyTransition returns the new state", () => {
    expect(applyTransition("arrived", "in_progress", "driver")).toEqual({
      ok: true,
      state: "in_progress",
    });
  });
});

describe("the negative matrix", () => {
  const ACTORS: Actor[] = ["rider", "driver", "system"];

  const legal = new Set(
    TRANSITIONS.flatMap((r) => r.actors.map((a) => `${r.from}>${r.to}>${a}`)),
  );

  it("rejects every pair not in the transition table", () => {
    const wrongly_allowed: string[] = [];

    for (const from of TRIP_STATES) {
      for (const to of TRIP_STATES) {
        for (const actor of ACTORS) {
          const key = `${from}>${to}>${actor}`;
          if (legal.has(key)) continue;
          if (canTransition(from as TripState, to as TripState, actor)) {
            wrongly_allowed.push(key);
          }
        }
      }
    }

    expect(wrongly_allowed).toEqual([]);
  });

  it("names the reason a driver cannot complete an accepted trip", () => {
    expect(applyTransition("accepted", "completed", "driver")).toEqual({
      ok: false,
      reason: "illegal_edge",
    });
  });

  it("names the reason a rider cannot start a trip", () => {
    expect(applyTransition("arrived", "in_progress", "rider")).toEqual({
      ok: false,
      reason: "wrong_actor",
    });
  });

  it("refuses to move out of a terminal state", () => {
    expect(applyTransition("completed", "in_progress", "driver")).toEqual({
      ok: false,
      reason: "terminal",
    });
  });

  it("never allows a rider to cancel once the trip is in progress", () => {
    expect(canTransition("in_progress", "cancelled_by_rider", "rider")).toBe(false);
  });
});
