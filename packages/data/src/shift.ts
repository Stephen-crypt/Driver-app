import type { NovaClient } from "./client";
import { dataError } from "./client";
import type { Coords } from "./rider";

// ---------------------------------------------------------------------------
// Shifts (NOVA §25)
// ---------------------------------------------------------------------------

export interface Shift {
  readonly id: string;
  readonly vehicleId: string;
  readonly startedAt: string;
}

export interface ShiftSummary {
  readonly shiftId: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly trips: number;
  readonly collectedRwf: number;
  readonly earnedRwf: number;
  /** Everything the rider is carrying, not just this shift's: what they hand in. */
  readonly cashHeldRwf: number;
}

export type VehicleConditionKey = "good" | "minor_issue" | "needs_repair";

export async function getOpenShift(client: NovaClient, riderId: string): Promise<Shift | null> {
  const { data, error } = await client
    .from("shifts")
    .select("id, vehicle_id, started_at")
    .eq("rider_id", riderId)
    .is("ended_at", null)
    .maybeSingle();
  if (error) throw dataError(error.message);
  if (!data) return null;
  const r = data as { id: string; vehicle_id: string; started_at: string };
  return { id: r.id, vehicleId: r.vehicle_id, startedAt: r.started_at };
}

/**
 * The database refuses a shift with any check unticked and names the ones that
 * failed. The checklist is sent whole - the server decides, not the screen.
 */
export async function startShift(
  client: NovaClient,
  checks: Readonly<Record<string, boolean>>,
  at: Coords | null,
): Promise<Shift> {
  const { data, error } = await client.rpc("start_shift", {
    p_checks: checks,
    p_lng: at?.lng ?? null,
    p_lat: at?.lat ?? null,
  });
  if (error) throw new Error(shiftErrorMessage(error.message));
  const r = data as { id: string; vehicle_id: string; started_at: string };
  return { id: r.id, vehicleId: r.vehicle_id, startedAt: r.started_at };
}

export async function endShift(
  client: NovaClient,
  condition: VehicleConditionKey,
  notes: string,
  at: Coords | null,
): Promise<ShiftSummary> {
  const { data, error } = await client.rpc("end_shift", {
    p_condition: condition,
    p_notes: notes,
    p_lng: at?.lng ?? null,
    p_lat: at?.lat ?? null,
  });
  if (error) throw new Error(shiftErrorMessage(error.message));
  const r = data as {
    shift_id: string;
    started_at: string;
    ended_at: string;
    trips: number;
    collected_rwf: number;
    earned_rwf: number;
    cash_held_rwf: number;
  };
  return {
    shiftId: r.shift_id,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    trips: r.trips,
    collectedRwf: r.collected_rwf,
    earnedRwf: r.earned_rwf,
    cashHeldRwf: r.cash_held_rwf,
  };
}

/** Database error codes, in words a rider can act on. */
export function shiftErrorMessage(raw: string): string {
  if (raw.includes("no_vehicle")) return "No vehicle is assigned to you. Ask the fleet office.";
  if (raw.includes("not_verified")) return "Your account has not been approved yet.";
  if (raw.includes("safety_check_failed")) {
    return "Every check has to pass before you ride. Report the problem instead.";
  }
  if (raw.includes("trip_in_progress")) return "Finish your trip before ending the shift.";
  if (raw.includes("no_open_shift")) return "You are not on a shift.";
  return raw;
}

// ---------------------------------------------------------------------------
// Ride PIN (NOVA §18)
// ---------------------------------------------------------------------------

export type StartTripResult =
  | { readonly started: true }
  | { readonly started: false; readonly reason: "wrong_pin" | "locked"; readonly attemptsLeft: number };

/** The rider types what the passenger reads out. A wrong PIN is an answer, not an error. */
export async function startTrip(
  client: NovaClient,
  tripId: string,
  pin: string,
): Promise<StartTripResult> {
  const { data, error } = await client.rpc("start_trip", {
    p_trip_id: tripId,
    p_pin: pin,
    // One key per attempt: the idempotency key guards the transition, and a
    // retried wrong PIN followed by the right one must not replay the failure.
    p_idempotency_key: `start-${tripId}-${pin}`,
  });
  if (error) throw dataError(error.message);
  const r = data as { started: boolean; reason?: string; attempts_left?: number };
  if (r.started) return { started: true };
  return {
    started: false,
    reason: r.reason === "locked" ? "locked" : "wrong_pin",
    attemptsLeft: r.attempts_left ?? 0,
  };
}

