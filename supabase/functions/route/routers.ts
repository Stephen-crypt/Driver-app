// The routers the route function asks, in order. Each answers with a route,
// "no road joins these", or null for "ask the next one" - so one router being
// down, out of quota or misconfigured never fails a quote on its own.

export interface Point {
  lat: number;
  lng: number;
}

export interface Route {
  distanceM: number;
  durationS: number;
  /** The road as [lat, lng] pairs, or empty when the router gave no shape. */
  path: [number, number][];
}

/** A router's answer: a route, "no road joins these", or null for "ask the next one". */
export type Answer = Route | "no_route" | null;

export const isPoint = (p: unknown): p is Point => {
  const q = p as Point | undefined;
  return (
    typeof q?.lat === "number" &&
    typeof q?.lng === "number" &&
    Number.isFinite(q.lat) &&
    Number.isFinite(q.lng) &&
    Math.abs(q.lat) <= 90 &&
    Math.abs(q.lng) <= 180
  );
};

// Five decimals is about a metre: finer than any road needs, half the bytes.
const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

export async function geoapify(key: string, a: Point, b: Point): Promise<Answer> {
  const url =
    `https://api.geoapify.com/v1/routing` +
    `?waypoints=${a.lat},${a.lng}|${b.lat},${b.lng}` +
    `&mode=drive&apiKey=${key}`;
  const res = await fetch(url).catch(() => null);
  if (!res) return null;
  if (!res.ok) {
    console.error(`geoapify routing: HTTP ${res.status}`);
    return null;
  }
  const data = await res.json().catch(() => null) as {
    features?: {
      properties?: { distance?: number; time?: number };
      geometry?: { type?: string; coordinates?: unknown };
    }[];
  } | null;
  const f = data?.features?.[0];
  const distanceM = f?.properties?.distance;
  const durationS = f?.properties?.time;
  if (typeof distanceM !== "number" || typeof durationS !== "number") return null;

  // One line per leg; a two-point trip has one leg, but join them regardless.
  const g = f?.geometry;
  const lines = (g?.type === "MultiLineString" ? g.coordinates : g?.type === "LineString" ? [g.coordinates] : []) as number[][][];
  const path = lines.flat().map(([lng, lat]) => [round5(lat), round5(lng)] as [number, number]);
  return { distanceM: Math.round(distanceM), durationS: Math.round(durationS), path };
}

export async function google(key: string, a: Point, b: Point): Promise<Answer> {
  const url =
    `https://maps.googleapis.com/maps/api/directions/json` +
    `?origin=${a.lat},${a.lng}` +
    `&destination=${b.lat},${b.lng}` +
    `&mode=driving&region=rw&key=${key}`;
  const res = await fetch(url).catch(() => null);
  if (!res?.ok) return null;
  const data = await res.json().catch(() => null) as {
    status?: string;
    routes?: { legs?: { distance?: { value?: number }; duration?: { value?: number } }[] }[];
  } | null;

  // Google returns 200 with a status field on failure, so the HTTP code alone
  // says nothing. REQUEST_DENIED here almost always means the key is restricted
  // in a way that excludes this server, or billing is off.
  if (data?.status !== "OK") {
    console.error(`directions status: ${data?.status ?? "unparseable"}`);
    return data?.status === "ZERO_RESULTS" ? "no_route" : null;
  }
  const leg = data.routes?.[0]?.legs?.[0];
  const distanceM = leg?.distance?.value;
  const durationS = leg?.duration?.value;
  if (typeof distanceM !== "number" || typeof durationS !== "number") return null;
  return { distanceM: Math.round(distanceM), durationS: Math.round(durationS), path: [] };
}
