import type { Actor, TripState } from "./states";

export interface TransitionRule {
  readonly from: TripState;
  readonly to: TripState;
  readonly actors: readonly Actor[];
}

/**
 * The complete set of legal edges. Anything absent from this list is illegal.
 * This table is mirrored in SQL by is_legal_transition(); the parity test in
 * Task 9 proves the two copies agree.
 */
export const TRANSITIONS: readonly TransitionRule[] = [
  { from: "requested", to: "offered", actors: ["system"] },
  { from: "requested", to: "no_riders", actors: ["system"] },
  { from: "requested", to: "cancelled_by_passenger", actors: ["passenger"] },

  // A declined or timed-out offer re-enters `offered` for the next candidate.
  { from: "offered", to: "offered", actors: ["system"] },
  { from: "offered", to: "accepted", actors: ["rider"] },
  { from: "offered", to: "expired", actors: ["system"] },
  { from: "offered", to: "no_riders", actors: ["system"] },
  { from: "offered", to: "cancelled_by_passenger", actors: ["passenger"] },

  { from: "accepted", to: "arrived", actors: ["rider"] },
  { from: "accepted", to: "cancelled_by_passenger", actors: ["passenger"] },
  { from: "accepted", to: "cancelled_by_rider", actors: ["rider"] },
  // Heartbeat loss re-dispatches a trip that never reached pickup.
  { from: "accepted", to: "offered", actors: ["system"] },

  { from: "arrived", to: "in_progress", actors: ["rider"] },
  { from: "arrived", to: "cancelled_by_passenger", actors: ["passenger"] },
  { from: "arrived", to: "cancelled_by_rider", actors: ["rider"] },

  { from: "in_progress", to: "completed", actors: ["rider"] },
] as const;
