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

export interface SavedPlace {
  readonly id: string;
  readonly label: string;
  readonly note: string | null;
  readonly lng: number;
  readonly lat: number;
}

/**
 * The places a rider goes back to. Spec 3.7 puts these above the gazetteer in
 * the destination picker: for most riders most days the answer is home or work,
 * and making them type it is the difference between four taps and one.
 */
export async function listSavedPlaces(
  client: GeraClient,
  _riderId: string,
): Promise<SavedPlace[]> {
  // Via RPC, not a table select. PostgREST serialises a geography column as hex
  // EWKB ("0101000020E6100000...") rather than GeoJSON, so selecting `position`
  // hands the app an opaque string - and a client that tries to parse
  // coordinates out of it produces NaN, which looks exactly like "no saved
  // places", forever. list_saved_places projects st_x/st_y the way
  // search_landmarks already does, and runs security invoker so RLS still
  // filters to this rider.
  const { data, error } = await client.rpc("list_saved_places");
  if (error) throw new Error(error.message);

  return ((data ?? []) as {
    id: string;
    label: string;
    note: string | null;
    lng: number;
    lat: number;
  }[]).map((r) => ({
    id: r.id,
    label: r.label,
    note: r.note,
    lng: Number(r.lng),
    lat: Number(r.lat),
  }));
}

export async function savePlace(
  client: GeraClient,
  riderId: string,
  place: { label: string; lng: number; lat: number; note?: string },
): Promise<void> {
  const { error } = await client.from("saved_places").insert({
    rider_id: riderId,
    label: place.label,
    note: place.note ?? null,
    position: `POINT(${place.lng} ${place.lat})`,
  });
  if (error) throw new Error(error.message);
}

export async function deleteSavedPlace(client: GeraClient, id: string): Promise<void> {
  const { error } = await client.from("saved_places").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
