// Place search beyond Nova's own landmarks, and a name for where a passenger
// is standing. Geoapify answers both from OpenStreetMap; search also asks
// open_places (Overture), which has the businesses OSM lacks.
//
//   POST { search: "kimironko", near?: { lat, lng } }  ->  { places: Found[] }
//   POST { reverse: { lat, lng } }                     ->  { label: string | null }
//
// The key lives here, not in the app, and only a signed-in caller can spend
// it - the free plan is 3,000 requests a day.
import { callerClient, json } from "../_shared/supabase.ts";
import { parseReverse, parseSearch, type Point, reverseUrl, searchUrl } from "./geoapify.ts";
import { mergePlaces, type OpenPlace } from "./merge.ts";

const isPoint = (p: unknown): p is Point => {
  const q = p as Point | null;
  return !!q && typeof q.lat === "number" && typeof q.lng === "number" && Number.isFinite(q.lat) && Number.isFinite(q.lng) &&
    Math.abs(q.lat) <= 90 && Math.abs(q.lng) <= 180;
};

async function fetchJson(url: string): Promise<unknown | null> {
  const res = await fetch(url).catch(() => null);
  if (!res?.ok) {
    console.error(`geoapify geocode: HTTP ${res?.status ?? "unreachable"}`);
    return null;
  }
  return await res.json().catch(() => null);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const caller = callerClient(req);
  const { data: auth } = await caller.auth.getUser();
  if (!auth.user) return json({ error: "unauthenticated" }, 401);

  const key = Deno.env.get("GEOAPIFY_KEY");
  if (!key) return json({ error: "places_key_not_configured" }, 500);

  let body: { search?: unknown; near?: unknown; reverse?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  if (typeof body.search === "string") {
    const text = body.search.trim();
    if (text.length < 2 || text.length > 100) return json({ error: "invalid_search" }, 400);
    const near = isPoint(body.near) ? body.near : null;
    const [data, open] = await Promise.all([
      fetchJson(searchUrl(key, text, near)),
      caller
        .rpc("search_open_places", { p_query: text, p_lng: near?.lng ?? null, p_lat: near?.lat ?? null, p_limit: 8 })
        .then(({ data, error }) => {
          if (error) console.error(`search_open_places: ${error.message}`);
          return (data ?? []) as OpenPlace[];
        }),
    ]);
    // Either source alone is still an answer; only both failing is a failure.
    if (data === null && open.length === 0) return json({ error: "search_failed" }, 502);
    return json({ places: mergePlaces(data === null ? [] : parseSearch(data), open) });
  }

  if (isPoint(body.reverse)) {
    const data = await fetchJson(reverseUrl(key, body.reverse));
    if (data === null) return json({ error: "reverse_failed" }, 502);
    return json({ label: parseReverse(data) });
  }

  return json({ error: "search_or_reverse_required" }, 400);
});
