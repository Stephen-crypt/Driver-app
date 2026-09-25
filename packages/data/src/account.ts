import type { GeraClient } from "./client";

export type PaymentKind = "cash" | "mtn_momo" | "airtel_money" | "card";

export interface PaymentMethod {
  readonly id: string;
  readonly kind: PaymentKind;
  readonly label: string | null;
  readonly isDefault: boolean;
}

/**
 * What each method is, and whether it actually settles yet.
 *
 * `live: false` is shown to the rider as "coming soon" rather than hidden.
 * Hiding them makes the product look thinner than it is; pretending they work
 * makes the first real trip a dispute at the kerb.
 */
export const PAYMENT_KINDS: readonly {
  kind: PaymentKind;
  label: string;
  blurb: string;
  live: boolean;
}[] = [
  { kind: "cash", label: "Cash", blurb: "Pay your driver directly", live: true },
  { kind: "mtn_momo", label: "MTN MoMo", blurb: "Coming soon", live: false },
  { kind: "airtel_money", label: "Airtel Money", blurb: "Coming soon", live: false },
  { kind: "card", label: "Card", blurb: "Coming soon", live: false },
];

export async function listPaymentMethods(
  client: GeraClient,
  userId: string,
): Promise<PaymentMethod[]> {
  const { data, error } = await client
    .from("payment_methods")
    .select("id, kind, label, is_default")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);

  return ((data ?? []) as { id: string; kind: PaymentKind; label: string | null; is_default: boolean }[])
    .map((r) => ({ id: r.id, kind: r.kind, label: r.label, isDefault: r.is_default }));
}

/**
 * Makes one method the default. The old default is cleared first because a
 * partial unique index enforces at most one per user - writing the new one
 * while the old still stands would be rejected by the database, which is the
 * behaviour we want, but the app should not be the thing that discovers it.
 */
export async function setDefaultPaymentMethod(
  client: GeraClient,
  userId: string,
  kind: PaymentKind,
): Promise<void> {
  const clear = await client
    .from("payment_methods")
    .update({ is_default: false })
    .eq("user_id", userId)
    .eq("is_default", true);
  if (clear.error) throw new Error(clear.error.message);

  const { error } = await client
    .from("payment_methods")
    .upsert(
      { user_id: userId, kind, is_default: true },
      { onConflict: "user_id,kind" },
    );
  if (error) throw new Error(error.message);
}

/** Registers this install for push. The token is the key, so re-registering
 *  the same device moves it to the current user rather than piling up rows. */
export async function registerDeviceToken(
  client: GeraClient,
  userId: string,
  token: string,
  platform: "android" | "ios",
): Promise<void> {
  const { error } = await client.from("device_tokens").upsert(
    { token, user_id: userId, platform, updated_at: new Date().toISOString() },
    { onConflict: "token" },
  );
  if (error) throw new Error(error.message);
}

export async function rateTrip(
  client: GeraClient,
  tripId: string,
  rating: number,
  comment?: string,
): Promise<void> {
  const { error } = await client.rpc("rate_trip", {
    p_trip_id: tripId,
    p_rating: rating,
    p_comment: comment ?? null,
  });
  if (error) throw new Error(error.message);
}

/**
 * Cancels a live trip. This goes through the same trip_transition RPC every
 * other state change uses - cancellation is already in trip_transition_rules,
 * and a dedicated path would have been a second copy of the rule.
 */
export async function cancelTrip(
  client: GeraClient,
  tripId: string,
  as: "rider" | "driver",
): Promise<void> {
  const { error } = await client.rpc("trip_transition", {
    p_trip_id: tripId,
    p_to: as === "rider" ? "cancelled_by_rider" : "cancelled_by_driver",
    p_idempotency_key: `cancel-${as}-${tripId}`,
  });
  if (error) throw new Error(error.message);
}

export interface Contact {
  readonly counterparty: "rider" | "driver";
  readonly displayName: string | null;
  readonly phone: string | null;
}

/**
 * The other party's number, readable only while the trip is live. Returns null
 * outside that window, which is the server's answer and not something the app
 * decides.
 */
export async function getTripContact(
  client: GeraClient,
  tripId: string,
): Promise<Contact | null> {
  const { data, error } = await client.rpc("trip_contact", { p_trip_id: tripId });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as {
    counterparty: "rider" | "driver";
    display_name: string | null;
    phone: string | null;
  }[];
  const r = rows[0];
  if (!r) return null;
  return { counterparty: r.counterparty, displayName: r.display_name, phone: r.phone };
}

export interface TripHistoryItem {
  readonly id: string;
  readonly state: string;
  readonly pickupLabel: string;
  readonly dropoffLabel: string;
  readonly fareRwf: number | null;
  readonly createdAt: string;
}

export async function listTrips(
  client: GeraClient,
  column: "rider_id" | "driver_id",
  userId: string,
  limit = 30,
): Promise<TripHistoryItem[]> {
  const { data, error } = await client
    .from("trips")
    .select("id, state, pickup_label, dropoff_label, quoted_amount_rwf, created_at")
    .eq(column, userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);

  return ((data ?? []) as {
    id: string;
    state: string;
    pickup_label: string;
    dropoff_label: string;
    quoted_amount_rwf: number | null;
    created_at: string;
  }[]).map((r) => ({
    id: r.id,
    state: r.state,
    pickupLabel: r.pickup_label,
    dropoffLabel: r.dropoff_label,
    fareRwf: r.quoted_amount_rwf,
    createdAt: r.created_at,
  }));
}