/** The passenger's PIN, once a rider is assigned. Null before that. */
export async function getRidePin(client: NovaClient, tripId: string): Promise<string | null> {
  const { data, error } = await client.rpc("trip_ride_pin", { p_trip_id: tripId });
  if (error) throw dataError(error.message);
  return (data as string | null) ?? null;
}

// ---------------------------------------------------------------------------
// Waiting time and no-show (NOVA §15, §16)
// ---------------------------------------------------------------------------

export interface WaitStatus {
  readonly arrivedAt: string | null;
  readonly graceSeconds: number;
  readonly perMinuteRwf: number;
  readonly waitedSeconds: number;
  readonly chargeRwf: number;
}

export async function getWaitStatus(client: NovaClient, tripId: string): Promise<WaitStatus | null> {
  const { data, error } = await client
    .rpc("trip_wait_status", { p_trip_id: tripId })
    .maybeSingle();
  if (error) throw dataError(error.message);
  if (!data) return null;
  const r = data as {
    arrived_at: string | null;
    grace_seconds: number;
    per_minute_rwf: number;
    waited_seconds: number;
    charge_rwf: number;
  };
  return {
    arrivedAt: r.arrived_at,
    graceSeconds: r.grace_seconds,
    perMinuteRwf: r.per_minute_rwf,
    waitedSeconds: r.waited_seconds,
    chargeRwf: r.charge_rwf,
  };
}

/**
 * Seconds waited so far, counted locally from the arrival time so the clock
 * ticks without a request a second. The server's figure is what bills.
 */
export function waitedSecondsNow(arrivedAt: string | null, now = Date.now()): number {
  if (!arrivedAt) return 0;
  return Math.max(0, Math.floor((now - new Date(arrivedAt).getTime()) / 1000));
}

export async function reportNoShow(
  client: NovaClient,
  tripId: string,
  reason: string,
  at: Coords | null,
): Promise<void> {
  const { error } = await client.rpc("report_no_show", {
    p_trip_id: tripId,
    p_reason: reason,
    p_lng: at?.lng ?? null,
    p_lat: at?.lat ?? null,
    p_idempotency_key: `no-show-${tripId}`,
  });
  if (error) {
    if (error.message.includes("grace_not_elapsed")) {
      throw new Error("You can report this once the free waiting time is over.");
    }
    throw dataError(error.message);
  }
}

export interface TripTotal {
  readonly totalRwf: number;
  readonly fareRwf: number;
  readonly waitingChargeRwf: number;
}

/** What a finished trip actually cost, from the completion record. */
export async function getTripTotal(client: NovaClient, tripId: string): Promise<TripTotal | null> {
  const { data, error } = await client
    .rpc("trip_total_rwf", { p_trip_id: tripId })
    .maybeSingle();
  if (error) throw dataError(error.message);
  if (!data) return null;
  const r = data as { total_rwf: number; fare_rwf: number; waiting_charge_rwf: number };
  return { totalRwf: r.total_rwf, fareRwf: r.fare_rwf, waitingChargeRwf: r.waiting_charge_rwf };
}

// ---------------------------------------------------------------------------
// Reports (NOVA §25, §29)
// ---------------------------------------------------------------------------

export type ReportKind = "vehicle_problem" | "safety_issue" | "accident" | "incident";

export const REPORT_KINDS: readonly { kind: ReportKind; label: string; hint: string }[] = [
  { kind: "vehicle_problem", label: "Vehicle problem", hint: "Brakes, lights, a flat, anything mechanical" },
  { kind: "safety_issue", label: "Safety issue", hint: "Road hazard, a threat, something unsafe" },
  { kind: "accident", label: "Accident", hint: "Any collision, however small" },
  { kind: "incident", label: "Something else", hint: "A dispute, lost property, anything to log" },
];

export async function reportIssue(
  client: NovaClient,
  kind: ReportKind,
  note: string,
  tripId: string | null,
  at: Coords | null,
): Promise<void> {
  const { error } = await client.rpc("report_issue", {
    p_kind: kind,
    p_note: note,
    p_trip_id: tripId,
    p_lng: at?.lng ?? null,
    p_lat: at?.lat ?? null,
  });
  if (error) throw dataError(error.message);
}
