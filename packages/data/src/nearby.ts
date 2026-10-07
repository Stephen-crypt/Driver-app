import type { NovaClient } from "./client";
import { dataError } from "./client";
import type { Place } from "./places";

export interface NearbyRiders {
  readonly vehicleClass: string;
  readonly riders: number;
  /** Straight-line metres to the closest one. */
  readonly nearestM: number;
}

/**
 * Free riders within five kilometres, per vehicle. Counts and one distance -
 * the server never says who or where. An empty list means nobody is free,
 * not that the question failed; a failure throws.
 */
export async function ridersNearby(client: NovaClient, at: { readonly lat: number; readonly lng: number }): Promise<NearbyRiders[]> {
  const { data, error } = await client.rpc("riders_nearby", { p_lng: at.lng, p_lat: at.lat });
  if (error) throw dataError(error.message);
  type Row = { vehicle_class: string; riders: number; nearest_m: number };
  return ((data ?? []) as Row[]).map((r) => ({ vehicleClass: r.vehicle_class, riders: Number(r.riders), nearestM: Number(r.nearest_m) }));
}

/**
 * Minutes for a rider to reach a pickup from a straight-line distance. Kigali's
 * roads wind up and down hills, so the road is about a third longer than the
 * line, driven at about 22 km/h in town. Never less than a minute: "0 min"
 * reads as "already here".
 */
export function pickupMinutes(metres: number): number {
  const road = metres * 1.35;
  return Math.max(1, Math.round(road / ((22_000 / 60))));
}

export interface NearPlace extends Place {
  readonly distanceM: number;
}

/** The landmarks closest to a point, nearest first: where people usually go. */
export async function landmarksNear(
  client: NovaClient,
  at: { readonly lat: number; readonly lng: number },
  limit = 6,
): Promise<NearPlace[]> {
  const { data, error } = await client.rpc("landmarks_near", { p_lng: at.lng, p_lat: at.lat, p_limit: limit });
  if (error) throw dataError(error.message);
  type Row = { id: string; name: string; sector: string | null; lng: number; lat: number; distance_m: number };
  return ((data ?? []) as Row[]).map((r) => ({
    id: r.id,
    name: r.name,
    sector: r.sector,
    lng: Number(r.lng),
    lat: Number(r.lat),
    source: "landmark" as const,
    distanceM: Number(r.distance_m),
  }));
}
