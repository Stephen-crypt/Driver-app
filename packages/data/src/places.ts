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
