/**
 * Fractions of screen height. The sheet never reaches 1 - spec 5.1 keeps the
 * map visible at every stage so the rider never loses spatial context.
 */
export const SHEET_HEIGHTS = {
  collapsed: 0.14,
  peek: 0.3,
  half: 0.45,
  tall: 0.62,
} as const;

/**
 * Spec 5.1: the sheet's shape is a pure function of the trip state, which is
 * what stops the UI from disagreeing with the server. Once the trip is moving
 * the sheet shrinks again - the rider wants the map, not a status card.
 */
const HEIGHT_BY_STATE: Record<string, number> = {
  idle: SHEET_HEIGHTS.peek,
  picking: SHEET_HEIGHTS.tall,
  quoted: SHEET_HEIGHTS.half,
  requested: SHEET_HEIGHTS.half,
  offered: SHEET_HEIGHTS.half,
  accepted: SHEET_HEIGHTS.half,
  arrived: SHEET_HEIGHTS.half,
  in_progress: SHEET_HEIGHTS.peek,
  completed: SHEET_HEIGHTS.tall,
  no_drivers: SHEET_HEIGHTS.half,
  cancelled_by_rider: SHEET_HEIGHTS.half,
  cancelled_by_driver: SHEET_HEIGHTS.half,
  expired: SHEET_HEIGHTS.half,
};

export function sheetHeightFor(state: string): number {
  return HEIGHT_BY_STATE[state] ?? SHEET_HEIGHTS.peek;
}

/**
 * Riders read intent, not schema. "offered" is an implementation detail of
 * dispatch: from the rider's side the app is still looking for someone.
 */
const TITLE_BY_STATE: Record<string, string> = {
  idle: "Where to?",
  picking: "Where to?",
  quoted: "Confirm your ride",
  requested: "Finding you a driver",
  offered: "Finding you a driver",
  accepted: "Driver on the way",
  arrived: "Your driver is here",
  in_progress: "On the way",
  completed: "Trip complete",
  no_drivers: "No drivers nearby",
  cancelled_by_rider: "Trip cancelled",
  cancelled_by_driver: "Trip cancelled",
  expired: "That request timed out",
};

export function sheetTitleFor(state: string): string {
  return TITLE_BY_STATE[state] ?? "Where to?";
}
