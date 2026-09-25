import type { GeraClient } from "./client";

export interface TripPoints {
  readonly pickup: { readonly lat: number; readonly lng: number };
  readonly dropoff: { readonly lat: number; readonly lng: number };
}

/** Both ends of a trip, for the map. The server decides who may see them. */
export async function getTripPoints(client: GeraClient, tripId: string): Promise<TripPoints | null> {
  const { data, error } = await client.rpc("trip_points", { p_trip_id: tripId }).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const r = data as { pickup_lng: number; pickup_lat: number; dropoff_lng: number; dropoff_lat: number };
  return {
    pickup: { lat: r.pickup_lat, lng: r.pickup_lng },
    dropoff: { lat: r.dropoff_lat, lng: r.dropoff_lng },
  };
}

export interface NearbyLandmark {
  readonly name: string;
  readonly sector: string | null;
  readonly distanceM: number;
}

/**
 * How a Kigali passenger would name where they are standing. Null when nothing
 * is within a kilometre - better "Current location" than a confident wrong name.
 */
export async function nearestLandmark(
  client: GeraClient,
  at: { readonly lat: number; readonly lng: number },
): Promise<NearbyLandmark | null> {
  const { data, error } = await client
    .rpc("nearest_landmark", { p_lng: at.lng, p_lat: at.lat })
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const r = data as { name: string; sector: string | null; distance_m: number };
  return { name: r.name, sector: r.sector, distanceM: r.distance_m };
}

/** "Near Kimironko Market" within 150m reads as "At", further as "Near". */
export function pickupLabelFor(landmark: NearbyLandmark | null): string {
  if (!landmark) return "Current location";
  return landmark.distanceM <= 150 ? landmark.name : `Near ${landmark.name}`;
}

/** Straight-line metres. For "1.2 km away" on an offer, not for pricing. */
export function distanceBetween(
  a: { readonly lat: number; readonly lng: number },
  b: { readonly lat: number; readonly lng: number },
): number {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}

export function distanceLabel(metres: number): string {
  if (metres < 1000) return `${Math.max(50, Math.round(metres / 50) * 50)} m`;
  return `${(metres / 1000).toFixed(metres < 10_000 ? 1 : 0)} km`;
}
