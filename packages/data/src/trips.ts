import type { GeraClient } from "./client";

export interface QuoteRequest {
  readonly vehicleClass: "moto" | "cab" | "cab_xl";
  readonly distanceM: number;
  readonly durationS: number;
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
  readonly commissionRwf: number;
}

export async function requestQuote(
  client: GeraClient,
  req: QuoteRequest,
): Promise<QuoteResult> {
  const { data, error } = await client.functions.invoke("quote", { body: req });
  if (error) throw new Error(error.message);
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
  client: GeraClient,
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
  if (error) throw new Error(error.message);
  if (!data) throw new Error("trip creation failed");
  return data as { id: string; state: string };
}

export interface CompleteTripArgs {
  readonly tripId: string;
  readonly actualDistanceM: number;
  readonly idempotencyKey: string;
}

export async function completeTrip(
  client: GeraClient,
  args: CompleteTripArgs,
): Promise<CompleteTripResult> {
  if (!args.idempotencyKey) throw new Error("idempotencyKey is required");
  const { data, error } = await client.functions.invoke("complete-trip", { body: args });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("completion failed");
  return data as CompleteTripResult;
}
