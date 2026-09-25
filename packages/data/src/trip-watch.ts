import type { GeraClient } from "./client";

/**
 * Every state before the trip reaches an end. The rider screen polls while the
 * trip is in one of these and stops the moment it is not, so a terminal state
 * missing from this list would leave the app polling a finished trip forever.
 */
export const LIVE_TRIP_STATES = [
  "requested",
  "offered",
  "accepted",
  "arrived",
  "in_progress",
] as const;

export function isTripLive(state: string): boolean {
  return (LIVE_TRIP_STATES as readonly string[]).includes(state);
}

export interface TripSnapshot {
  readonly id: string;
  readonly state: string;
  readonly driverId: string | null;
  readonly quotedAmountRwf: number | null;
  readonly pickupLabel: string;
  readonly dropoffLabel: string;
}

interface TripRow {
  id: string;
  state: string;
  driver_id: string | null;
  quoted_amount_rwf: number | null;
  pickup_label: string;
  dropoff_label: string;
}

export async function getTrip(client: GeraClient, tripId: string): Promise<TripSnapshot> {
  const { data, error } = await client
    .from("trips")
    .select("id, state, driver_id, quoted_amount_rwf, pickup_label, dropoff_label")
    .eq("id", tripId)
    .single();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("trip not found");

  const r = data as TripRow;
  return {
    id: r.id,
    state: r.state,
    driverId: r.driver_id,
    quotedAmountRwf: r.quoted_amount_rwf,
    pickupLabel: r.pickup_label,
    dropoffLabel: r.dropoff_label,
  };
}
