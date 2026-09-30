import type { NovaClient } from "./client";
import { dataError } from "./client";

export interface QuoteRequest {
  readonly vehicleClass: "moto" | "cab" | "cab_xl";
  /** The road distance and time from the route function. The server prices at least the straight line. */
  readonly distanceM: number;
  readonly durationS: number;
  /** The route being priced; booking must use the same one. */
  readonly pickup: { readonly lat: number; readonly lng: number };
  readonly dropoff: { readonly lat: number; readonly lng: number };
}

export interface QuoteResult {
  readonly quoteId: string;
  readonly amountRwf: number;
  readonly expiresAt: string;
  readonly vehicleClass: string;
  readonly distanceM: number;
  readonly durationS: number;
}

export interface ReceiptLine {
  readonly label: string;
  readonly amountRwf: number;
}

export interface CompleteTripResult {
  readonly tripId: string;
  readonly state: string;
  readonly receipt: { readonly lines: readonly ReceiptLine[]; readonly totalRwf: number };
  /**
   * What the rider made on this trip. The Edge Function returns this, not the
   * company's commission - the type used to say commissionRwf, which the
   * response never contained.
   */
  readonly riderEarningRwf: number;
}

export async function requestQuote(
  client: NovaClient,
  req: QuoteRequest,
): Promise<QuoteResult> {
  const { data, error } = await client.functions.invoke("quote", { body: req });
  if (error) throw dataError(error.message);
  if (!data) throw new Error("quote failed");
  return data as QuoteResult;
}

export interface CreateTripArgs {
  readonly quoteId: string;
  readonly pickup: { readonly lng: number; readonly lat: number };
  readonly pickupLabel: string;
  readonly pickupNote?: string;
  readonly dropoff: { readonly lng: number; readonly lat: number };
  readonly dropoffLabel: string;
}

export async function createTripFromQuote(
  client: NovaClient,
  args: CreateTripArgs,
): Promise<{ id: string; state: string }> {
  const { data, error } = await client.rpc("create_trip_from_quote", {
    p_quote_id: args.quoteId,
    p_pickup: `POINT(${args.pickup.lng} ${args.pickup.lat})`,
    p_pickup_label: args.pickupLabel,
    p_pickup_note: args.pickupNote ?? null,
    p_dropoff: `POINT(${args.dropoff.lng} ${args.dropoff.lat})`,
    p_dropoff_label: args.dropoffLabel,
  });
  if (error) throw dataError(error.message);
  if (!data) throw new Error("trip creation failed");
  return data as { id: string; state: string };
}

export interface CompleteTripArgs {
  readonly tripId: string;
  readonly actualDistanceM: number;
  readonly idempotencyKey: string;
}

export async function completeTrip(
  client: NovaClient,
  args: CompleteTripArgs,
): Promise<CompleteTripResult> {
  if (!args.idempotencyKey) throw new Error("idempotencyKey is required");
  const { data, error } = await client.functions.invoke("complete-trip", { body: args });
  if (error) throw dataError(error.message);
  if (!data) throw new Error("completion failed");
  return data as CompleteTripResult;
}

export interface TripDetail {
  readonly id: string;
  readonly state: string;
  readonly vehicleClass: string;
  readonly pickupLabel: string;
  readonly pickupNote: string | null;
  readonly dropoffLabel: string;
  readonly quotedAmountRwf: number | null;
  readonly createdAt: string;
  readonly scheduledFor: string | null;
  readonly riderId: string | null;
}

/** One of the signed-in person's trips, as a receipt shows it. RLS limits it to their own. */
export async function getTripDetail(client: NovaClient, tripId: string): Promise<TripDetail | null> {
  const { data, error } = await client
    .from("trips")
    .select("id, state, vehicle_class, pickup_label, pickup_note, dropoff_label, quoted_amount_rwf, created_at, scheduled_for, rider_id")
    .eq("id", tripId)
    .maybeSingle();
  if (error) throw dataError(error.message);
  if (!data) return null;
  const r = data as {
    id: string;
    state: string;
    vehicle_class: string;
    pickup_label: string;
    pickup_note: string | null;
    dropoff_label: string;
    quoted_amount_rwf: number | null;
    created_at: string;
    scheduled_for: string | null;
    rider_id: string | null;
  };
  return {
    id: r.id,
    state: r.state,
    vehicleClass: r.vehicle_class,
    pickupLabel: r.pickup_label,
    pickupNote: r.pickup_note,
    dropoffLabel: r.dropoff_label,
    quotedAmountRwf: r.quoted_amount_rwf,
    createdAt: r.created_at,
    scheduledFor: r.scheduled_for,
    riderId: r.rider_id,
  };
}

export interface TripEvent {
  readonly to: string;
  readonly actor: string;
  readonly at: string;
  /** The reason given for a cancellation, when there was one. Other events
   *  carry internal codes in the same field, and those are not surfaced. */
  readonly reason: string | null;
}

/** What happened to a trip, in order. RLS limits it to the trip's two people. */
export async function getTripEvents(client: NovaClient, tripId: string): Promise<TripEvent[]> {
  const { data, error } = await client
    .from("trip_events")
    .select("to_state, actor, created_at, meta")
    .eq("trip_id", tripId)
    .order("created_at", { ascending: true });
  if (error) throw dataError(error.message);
  type Row = { to_state: string; actor: string; created_at: string; meta: Record<string, unknown> | null };
  return ((data ?? []) as Row[]).map((r) => ({
    to: r.to_state,
    actor: r.actor,
    at: r.created_at,
    reason: r.to_state.startsWith("cancelled_by_") && typeof r.meta?.reason === "string" ? r.meta.reason : null,
  }));
}
