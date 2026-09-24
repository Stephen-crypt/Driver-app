import { describe, it, expect } from "vitest";
import { TRIP_STATES, TERMINAL_STATES, isTerminal } from "../../src/trip/states";

describe("trip states", () => {
  it("declares exactly the ten states in the spec", () => {
    expect([...TRIP_STATES].sort()).toEqual([
      "accepted",
      "arrived",
      "cancelled_by_driver",
      "cancelled_by_rider",
      "completed",
      "expired",
      "in_progress",
      "no_drivers",
      "offered",
      "requested",
    ]);
  });

  it("treats completed as terminal", () => {
    expect(isTerminal("completed")).toBe(true);
  });

  it("treats in_progress as non-terminal", () => {
    expect(isTerminal("in_progress")).toBe(false);
  });

  it("marks every cancellation and dead-end as terminal", () => {
    expect([...TERMINAL_STATES].sort()).toEqual([
      "cancelled_by_driver",
      "cancelled_by_rider",
      "completed",
      "expired",
      "no_drivers",
    ]);
  });
});
