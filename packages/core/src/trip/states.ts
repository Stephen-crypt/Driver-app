export const TRIP_STATES = [
  "requested",
  "offered",
  "accepted",
  "arrived",
  "in_progress",
  "completed",
  "cancelled_by_rider",
  "cancelled_by_driver",
  "expired",
  "no_drivers",
] as const;

export type TripState = (typeof TRIP_STATES)[number];

export const ACTORS = ["rider", "driver", "system"] as const;
export type Actor = (typeof ACTORS)[number];

export const TERMINAL_STATES = [
  "completed",
  "cancelled_by_rider",
  "cancelled_by_driver",
  "expired",
  "no_drivers",
] as const satisfies readonly TripState[];

export function isTerminal(state: TripState): boolean {
  return (TERMINAL_STATES as readonly TripState[]).includes(state);
}
