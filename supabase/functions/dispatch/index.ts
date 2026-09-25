import {
  rankByEta,
  straightLineEta,
  DISPATCH_RADII_M,
  CANDIDATE_SHORTLIST,
  OFFER_TTL_SECONDS,
} from "../_shared/core.ts";
import type { VehicleClass } from "../_shared/core.ts";
import { serviceClient, json } from "../_shared/supabase.ts";

interface Candidate {
  driver_id: string;
  distance_m: number;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: { tripId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const tripId = body.tripId;
  if (!tripId) return json({ error: "missing_trip_id" }, 400);

  const svc = serviceClient();

  const { data: trip, error: tripError } = await svc
    .from("trips")
    .select("id, state, vehicle_class")
    .eq("id", tripId)
    .single();

  if (tripError || !trip) return json({ error: "trip_not_found" }, 404);
  if (trip.state !== "requested" && trip.state !== "offered") {
    return json({ error: "trip_not_dispatchable", state: trip.state }, 409);
  }

  // Widen only when a stage finds nobody (spec 3.3). The trip-keyed wrapper
  // keeps the pickup geography inside the database - reading it out and handing
  // it back as a parameter is a text-format guess waiting to fail.
  for (const radiusM of DISPATCH_RADII_M) {
    const { data: candidates, error: matchError } = await svc.rpc("find_candidates_for_trip", {
      p_trip_id: tripId,
      p_radius_m: radiusM,
      p_limit: CANDIDATE_SHORTLIST,
    });

    if (matchError) return json({ error: matchError.message }, 500);

    const rows = (candidates ?? []) as Candidate[];
    if (rows.length === 0) continue;

    const ranked = await rankByEta(
      rows.map((c) => ({ driverId: c.driver_id, distanceM: Number(c.distance_m) })),
      trip.vehicle_class as VehicleClass,
      straightLineEta,
    );

    const best = ranked[0];
    if (!best) continue;

    const { data: offer, error: offerError } = await svc
      .rpc("create_trip_offer", {
        p_trip_id: tripId,
        p_driver_id: best.driverId,
        p_rank: 1,
        p_eta_seconds: best.etaSeconds,
        p_ttl_seconds: OFFER_TTL_SECONDS,
        p_idempotency_key: `offer-${tripId}-${best.driverId}-${Date.now()}`,
      })
      .single();

    if (offerError) return json({ error: offerError.message }, 409);

    return json({
      tripId,
      offered: true,
      offerId: (offer as { id?: string } | null)?.id,
      driverId: best.driverId,
      rank: 1,
      etaSeconds: best.etaSeconds,
      radiusM,
    });
  }

  return json({ tripId, offered: false, reason: "no_drivers_available" });
});
