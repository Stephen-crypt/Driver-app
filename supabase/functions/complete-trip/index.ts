import { buildReceipt } from "../_shared/core.ts";
import { policyFromRow, type FarePolicyRow } from "../_shared/policy.ts";
import { callerClient, serviceClient, json } from "../_shared/supabase.ts";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const caller = callerClient(req);
  const { data: auth } = await caller.auth.getUser();
  if (!auth.user) return json({ error: "unauthenticated" }, 401);

  let body: { tripId?: string; actualDistanceM?: number; idempotencyKey?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const { tripId, actualDistanceM, idempotencyKey } = body;
  if (!tripId) return json({ error: "missing_trip_id" }, 400);
  if (!idempotencyKey) return json({ error: "missing_idempotency_key" }, 400);
  if (
    typeof actualDistanceM !== "number" ||
    actualDistanceM < 0 ||
    !Number.isFinite(actualDistanceM)
  ) {
    return json({ error: "invalid_distance" }, 400);
  }

  // Rounded ONCE, here, and used for both the receipt below and the RPC. The
  // receipt used to be built from the raw value while the RPC got the rounded
  // one, and since the wave the ledger derives its own figures from what the
  // RPC was given: a trip quoted 1700 over 3478m with an actual of 4000.4
  // receipted at 1800 (commission 270) while the ledger debited 255. One value,
  // one price - the passenger is shown what the rider is charged against.
  const distanceM = Math.round(actualDistanceM);

  // Read the trip as the CALLER so RLS decides whether they may see it.
  const { data: trip, error: tripError } = await caller
    .from("trips")
    .select("id, vehicle_class, quoted_distance_m, quoted_amount_rwf, quote_id")
    .eq("id", tripId)
    .single();

  if (tripError || !trip) return json({ error: "trip_not_found" }, 404);

  // The locked price comes off the trip itself, set at creation from the quote.
  // Never re-derive it or look up "the latest quote" - that is how one passenger
  // gets charged another passenger's fare.
  if (trip.quoted_amount_rwf === null || trip.quoted_amount_rwf === undefined) {
    return json({ error: "trip_has_no_quote" }, 409);
  }
  if (!trip.quote_id) return json({ error: "trip_has_no_quote" }, 409);

  // The policy the trip was QUOTED under, not the one in force now. An ops rate
  // change between quote and completion must never reach a trip already priced
  // (spec 3.4). complete_trip() does the same lookup for the figures that reach
  // the ledger; this one is only for the receipt shown to the passenger.
  const svc = serviceClient();
  const { data: row, error: policyError } = await svc
    .rpc("fare_policy_for_quote", { p_quote_id: trip.quote_id })
    .single();

  // A null id means the all-null composite row, i.e. no policy - see
  // _shared/policy.ts. Without this check its null rates coerce to 0.
  const policy = policyFromRow(row as FarePolicyRow | null);
  if (policyError || !policy) return json({ error: "no_fare_policy" }, 503);

  const receipt = buildReceipt(
    policy,
    trip.quoted_amount_rwf,
    trip.quoted_distance_m ?? 0,
    distanceM,
  );

  // No amounts are passed. complete_trip() derives the total and the commission
  // itself, from the trip's locked quote and that quote's policy: this function
  // is not a trust boundary (complete_trip is granted to `authenticated`, so any
  // rider can reach it directly through PostgREST), so the numbers that reach
  // the ledger cannot come from here. Called as the CALLER: complete_trip defers
  // to trip_transition, which rejects anyone who is not the trip's rider.
  const { data: completed, error: completeError } = await caller
    .rpc("complete_trip", {
      p_trip_id: tripId,
      p_actual_distance_m: distanceM,
      p_idempotency_key: idempotencyKey,
    })
    .single();

  if (completeError) return json({ error: completeError.message }, 400);

  const completedTrip = completed as { state?: string } | null;

  // complete_trip() returns the trip row, which carries no amounts, so the body
  // reports the receipt built above. The two are now derived independently - by
  // this function in TypeScript and by the database in SQL - and they agree only
  // because packages/core/test/fare/sql-parity.test.ts says they do. The
  // authoritative figures are the ledger entry and the completion event's meta.
  return json({
    tripId,
    state: completedTrip?.state ?? "completed",
    receipt: { lines: receipt.lines, totalRwf: receipt.totalRwf },
    // The rider's earning, not the company's cut - this response goes to the
    // rider's phone, and what they need is what they made.
    riderEarningRwf: receipt.riderEarningRwf,
  });
});
