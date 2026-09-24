import { buildReceipt } from "../_shared/core.ts";
import type { FarePolicy } from "../_shared/core.ts";
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

  // Read the trip as the CALLER so RLS decides whether they may see it.
  const { data: trip, error: tripError } = await caller
    .from("trips")
    .select("id, vehicle_class, quoted_distance_m, quoted_amount_rwf")
    .eq("id", tripId)
    .single();

  if (tripError || !trip) return json({ error: "trip_not_found" }, 404);

  const svc = serviceClient();
  const { data: row, error: policyError } = await svc
    .rpc("current_fare_policy", { p_class: trip.vehicle_class })
    .single();

  if (policyError || !row) return json({ error: "no_fare_policy" }, 503);

  const policy: FarePolicy = {
    vehicleClass: row.vehicle_class,
    baseRwf: row.base_rwf,
    perKmRwf: row.per_km_rwf,
    perMinuteRwf: row.per_minute_rwf,
    minimumRwf: row.minimum_rwf,
    commissionPct: Number(row.commission_pct),
  };

  // The locked price comes off the trip itself, set at creation from the quote.
  // Never re-derive it or look up "the latest quote" - that is how one rider
  // gets charged another rider's fare.
  if (trip.quoted_amount_rwf === null || trip.quoted_amount_rwf === undefined) {
    return json({ error: "trip_has_no_quote" }, 409);
  }

  const receipt = buildReceipt(
    policy,
    trip.quoted_amount_rwf,
    trip.quoted_distance_m ?? 0,
    actualDistanceM,
  );

  // Call as the CALLER: complete_trip defers to trip_transition, which rejects
  // anyone who is not the trip's driver.
  const { data: completed, error: completeError } = await caller
    .rpc("complete_trip", {
      p_trip_id: tripId,
      p_actual_distance_m: Math.round(actualDistanceM),
      p_total_rwf: receipt.totalRwf,
      p_commission_rwf: receipt.commissionRwf,
      p_idempotency_key: idempotencyKey,
    })
    .single();

  if (completeError) return json({ error: completeError.message }, 400);

  return json({
    tripId,
    state: completed?.state ?? "completed",
    receipt: { lines: receipt.lines, totalRwf: receipt.totalRwf },
    commissionRwf: receipt.commissionRwf,
  });
});
