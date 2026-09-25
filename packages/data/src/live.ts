import type { GeraClient } from "./client";

export interface Subscription {
  readonly unsubscribe: () => void;
}

/**
 * Calls back whenever this trip changes.
 *
 * Realtime applies the same RLS as the REST path, so a subscriber only ever
 * receives rows they could already have read. The callback gets the trip id
 * rather than the row itself: the payload arrives before RLS-shaped reads of
 * joined data, and every caller already has a loader that fetches the shape it
 * needs. One source of truth for how a trip is read, one for when.
 */
export function watchTrip(
  client: GeraClient,
  tripId: string,
  onChange: () => void,
): Subscription {
  const channel = client
    .channel(`trip:${tripId}`)
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "trips", filter: `id=eq.${tripId}` },
      () => onChange(),
    )
    .subscribe();

  return {
    unsubscribe: () => {
      void client.removeChannel(channel);
    },
  };
}

/**
 * Calls back when an offer is made to this rider, or one of theirs changes.
 *
 * This is the subscription that earns its keep: an offer lives fifteen seconds,
 * and a three-second poll spends up to a fifth of that before the rider even
 * sees it.
 */
export function watchOffers(
  client: GeraClient,
  riderId: string,
  onChange: () => void,
): Subscription {
  const channel = client
    .channel(`offers:${riderId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "trip_offers",
        filter: `rider_id=eq.${riderId}`,
      },
      () => onChange(),
    )
    .subscribe();

  return {
    unsubscribe: () => {
      void client.removeChannel(channel);
    },
  };
}

/** Trips assigned to this rider, so the console follows its own trip live. */
export function watchRiderTrips(
  client: GeraClient,
  riderId: string,
  onChange: () => void,
): Subscription {
  const channel = client
    .channel(`rider-trips:${riderId}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "trips",
        filter: `rider_id=eq.${riderId}`,
      },
      () => onChange(),
    )
    .subscribe();

  return {
    unsubscribe: () => {
      void client.removeChannel(channel);
    },
  };
}
