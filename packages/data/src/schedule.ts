import type { NovaClient } from "./client";
import { dataError } from "./client";
import type { CreateTripArgs } from "./trips";

/**
 * Rwanda keeps one clock all year, UTC+2 with no daylight saving. Times are
 * written with that offset explicitly, so a phone set to the wrong zone still
 * books the 7:30 the passenger meant.
 */
export const KIGALI_OFFSET = "+02:00";

const pad = (n: number) => String(n).padStart(2, "0");

/** The calendar date in Kigali right now, as YYYY-MM-DD. */
export function kigaliToday(now = new Date()): string {
  const k = new Date(now.getTime() + 2 * 3600_000);
  return `${k.getUTCFullYear()}-${pad(k.getUTCMonth() + 1)}-${pad(k.getUTCDate())}`;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** A Kigali date and HH:MM as one instant. */
export function kigaliInstant(date: string, time: string): Date {
  return new Date(`${date}T${time}:00${KIGALI_OFFSET}`);
}

const WEEKDAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** ISO weekday, 1 = Monday, of a YYYY-MM-DD. */
export function isoWeekday(date: string): number {
  const d = new Date(`${date}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** "Today", "Tomorrow", then "Thu 2". */
export function dayLabel(date: string, today = kigaliToday()): string {
  if (date === today) return "Today";
  if (date === addDays(today, 1)) return "Tomorrow";
  return `${WEEKDAY[isoWeekday(date) - 1]} ${Number(date.slice(8, 10))}`;
}

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Mon 28 Sep" - for dates far enough off that "Tomorrow" does not apply. */
export function dateLabel(date: string): string {
  return `${WEEKDAY[isoWeekday(date) - 1]} ${Number(date.slice(8, 10))} ${MONTH[Number(date.slice(5, 7)) - 1]}`;
}

/** How a set of weekdays is said out loud. */
export function daysLabel(days: readonly number[]): string {
  const set = [...new Set(days)].sort((a, b) => a - b);
  const key = set.join(",");
  if (key === "1,2,3,4,5,6,7") return "Every day";
  if (key === "1,2,3,4,5") return "Weekdays";
  if (key === "6,7") return "Weekends";
  return set.map((d) => WEEKDAY[d - 1]).join(", ");
}

/**
 * Pickup times offered for a day: every 15 minutes, starting far enough from
 * now that the booking is really ahead (the server refuses less than its
 * minimum lead), from 05:00 to 22:45.
 */
export function timeSlots(date: string, minLeadMinutes = 30, now = new Date()): string[] {
  const out: string[] = [];
  const earliest = now.getTime() + minLeadMinutes * 60_000;
  for (let h = 5; h <= 22; h++) {
    for (const m of [0, 15, 30, 45]) {
      const t = `${pad(h)}:${pad(m)}`;
      if (kigaliInstant(date, t).getTime() >= earliest) out.push(t);
    }
  }
  return out;
}

export function scheduleErrorMessage(raw: string): string {
  if (raw.includes("too_soon")) return "Pick a time at least 30 minutes from now - or book a ride now.";
  if (raw.includes("too_far_ahead")) return "Rides can be booked up to 30 days ahead.";
  if (raw.includes("schedule_too_long")) return "A schedule can run for up to three months.";
  if (raw.includes("starts_in_the_past")) return "Pick a start date from today onwards.";
  if (raw.includes("quote_expired")) return "That price has expired. Go back and pick again.";
  if (raw.includes("ride_already_released")) return "This ride is already looking for a rider, so it can't be moved now.";
  if (raw.includes("pick_a_day")) return "Pick at least one day.";
  if (raw.includes("ends_in_the_past")) return "Pick an end date from today onwards.";
  if (raw.includes("schedule_not_active")) return "This regular trip has been cancelled.";
  return raw;
}

// ---------------------------------------------------------------------------

export async function scheduleTrip(
  client: NovaClient,
  args: CreateTripArgs & { readonly scheduledFor: Date },
): Promise<{ id: string; state: string }> {
  const { data, error } = await client.rpc("schedule_trip_from_quote", {
    p_quote_id: args.quoteId,
    p_pickup: `POINT(${args.pickup.lng} ${args.pickup.lat})`,
    p_pickup_label: args.pickupLabel,
    p_pickup_note: args.pickupNote ?? null,
    p_dropoff: `POINT(${args.dropoff.lng} ${args.dropoff.lat})`,
    p_dropoff_label: args.dropoffLabel,
    p_scheduled_for: args.scheduledFor.toISOString(),
  });
  if (error) throw new Error(scheduleErrorMessage(error.message));
  return data as { id: string; state: string };
}

export async function createRecurringSchedule(
  client: NovaClient,
  args: CreateTripArgs & {
    readonly days: readonly number[];
    readonly time: string;
    readonly startDate: string;
    readonly endDate: string;
  },
): Promise<{ id: string }> {
  const { data, error } = await client.rpc("create_recurring_schedule", {
    p_quote_id: args.quoteId,
    p_pickup: `POINT(${args.pickup.lng} ${args.pickup.lat})`,
    p_pickup_label: args.pickupLabel,
    p_pickup_note: args.pickupNote ?? null,
    p_dropoff: `POINT(${args.dropoff.lng} ${args.dropoff.lat})`,
    p_dropoff_label: args.dropoffLabel,
    p_days: args.days,
    p_time: args.time,
    p_start: args.startDate,
    p_end: args.endDate,
  });
  if (error) throw new Error(scheduleErrorMessage(error.message));
  return data as { id: string };
}

export interface UpcomingRide {
  readonly id: string;
  readonly scheduledFor: string;
  readonly pickupLabel: string;
  readonly dropoffLabel: string;
  readonly fareRwf: number | null;
  readonly vehicleClass: string;
  readonly scheduleId: string | null;
  /** Moved by the passenger from the schedule's usual time. */
  readonly moved: boolean;
  /** Who is planned to take it. A plan, not a promise. */
  readonly riderName: string | null;
  readonly riderVest: string | null;
}

export async function listUpcoming(client: NovaClient, _passengerId: string): Promise<UpcomingRide[]> {
  // The function reads the signed-in passenger's own rides; it adds the rider
  // planned for each, whom the passenger cannot read from profiles directly.
  const { data, error } = await client.rpc("my_upcoming_rides");
  if (error) throw dataError(error.message);
  return ((data ?? []) as {
    id: string;
    scheduled_for: string;
    pickup_label: string;
    dropoff_label: string;
    quoted_amount_rwf: number | null;
    vehicle_class: string;
    recurring_schedule_id: string | null;
    moved: boolean;
    rider_name: string | null;
    rider_vest: string | null;
  }[]).map((r) => ({
    id: r.id,
    scheduledFor: r.scheduled_for,
    pickupLabel: r.pickup_label,
    dropoffLabel: r.dropoff_label,
    fareRwf: r.quoted_amount_rwf,
    vehicleClass: r.vehicle_class,
    scheduleId: r.recurring_schedule_id,
    moved: r.moved,
    riderName: r.rider_name,
    riderVest: r.rider_vest,
  }));
}

/** Moves one booked ride to another time the same day. */
export async function changeRideTime(client: NovaClient, tripId: string, time: string): Promise<string> {
  const { data, error } = await client.rpc("change_ride_time", { p_trip_id: tripId, p_time: time });
  if (error) throw new Error(scheduleErrorMessage(error.message));
  return data as string;
}

/** Changes a regular trip from now on. Rides moved one by one keep their time. */
export async function changeSchedule(
  client: NovaClient,
  scheduleId: string,
  change: { days: readonly number[]; time: string; endDate: string },
): Promise<{ moved: number; cancelled: number; added: number }> {
  const { data, error } = await client.rpc("change_recurring_schedule", {
    p_schedule_id: scheduleId,
    p_days: change.days,
    p_time: change.time,
    p_end: change.endDate,
  });
  if (error) throw new Error(scheduleErrorMessage(error.message));
  return data as { moved: number; cancelled: number; added: number };
}

export interface PlannedRide {
  readonly id: string;
  readonly scheduledFor: string;
  readonly pickupLabel: string;
  readonly dropoffLabel: string;
  readonly passengerName: string;
}

/** Rides operations has planned for the signed-in rider, the next seven days. */
export async function listPlannedRides(client: NovaClient): Promise<PlannedRide[]> {
  const { data, error } = await client.rpc("my_planned_rides");
  if (error) throw dataError(error.message);
  return ((data ?? []) as { id: string; scheduled_for: string; pickup_label: string; dropoff_label: string; passenger_name: string }[]).map((r) => ({
    id: r.id,
    scheduledFor: r.scheduled_for,
    pickupLabel: r.pickup_label,
    dropoffLabel: r.dropoff_label,
    passengerName: r.passenger_name,
  }));
}

export interface RecurringSchedule {
  readonly id: string;
  readonly days: number[];
  readonly timeOfDay: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly pickupLabel: string;
  readonly dropoffLabel: string;
  readonly amountRwf: number;
  readonly vehicleClass: string;
  readonly status: "active" | "cancelled";
}

export async function listSchedules(client: NovaClient, passengerId: string): Promise<RecurringSchedule[]> {
  const { data, error } = await client
    .from("recurring_schedules")
    .select("id, days, time_of_day, start_date, end_date, pickup_label, dropoff_label, amount_rwf, vehicle_class, status")
    .eq("passenger_id", passengerId)
    .eq("status", "active")
    .gte("end_date", kigaliToday())
    .order("created_at", { ascending: false });
  if (error) throw dataError(error.message);
  return ((data ?? []) as {
    id: string;
    days: number[];
    time_of_day: string;
    start_date: string;
    end_date: string;
    pickup_label: string;
    dropoff_label: string;
    amount_rwf: number;
    vehicle_class: string;
    status: "active" | "cancelled";
  }[]).map((r) => ({
    id: r.id,
    days: r.days,
    timeOfDay: r.time_of_day.slice(0, 5),
    startDate: r.start_date,
    endDate: r.end_date,
    pickupLabel: r.pickup_label,
    dropoffLabel: r.dropoff_label,
    amountRwf: r.amount_rwf,
    vehicleClass: r.vehicle_class,
    status: r.status,
  }));
}

/** Cancels the schedule and every ride of it still to come. Returns how many. */
export async function cancelSchedule(client: NovaClient, scheduleId: string): Promise<number> {
  const { data, error } = await client.rpc("cancel_recurring_schedule", { p_schedule_id: scheduleId });
  if (error) throw dataError(error.message);
  return (data as number | null) ?? 0;
}

/** Sets one day of a schedule aside; the rest of the schedule carries on. */
export async function skipOccurrence(client: NovaClient, tripId: string): Promise<void> {
  const { error } = await client.rpc("trip_transition", {
    p_trip_id: tripId,
    p_to: "skipped",
    p_idempotency_key: `skip-${tripId}`,
  });
  if (error) throw dataError(error.message);
}

/** "07:30" in Kigali time from an instant. */
export function kigaliTime(iso: string): string {
  const k = new Date(new Date(iso).getTime() + 2 * 3600_000);
  return `${pad(k.getUTCHours())}:${pad(k.getUTCMinutes())}`;
}

/** "Tomorrow, 07:30". */
export function whenLabel(iso: string, now = new Date()): string {
  const k = new Date(new Date(iso).getTime() + 2 * 3600_000);
  const date = `${k.getUTCFullYear()}-${pad(k.getUTCMonth() + 1)}-${pad(k.getUTCDate())}`;
  return `${dayLabel(date, kigaliToday(now))}, ${kigaliTime(iso)}`;
}
