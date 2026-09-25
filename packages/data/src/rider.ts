import type { GeraClient } from "./client";

export type VehicleClass = "moto" | "cab" | "cab_xl";
export type PresenceStatus = "online" | "offline" | "on_trip";

export interface Coords {
  readonly lat: number;
  readonly lng: number;
}

const point = (c: Coords) => `POINT(${c.lng} ${c.lat})`;

/**
 * Presence is upserted rather than inserted: a rider who has been online
 * before already has a row, and the RLS policy is per-owner, so there is no
 * path where one rider's presence can overwrite another's.
 */
export async function setPresence(
  client: GeraClient,
  riderId: string,
  args: {
    readonly status: PresenceStatus;
    readonly at: Coords;
    readonly vehicleClass: VehicleClass;
  },
): Promise<void> {
  const { error } = await client.from("rider_presence").upsert(
    {
      rider_id: riderId,
      status: args.status,
      vehicle_class: args.vehicleClass,
      position: point(args.at),
      heartbeat_at: new Date().toISOString(),
    },
    { onConflict: "rider_id" },
  );
  if (error) throw new Error(error.message);
}

/**
 * Position and heartbeat only. A heartbeat must never carry the status field:
 * a rider who has just been put `on_trip` by dispatch would otherwise be
 * flipped back to `online` by the next tick and offered a second trip.
 */
export async function heartbeat(
  client: GeraClient,
  riderId: string,
  at: Coords,
): Promise<void> {
  const { error } = await client
    .from("rider_presence")
    .update({ position: point(at), heartbeat_at: new Date().toISOString() })
    .eq("rider_id", riderId);
  if (error) throw new Error(error.message);
}

