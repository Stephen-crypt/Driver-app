import {
  straightLineEta,
  DISPATCH_RADII_M,
  CANDIDATE_SHORTLIST,
  OFFER_TTL_SECONDS,
} from "../_shared/core.ts";
import type { VehicleClass } from "../_shared/core.ts";
import { serviceClient, json } from "../_shared/supabase.ts";
import { isDispatchable, rankCandidates } from "./logic.ts";
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
// create_trip_offer raises 42501 for `driver_already_offered` and
// `driver_already_committed`. Both are statements about the CANDIDATE, not
// about this trip: the driver the dispatcher picked took something else in the
// window between find_candidates_for_trip's snapshot and the insert. That is a
// routine race on a busy evening, and it used to fall through to a generic 500.
const POSTGRES_COMMITMENT_REFUSED = "42501";

interface OfferArgs {
  p_trip_id: string;
  p_driver_id: string;
  p_rank: number;
  p_eta_seconds: number;
  p_ttl_seconds: number;
  p_idempotency_key: string;
}

/** Either the offer, or "this candidate cannot hold it - ask the next one", or
 * a genuine failure to report over HTTP. The middle case is what keeps a lost
 * race from becoming a 500. */
type OfferOutcome =
  | { offer: OfferRow }
  | { candidateUnavailable: true }
  | { errorBody: Record<string, unknown>; status: number };

/** Creates the offer, treating losing the create-offer race as a normal
 * outcome rather than a failure to surface. There are two distinct races, and
 * they want opposite responses:
 *
 *   * 23505 is a race on THIS TRIP. create_trip_offer is idempotent on
 *     trip_id - it returns the existing live offer whenever one already
 *     exists - but two concurrent dispatch calls can both pass that check
 *     before either commits, so the loser's insert still raises a
 *     unique_violation on `trip_offers_one_live_per_trip`. When that happens
 *     the winner has by definition already committed, so calling
 *     create_trip_offer again NOW takes the idempotent early-return path and
 *     hands back the real offer - which is what the caller must be told about,
 *     not a database error string.
 *
 *   * 42501 is a race on THIS DRIVER. Retrying the same arguments would raise
 *     the same error forever; the only way forward is a different candidate.
 *
 * The retry after 23505 can itself land on 42501: the unique violation may have
 * been on `trip_offers_one_live_per_driver` rather than `_per_trip`, and by the
 * retry the committed row is visible to the named check. So that answer routes
 * to the next candidate too. */
async function createOfferOrJoinExisting(
  svc: SupabaseClient,
  args: OfferArgs,
): Promise<OfferOutcome> {
  const first = await svc.rpc("create_trip_offer", args).single();
  if (!first.error) return { offer: first.data as OfferRow };

  if (first.error.code === POSTGRES_COMMITMENT_REFUSED) {
    console.warn("dispatch: candidate no longer available", args.p_driver_id, first.error.message);
    return { candidateUnavailable: true };
  }

  if (first.error.code === POSTGRES_UNIQUE_VIOLATION) {
    const retry = await svc.rpc("create_trip_offer", args).single();
    if (!retry.error) return { offer: retry.data as OfferRow };
    if (retry.error.code === POSTGRES_COMMITMENT_REFUSED) {
      console.warn("dispatch: candidate taken by the race winner", args.p_driver_id);
      return { candidateUnavailable: true };
    }
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

  // Set when a candidate was found but refused the offer. It is the difference
  // between "nobody was near enough" and "everybody near enough was taken a
  // moment ago", and the two deserve different answers: the first is final for
  // this attempt, the second is worth retrying.
  let anyCandidateRefused = false;

  // Widen only when a stage finds nobody (spec 3.3). The trip-keyed wrapper
  // keeps the pickup geography inside the database - reading it out and handing
  // it back as a parameter is a text-format guess waiting to fail.
  for (const radiusM of DISPATCH_RADII_M) {
    const { data: candidates, error: matchError } = await svc.rpc("find_candidates_for_trip", {
      p_trip_id: tripId,
      p_radius_m: radiusM,
      p_limit: CANDIDATE_SHORTLIST,
    });

    // Static, like the offer branch above: matchError.message is a Postgres
    // error string, and this endpoint answers over HTTP. It has leaked
    // function signatures and column names before. Log the detail, return a
    // code.
    if (matchError) {
      console.error("dispatch: find_candidates_for_trip failed", matchError);
      return json({ error: "match_failed" }, 500);
    }

    const rows = (candidates ?? []) as Candidate[];
    const ranked = await rankCandidates(rows, trip.vehicle_class as VehicleClass, straightLineEta);

    // Down the shortlist in ETA order. Stopping at the head meant one lost race
    // left the trip in `requested` with no offer and nothing to retry it.
    for (const candidate of ranked) {
      const result = await createOfferOrJoinExisting(svc, {
        p_trip_id: tripId,
        p_driver_id: candidate.driverId,
        p_rank: 1,
        p_eta_seconds: candidate.etaSeconds,
        p_ttl_seconds: OFFER_TTL_SECONDS,
        p_idempotency_key: `offer-${tripId}-${candidate.driverId}-${Date.now()}`,
      });

      if ("errorBody" in result) return json(result.errorBody, result.status);

      if ("candidateUnavailable" in result) {
        anyCandidateRefused = true;
        continue;
      }

      // The offer row the RPC actually returned is the only true outcome - it
      // may belong to a different driver than `candidate` when
      // create_trip_offer rejoined an existing live offer instead of creating a
      // fresh one.
      const { offer } = result;
      return json({
        tripId,
        offered: true,
        offerId: offer.id,
        driverId: offer.driver_id,
        rank: offer.rank,
        etaSeconds: offer.eta_seconds,
        radiusM,
        alreadyOffered: offer.driver_id !== candidate.driverId,
      });
    }
  }

  // Candidates existed at every radius and every one of them was already
  // committed by the time the insert ran. Saying `no_drivers_available` here
  // would be a lie the caller cannot act on; a 409 says "transient, ask again",
  // which is true.
  if (anyCandidateRefused) return json({ error: "offer_conflict" }, 409);

  return json({ tripId, offered: false, reason: "no_drivers_available" });
});
