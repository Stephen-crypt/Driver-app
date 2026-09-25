import type { GeraClient } from "./client";

export type VehicleClass = "moto" | "cab" | "cab_xl";
export type PresenceStatus = "online" | "offline" | "on_trip";

export interface Coords {
  readonly lat: number;
  readonly lng: number;
}

const point = (c: Coords) => `POINT(${c.lng} ${c.lat})`;

/**
 * Presence is upserted rather than inserted: a driver who has been online
 * before already has a row, and the RLS policy is per-owner, so there is no
 * path where one driver's presence can overwrite another's.
 */
export async function setPresence(
  client: GeraClient,
  driverId: string,
  args: {
    readonly status: PresenceStatus;
    readonly at: Coords;
    readonly vehicleClass: VehicleClass;
  },
): Promise<void> {
  const { error } = await client.from("driver_presence").upsert(
    {
      driver_id: driverId,
      status: args.status,
      vehicle_class: args.vehicleClass,
      position: point(args.at),
      heartbeat_at: new Date().toISOString(),
    },
    { onConflict: "driver_id" },
  );
  if (error) throw new Error(error.message);
}

/**
 * Position and heartbeat only. A heartbeat must never carry the status field:
 * a driver who has just been put `on_trip` by dispatch would otherwise be
 * flipped back to `online` by the next tick and offered a second trip.
 */
export async function heartbeat(
  client: GeraClient,
  driverId: string,
  at: Coords,
): Promise<void> {
  const { error } = await client
    .from("driver_presence")
    .update({ position: point(at), heartbeat_at: new Date().toISOString() })
    .eq("driver_id", driverId);
  if (error) throw new Error(error.message);
}

export async function getPresence(
  client: GeraClient,
  driverId: string,
): Promise<{ status: PresenceStatus; vehicleClass: VehicleClass } | null> {
  const { data, error } = await client
    .from("driver_presence")
    .select("status, vehicle_class")
    .eq("driver_id", driverId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as { status: PresenceStatus; vehicle_class: VehicleClass };
  return { status: row.status, vehicleClass: row.vehicle_class };
}

/** Wallet balance in whole RWF. Commission is debited from this. */
export async function getBalance(client: GeraClient, driverId: string): Promise<number> {
  const { data, error } = await client.rpc("driver_balance", { p_driver_id: driverId });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

/**
 * Whether the driver may go online at all: verified, and funded above the
 * minimum. Asking the server rather than re-deriving it in the app is what
 * keeps one copy of the rule.
 */
export async function canGoOnline(client: GeraClient, driverId: string): Promise<boolean> {
  const { data, error } = await client.rpc("can_go_online", { p_driver_id: driverId });
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
 * The offer currently in front of this driver, if any.
 *
 * `outcome is null` is the live condition - an offer that timed out or was
 * declined keeps its row. The expiry is filtered here too rather than trusted
 * from the sweeper: the sweeper runs every ten seconds, and showing a driver an
 * offer that lapsed four seconds ago invites them to tap accept and be refused.
 */
export async function getLiveOffer(
  client: GeraClient,
  driverId: string,
): Promise<LiveOffer | null> {
  const { data, error } = await client
    .from("trip_offers")
    .select(
      "id, trip_id, expires_at, eta_seconds, trips(pickup_label, pickup_note, dropoff_label, quoted_amount_rwf, vehicle_class)",
    )
    .eq("driver_id", driverId)
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
    // land on the same key or the driver accepts twice.
    p_idempotency_key: `accept-${offerId}`,
  });
  if (error) throw new Error(error.message);
  return data as { id: string; state: string };
}

export async function declineOffer(client: GeraClient, offerId: string): Promise<void> {
  const { error } = await client.rpc("decline_offer", { p_offer_id: offerId });
  if (error) throw new Error(error.message);
}

export type DriverTripState = "accepted" | "arrived" | "in_progress";

export interface ActiveTrip {
  readonly id: string;
  readonly state: DriverTripState;
  readonly pickupLabel: string;
  readonly pickupNote: string | null;
  readonly dropoffLabel: string;
  readonly fareRwf: number | null;
  readonly quotedDistanceM: number | null;
}

export async function getActiveTrip(
  client: GeraClient,
  driverId: string,
): Promise<ActiveTrip | null> {
  const { data, error } = await client
    .from("trips")
    .select(
      "id, state, pickup_label, pickup_note, dropoff_label, quoted_amount_rwf, quoted_distance_m",
    )
    .eq("driver_id", driverId)
    .in("state", ["accepted", "arrived", "in_progress"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const r = data as {
    id: string;
    state: DriverTripState;
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
  readonly grossRwf: number;
  readonly commissionRwf: number;
  readonly netRwf: number;
}

/**
 * What the driver actually made since a given moment, usually the start of
 * today.
 *
 * Gross is the cash they collected; commission is what Gera debited from the
 * wallet for those trips. Net is what they keep. Showing gross alone is the
 * number that makes drivers feel cheated when the wallet moves, so all three
 * are shown together.
 */
export async function getEarningsSince(
  client: GeraClient,
  driverId: string,
  since: Date,
): Promise<Earnings> {
  const iso = since.toISOString();

  const [tripsRes, ledgerRes] = await Promise.all([
    client
      .from("trips")
      .select("quoted_amount_rwf")
      .eq("driver_id", driverId)
      .eq("state", "completed")
      .gte("created_at", iso),
    client
      .from("ledger_entries")
      .select("amount_rwf, kind")
      .eq("driver_id", driverId)
      .eq("kind", "commission_debit")
      .gte("created_at", iso),
  ]);

  if (tripsRes.error) throw new Error(tripsRes.error.message);
  if (ledgerRes.error) throw new Error(ledgerRes.error.message);

  const trips = (tripsRes.data ?? []) as { quoted_amount_rwf: number | null }[];
  const ledger = (ledgerRes.data ?? []) as { amount_rwf: number }[];

  const grossRwf = trips.reduce((sum, t) => sum + (t.quoted_amount_rwf ?? 0), 0);
  const commissionRwf = ledger.reduce((sum, l) => sum + Math.abs(l.amount_rwf), 0);

  return {
    trips: trips.length,
    grossRwf,
    commissionRwf,
    netRwf: grossRwf - commissionRwf,
  };
}

export function startOfToday(now = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}