export async function getPresence(
  client: GeraClient,
  riderId: string,
): Promise<{ status: PresenceStatus; vehicleClass: VehicleClass } | null> {
  const { data, error } = await client
    .from("rider_presence")
    .select("status, vehicle_class")
    .eq("rider_id", riderId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as { status: PresenceStatus; vehicle_class: VehicleClass };
  return { status: row.status, vehicleClass: row.vehicle_class };
}

/**
 * Company cash the rider is currently carrying: fares collected less what they
 * have handed in. This is exposure, not earnings, and it is the number that
 * decides whether they can work - a rider over the ceiling must remit first.
 */
export async function getCashHeld(client: GeraClient, riderId: string): Promise<number> {
  const { data, error } = await client.rpc("rider_cash_held", { p_rider_id: riderId });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

/**
 * What the company owes the rider: earnings and bonuses less deductions and
 * payouts. Negative means they owe the company.
 *
 * Deliberately separate from cash held. Netting the two would tell a rider
 * carrying 50,000 of our cash that they are 30,000 in credit, which is true of
 * the arithmetic and useless as a fact about their day.
 */
export async function getNetOwed(client: GeraClient, riderId: string): Promise<number> {
  const { data, error } = await client.rpc("rider_net_owed", { p_rider_id: riderId });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

/**
 * Whether the rider may go online: they have a vehicle assigned, and are not
 * carrying more of the company's cash than the ceiling allows. Asking the
 * server rather than re-deriving it in the app keeps one copy of the rule.
 */
export async function canGoOnline(client: GeraClient, riderId: string): Promise<boolean> {
  const { data, error } = await client.rpc("can_go_online", { p_rider_id: riderId });
  if (error) throw new Error(error.message);
  return data === true;
}

export interface LiveOffer {
  readonly offerId: string;
  readonly tripId: string;
  readonly expiresAt: string;
  readonly etaSeconds: number | null;
  readonly pickupLabel: string;
  readonly pickupNote: string | null;
  readonly dropoffLabel: string;
  readonly fareRwf: number | null;
  readonly vehicleClass: string;
}

interface OfferRow {
  id: string;
  trip_id: string;
  expires_at: string;
  eta_seconds: number | null;
  trips: {
    pickup_label: string;
    pickup_note: string | null;
    dropoff_label: string;
    quoted_amount_rwf: number | null;
    vehicle_class: string;
  } | null;
}

/**
 * The offer currently in front of this rider, if any.
 *
 * `outcome is null` is the live condition - an offer that timed out or was
 * declined keeps its row. The expiry is filtered here too rather than trusted
 * from the sweeper: the sweeper runs every ten seconds, and showing a rider an
 * offer that lapsed four seconds ago invites them to tap accept and be refused.
 */
export async function getLiveOffer(
  client: GeraClient,
  riderId: string,
): Promise<LiveOffer | null> {
  const { data, error } = await client
    .from("trip_offers")
    .select(
      "id, trip_id, expires_at, eta_seconds, trips(pickup_label, pickup_note, dropoff_label, quoted_amount_rwf, vehicle_class)",
    )
    .eq("rider_id", riderId)
    .is("outcome", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const r = data as unknown as OfferRow;
  return {
    offerId: r.id,
    tripId: r.trip_id,
    expiresAt: r.expires_at,
    etaSeconds: r.eta_seconds,
    pickupLabel: r.trips?.pickup_label ?? "Pickup",
    pickupNote: r.trips?.pickup_note ?? null,
    dropoffLabel: r.trips?.dropoff_label ?? "Destination",
    fareRwf: r.trips?.quoted_amount_rwf ?? null,
    vehicleClass: r.trips?.vehicle_class ?? "moto",
  };
}

export async function acceptOffer(
  client: GeraClient,
  offerId: string,
): Promise<{ id: string; state: string }> {
  const { data, error } = await client.rpc("accept_offer", {
    p_offer_id: offerId,
    // Derived from the offer, not random: a retry after a dropped response must
    // land on the same key or the rider accepts twice.
    p_idempotency_key: `accept-${offerId}`,
  });
  if (error) throw new Error(error.message);
  return data as { id: string; state: string };
}

export async function declineOffer(client: GeraClient, offerId: string): Promise<void> {
  const { error } = await client.rpc("decline_offer", { p_offer_id: offerId });
  if (error) throw new Error(error.message);
}

export type RiderTripState = "accepted" | "arrived" | "in_progress";

export interface ActiveTrip {
  readonly id: string;
  readonly state: RiderTripState;
  readonly pickupLabel: string;
  readonly pickupNote: string | null;
  readonly dropoffLabel: string;
  readonly fareRwf: number | null;
  readonly quotedDistanceM: number | null;
}

export async function getActiveTrip(
  client: GeraClient,
  riderId: string,
): Promise<ActiveTrip | null> {
  const { data, error } = await client
    .from("trips")
    .select(
      "id, state, pickup_label, pickup_note, dropoff_label, quoted_amount_rwf, quoted_distance_m",
    )
    .eq("rider_id", riderId)
    .in("state", ["accepted", "arrived", "in_progress"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const r = data as {
    id: string;
    state: RiderTripState;
    pickup_label: string;
    pickup_note: string | null;
    dropoff_label: string;
    quoted_amount_rwf: number | null;
    quoted_distance_m: number | null;
  };

  return {
    id: r.id,
    state: r.state,
    pickupLabel: r.pickup_label,
    pickupNote: r.pickup_note,
    dropoffLabel: r.dropoff_label,
    fareRwf: r.quoted_amount_rwf,
    quotedDistanceM: r.quoted_distance_m,
  };
}

export async function advanceTrip(
  client: GeraClient,
  tripId: string,
  to: "arrived" | "in_progress",
): Promise<{ id: string; state: string }> {
  const { data, error } = await client.rpc("trip_transition", {
    p_trip_id: tripId,
    p_to: to,
    p_idempotency_key: `${to}-${tripId}`,
  });
  if (error) throw new Error(error.message);
  return data as { id: string; state: string };
}

/** Seconds left on an offer, floored at zero. */
export function secondsLeft(expiresAt: string, now = Date.now()): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1000));
}

export interface Earnings {
  readonly trips: number;
  /** Cash the rider took from passengers. Belongs to the company. */
  readonly collectedRwf: number;
  /** What the rider earned on those trips. Theirs. */
  readonly earnedRwf: number;
  /** What the company kept. collectedRwf - earnedRwf. */
  readonly companyShareRwf: number;
}

/**
 * The day's work, in the three numbers a fleet rider actually needs.
 *
 * Both figures come from the ledger rather than one from the ledger and one
 * from the trips table: they are written together by complete_trip, and reading
 * them from the same place is what stops a cancelled or adjusted trip making
 * the two disagree.
 */
export async function getEarningsSince(
  client: GeraClient,
  riderId: string,
  since: Date,
): Promise<Earnings> {
  const { data, error } = await client
    .from("ledger_entries")
    .select("amount_rwf, kind, trip_id")
    .eq("rider_id", riderId)
    .in("kind", ["fare_collected", "trip_earning"])
    .gte("created_at", since.toISOString());

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as {
    amount_rwf: number;
    kind: "fare_collected" | "trip_earning";
    trip_id: string | null;
  }[];

  let collectedRwf = 0;
  let earnedRwf = 0;
  const trips = new Set<string>();

  for (const row of rows) {
    if (row.kind === "fare_collected") collectedRwf += row.amount_rwf;
    else earnedRwf += row.amount_rwf;
    if (row.trip_id) trips.add(row.trip_id);
  }

  return {
    trips: trips.size,
    collectedRwf,
    earnedRwf,
    companyShareRwf: collectedRwf - earnedRwf,
  };
}

export function startOfToday(now = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

export type DocumentKind =
  | "national_id"
  | "driving_licence"
  | "vehicle_registration"
  | "insurance";

export type DocumentStatus = "pending" | "approved" | "rejected";

export interface RiderDocument {
  readonly kind: DocumentKind;
  readonly status: DocumentStatus;
  readonly note: string | null;
  readonly uploaded: boolean;
}

/** Human labels for the checklist. The server owns which kinds are required. */
export const DOCUMENT_LABELS: Record<DocumentKind, string> = {
  national_id: "National ID",
  driving_licence: "Driving licence",
  vehicle_registration: "Vehicle registration",
  insurance: "Insurance certificate",
};

/**
 * What the rider still owes, one row per required kind whether uploaded or
 * not - so the checklist is the server's idea of "required", not the app's.
 */
export async function listMyDocuments(client: GeraClient): Promise<RiderDocument[]> {
  const { data, error } = await client.rpc("my_documents");
  if (error) throw new Error(error.message);
  return ((data ?? []) as RiderDocument[]).map((r) => ({
    kind: r.kind,
    status: r.status,
    note: r.note,
    uploaded: r.uploaded,
  }));
}

const BUCKET = "rider-documents";

/**
 * Uploads one document and records it.
 *
 * The path is always `<rider_id>/<kind>`, which is what the storage policy
 * checks: a rider can only write inside the folder named for their own uid.
 *
 * Note this never sets `status`. The column is not grantable to a rider at
 * all - a first cut let one PATCH status='approved' onto their own licence and
 * go online unvetted.
 */
export async function uploadDocument(
  client: GeraClient,
  riderId: string,
  kind: DocumentKind,
  file: { uri: string; mimeType: string; extension: string },
): Promise<void> {
  const path = `${riderId}/${kind}.${file.extension}`;

  // React Native has no File; supabase-js takes the ArrayBuffer instead.
  const response = await fetch(file.uri);
  const body = await response.arrayBuffer();

  const up = await client.storage.from(BUCKET).upload(path, body, {
    contentType: file.mimeType,
    upsert: true,
  });
  if (up.error) throw new Error(up.error.message);

  // Re-submitting resets nothing the rider controls; a reviewer decides the
  // status, so the row only ever carries where the file is.
  const { error } = await client
    .from("rider_documents")
    .upsert(
      { rider_id: riderId, kind, storage_path: path, updated_at: new Date().toISOString() },
      { onConflict: "rider_id,kind" },
    );
  if (error) throw new Error(error.message);
}
