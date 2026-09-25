export const TRIP_STATES = [
  "requested",
  "offered",
  "accepted",
  "arrived",
  "in_progress",
  "completed",
  "cancelled_by_passenger",
  "cancelled_by_rider",
  "expired",
  "no_riders",
] as const;

export type TripState = (typeof TRIP_STATES)[number];

export const ACTORS = ["passenger", "rider", "system"] as const;
export type Actor = (typeof ACTORS)[number];

export const TERMINAL_STATES = [
  "completed",
  "cancelled_by_passenger",
  "cancelled_by_rider",
  "expired",
  "no_riders",
] as const satisfies readonly TripState[];

export function isTerminal(state: TripState): boolean {
  return (TERMINAL_STATES as readonly TripState[]).includes(state);
}
