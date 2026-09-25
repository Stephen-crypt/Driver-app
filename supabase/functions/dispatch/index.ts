import {
  straightLineEta,
  DISPATCH_RADII_M,
  CANDIDATE_SHORTLIST,
  OFFER_TTL_SECONDS,
} from "../_shared/core.ts";
import type { VehicleClass } from "../_shared/core.ts";
import { serviceClient, json } from "../_shared/supabase.ts";
import { isDispatchable, selectBestCandidate } from "./logic.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

interface Candidate {
  driver_id: string;
  distance_m: number;
}

interface OfferRow {
  id: string;
  driver_id: string;
  rank: number;
  eta_seconds: number;
}

const POSTGRES_UNIQUE_VIOLATION = "23505";

interface OfferArgs {
  p_trip_id: string;
  p_driver_id: string;
  p_rank: number;
  p_eta_seconds: number;
  p_ttl_seconds: number;
  p_idempotency_key: string;
}

/** Creates the offer, treating losing the create-offer race as a normal
 * outcome rather than a failure to surface. create_trip_offer is idempotent
 * on trip_id: it returns the existing live offer whenever one already
 * exists, instead of inserting a second one. Two concurrent dispatch calls
 * can both pass that check before either commits, so the loser's insert can
 * still raise a unique_violation (23505) on `trip_offers_one_live_per_trip`.
 * When that happens the winner has, by definition, already committed - so
 * calling create_trip_offer again now takes the idempotent early-return path
 * and hands back the real offer, which is what the caller must be told
 * about, not a database error string. */
async function createOfferOrJoinExisting(
  svc: SupabaseClient,
  args: OfferArgs,
): Promise<{ offer: OfferRow } | { errorBody: Record<string, unknown>; status: number }> {
  const first = await svc.rpc("create_trip_offer", args).single();
  if (!first.error) return { offer: first.data as OfferRow };

  if (first.error.code === POSTGRES_UNIQUE_VIOLATION) {
    const retry = await svc.rpc("create_trip_offer", args).single();
    if (!retry.error) return { offer: retry.data as OfferRow };
    console.error("dispatch: retry after offer race failed", retry.error);
    return { errorBody: { error: "offer_conflict" }, status: 409 };
  }

  console.error("dispatch: create_trip_offer failed", first.error);
  return { errorBody: { error: "offer_failed" }, status: 500 };
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
  if (!isDispatchable(trip.state)) {
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
    const best = await selectBestCandidate(rows, trip.vehicle_class as VehicleClass, straightLineEta);
    if (!best) continue;

    const result = await createOfferOrJoinExisting(svc, {
      p_trip_id: tripId,
      p_driver_id: best.driverId,
      p_rank: 1,
      p_eta_seconds: best.etaSeconds,
      p_ttl_seconds: OFFER_TTL_SECONDS,
      p_idempotency_key: `offer-${tripId}-${best.driverId}-${Date.now()}`,
    });

    if ("errorBody" in result) return json(result.errorBody, result.status);

    // The offer row the RPC actually returned is the only true outcome - it
    // may belong to a different driver than `best` when create_trip_offer
    // rejoined an existing live offer instead of creating a fresh one.
    const { offer } = result;
    return json({
      tripId,
      offered: true,
      offerId: offer.id,
      driverId: offer.driver_id,
      rank: offer.rank,
      etaSeconds: offer.eta_seconds,
      radiusM,
      alreadyOffered: offer.driver_id !== best.driverId,
    });
  }

  return json({ tripId, offered: false, reason: "no_drivers_available" });
});
