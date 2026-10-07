// Real road distance, duration and shape between two points, for quoting and
// for drawing the way on the map.
//
// The passenger screen used a straight-line haversine, which under-reads badly in
// Kigali: the city is built on ridges, and two points 2km apart across a valley
// can be a 5km drive. Quoting the straight line means the rider is paid for a
// trip nobody made.
//
// Geoapify answers first: OpenStreetMap roads, a free plan that allows
// commercial use, and no card on file. Google Directions is the second try
// when its key is set. The keys live here, not in the app: a key shipped in a
// bundle can be pulled out of the APK and spent by anyone, and this endpoint
// requires a signed-in caller, so the quota is spent by passengers and nobody
// else.
import { callerClient, json } from "../_shared/supabase.ts";
import { type Answer, geoapify, google, isPoint, type Point } from "./routers.ts";

interface Body {
  origin?: Point;
  destination?: Point;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const caller = callerClient(req);
  const { data: auth } = await caller.auth.getUser();
  if (!auth.user) return json({ error: "unauthenticated" }, 401);

  const routers: ((a: Point, b: Point) => Promise<Answer>)[] = [];
  const geoapifyKey = Deno.env.get("GEOAPIFY_KEY");
  const googleKey = Deno.env.get("GOOGLE_DIRECTIONS_KEY");
  if (geoapifyKey) routers.push((a, b) => geoapify(geoapifyKey, a, b));
  if (googleKey) routers.push((a, b) => google(googleKey, a, b));
  if (routers.length === 0) return json({ error: "directions_key_not_configured" }, 500);

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

  for (const route of routers) {
    const answer = await route(origin, destination);
    if (answer === "no_route") return json({ error: "no_route" }, 404);
    if (answer) return json(answer, 200);
  }
  return json({ error: "directions_failed" }, 502);
});
