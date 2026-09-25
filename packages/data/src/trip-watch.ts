import type { GeraClient } from "./client";

/**
 * Every state before the trip reaches an end. The passenger screen polls while the
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
  readonly riderId: string | null;
  readonly quotedAmountRwf: number | null;
  readonly pickupLabel: string;
  readonly dropoffLabel: string;
}

interface TripRow {
  id: string;
  state: string;
  rider_id: string | null;
  quoted_amount_rwf: number | null;
  pickup_label: string;
  dropoff_label: string;
}

export async function getTrip(client: GeraClient, tripId: string): Promise<TripSnapshot> {
  const { data, error } = await client
    .from("trips")
    .select("id, state, rider_id, quoted_amount_rwf, pickup_label, dropoff_label")
    .eq("id", tripId)
    .single();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("trip not found");

  const r = data as TripRow;
  return {
    id: r.id,
    state: r.state,
    riderId: r.rider_id,
    quotedAmountRwf: r.quoted_amount_rwf,
    pickupLabel: r.pickup_label,
    dropoffLabel: r.dropoff_label,
  };
}

export interface RiderCard {
  readonly firstName: string;
  readonly plate: string | null;
  readonly vestNumber: string | null;
  readonly vehicleClass: string;
  readonly rating: number | null;
}

interface RiderCardRow {
  first_name: string;
  plate: string | null;
  vest_number: string | null;
  vehicle_class: string;
  rating: number | string | null;
}

/**
 * Who is coming to the kerb: a name, a plate and a vest number. Spec 3.6 keeps
 * the rider's number off this card - the passenger gets what they need to find the
 * vehicle, not a way to contact the rider off-platform.
 *
 * Returns null while no rider is assigned yet, which is an ordinary state, not
 * an error.
 */
export async function getRiderCard(
  client: GeraClient,
  tripId: string,
): Promise<RiderCard | null> {
  const { data, error } = await client.rpc("trip_rider_card", { p_trip_id: tripId });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as RiderCardRow[];
  const r = rows[0];
  if (!r) return null;

  return {
    firstName: r.first_name,
    plate: r.plate,
    vestNumber: r.vest_number,
    vehicleClass: r.vehicle_class,
    rating: r.rating === null ? null : Number(r.rating),
  };
}
