import type { GeraClient } from "./client";

export interface Place {
  readonly id: string;
  readonly name: string;
  readonly sector: string | null;
  readonly lng: number;
  readonly lat: number;
}

interface LandmarkRow {
  id: string;
  name: string;
  sector: string | null;
  lng: number;
  lat: number;
}

/**
 * Spec 3.7: destination search is landmark-first, because most Kigali addresses
 * do not exist. A blank query returns nothing rather than the whole gazetteer -
 * an empty search box should not look like a directory listing.
 */
export async function searchLandmarks(
  client: GeraClient,
  query: string,
  limit = 8,
): Promise<Place[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const { data, error } = await client.rpc("search_landmarks", {
    p_query: trimmed,
    p_limit: limit,
  });

  if (error) throw new Error(error.message);
  if (!data) return [];

  return (data as LandmarkRow[]).map((r) => ({
    id: r.id,
    name: r.name,
    sector: r.sector,
    lng: Number(r.lng),
    lat: Number(r.lat),
  }));
}

export interface RouteResult {
  readonly distanceM: number;
  readonly durationS: number;
}

/**
 * Real road distance between two points, measured server-side so the Directions
 * key never ships in the app bundle.
 *
 * Returns null when routing is unavailable rather than throwing: a quote built
 * on a straight line is worse than one built on a road, but far better than no
 * quote at all, so the caller falls back rather than failing.
 */
export async function getRoute(
  client: GeraClient,
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
): Promise<RouteResult | null> {
  try {
    const { data, error } = await client.functions.invoke("route", {
      body: { origin, destination },
    });
    if (error || !data) return null;
    const r = data as Partial<RouteResult>;
    if (typeof r.distanceM !== "number" || typeof r.durationS !== "number") return null;
    return { distanceM: r.distanceM, durationS: r.durationS };
  } catch {
    return null;
  }
}
