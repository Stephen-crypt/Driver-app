import type { NovaClient } from "./client";
import { dataError } from "./client";

export interface TripPoints {
  readonly pickup: { readonly lat: number; readonly lng: number };
  readonly dropoff: { readonly lat: number; readonly lng: number };
}

/** Both ends of a trip, for the map. The server decides who may see them. */
export async function getTripPoints(client: NovaClient, tripId: string): Promise<TripPoints | null> {
  const { data, error } = await client.rpc("trip_points", { p_trip_id: tripId }).maybeSingle();
  if (error) throw dataError(error.message);
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
  client: NovaClient,
  at: { readonly lat: number; readonly lng: number },
): Promise<NearbyLandmark | null> {
  const { data, error } = await client
    .rpc("nearest_landmark", { p_lng: at.lng, p_lat: at.lat })
    .maybeSingle();
  if (error) throw dataError(error.message);
  if (!data) return null;
  const r = data as { name: string; sector: string | null; distance_m: number };
  return { name: r.name, sector: r.sector, distanceM: r.distance_m };
}

/** "Near Kimironko Market" within 150m reads as "At", further as "Near". */
export function pickupLabelFor(landmark: NearbyLandmark | null): string {
  if (!landmark) return "Current location";
  return landmark.distanceM <= 150 ? landmark.name : `Near ${landmark.name}`;
}

/**
 * The name for where a passenger is standing. Nova's own landmark when one is
 * close, because it is the name a rider knows; otherwise the map's name for
 * the spot - "Near RITCO", "KG 45 Street, Kibagabaga" - and only then a
 * landmark further off. Never throws: the worst case is "Current location".
 */
export async function describePickup(
  client: NovaClient,
  at: { readonly lat: number; readonly lng: number },
): Promise<string> {
  const landmark = await nearestLandmark(client, at).catch(() => null);
  if (landmark && landmark.distanceM <= 300) return pickupLabelFor(landmark);
  try {
    const { data, error } = await client.functions.invoke("places", { body: { reverse: { lat: at.lat, lng: at.lng } } });
    const label = (data as { label?: unknown } | null)?.label;
    if (!error && typeof label === "string" && label.trim()) return label.trim();
  } catch {
    // Fall through to the landmark further off.
  }
  return pickupLabelFor(landmark);
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
  // Rounded first: 990 m would otherwise read as "1000 m".
  const m = Math.max(50, Math.round(metres / 50) * 50);
  if (m < 1000) return `${m} m`;
  return `${(metres / 1000).toFixed(metres < 10_000 ? 1 : 0)} km`;
}
