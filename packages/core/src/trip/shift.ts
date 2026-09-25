/**
 * NOVA §25: what a rider confirms before a shift. Mirrored by
 * shift_check_keys() in SQL, which refuses a shift with any of these unticked;
 * the parity test keeps the checklist the app draws identical to the one the
 * database enforces.
 */
export const SHIFT_CHECKS = [
  { key: "helmets", label: "Two helmets, both fastening", hint: "One for you, one for your passenger" },
  { key: "lights", label: "Lights and indicators work", hint: "Front, back and both indicators" },
  { key: "brakes", label: "Brakes are firm", hint: "Front and back, before you leave" },
  { key: "tyres", label: "Tyres look right", hint: "No bulges, no bald patches" },
  { key: "fuel", label: "Enough fuel for the shift", hint: "Or a full battery" },
  { key: "phone", label: "Phone charged", hint: "Passengers are tracked through it" },
] as const;

export type ShiftCheckKey = (typeof SHIFT_CHECKS)[number]["key"];

export const VEHICLE_CONDITIONS = [
  { key: "good", label: "Good", hint: "Nothing to report" },
  { key: "minor_issue", label: "Minor issue", hint: "Still safe to ride" },
  { key: "needs_repair", label: "Needs repair", hint: "Should not go out again" },
] as const;

export type VehicleCondition = (typeof VEHICLE_CONDITIONS)[number]["key"];
