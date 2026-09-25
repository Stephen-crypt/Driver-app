// Real road distance and duration between two points, for quoting.
//
// The rider screen used a straight-line haversine, which under-reads badly in
// Kigali: the city is built on ridges, and two points 2km apart across a valley
// can be a 5km drive. Quoting the straight line means the driver is paid for a
// trip nobody made.
//
// The Directions key lives here, not in the app. A key shipped in a bundle can
// be pulled out of the APK and spent by anyone; this endpoint requires a signed
// -in caller, so the quota is spent by riders and nobody else.
import { callerClient, json } from "../_shared/supabase.ts";

interface Point {
  lat: number;
  lng: number;
}

interface Body {
  origin?: Point;
  destination?: Point;
}

const isPoint = (p: unknown): p is Point => {
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

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const caller = callerClient(req);
  const { data: auth } = await caller.auth.getUser();
  if (!auth.user) return json({ error: "unauthenticated" }, 401);

  const key = Deno.env.get("GOOGLE_DIRECTIONS_KEY");
  if (!key) return json({ error: "directions_key_not_configured" }, 500);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const { origin, destination } = body;
  if (!isPoint(origin) || !isPoint(destination)) {
    return json({ error: "invalid_points" }, 400);
  }

  const url =
    `https://maps.googleapis.com/maps/api/directions/json` +
    `?origin=${origin.lat},${origin.lng}` +
    `&destination=${destination.lat},${destination.lng}` +
    `&mode=driving&region=rw&key=${key}`;

  const res = await fetch(url);
  if (!res.ok) return json({ error: "directions_unavailable" }, 502);

  const data = await res.json().catch(() => null) as {
    status?: string;
    routes?: { legs?: { distance?: { value?: number }; duration?: { value?: number } }[] }[];
  } | null;

  // Google returns 200 with a status field on failure, so the HTTP code alone
  // says nothing. REQUEST_DENIED here almost always means the key is restricted
  // in a way that excludes this server.
  if (data?.status !== "OK") {
    console.error(`directions status: ${data?.status ?? "unparseable"}`);
    if (data?.status === "ZERO_RESULTS") return json({ error: "no_route" }, 404);
    return json({ error: "directions_failed" }, 502);
  }

  const leg = data.routes?.[0]?.legs?.[0];
  const distanceM = leg?.distance?.value;
  const durationS = leg?.duration?.value;

  if (typeof distanceM !== "number" || typeof durationS !== "number") {
    return json({ error: "directions_incomplete" }, 502);
  }

  return json({ distanceM: Math.round(distanceM), durationS: Math.round(durationS) }, 200);
});
