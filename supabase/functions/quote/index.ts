import { quoteFare, VEHICLE_CLASSES } from "../_shared/core.ts";
import type { VehicleClass } from "../_shared/core.ts";
import { policyFromRow, type FarePolicyRow } from "../_shared/policy.ts";
import { callerClient, serviceClient, json } from "../_shared/supabase.ts";

const QUOTE_TTL_SECONDS = 120;

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const caller = callerClient(req);
  const { data: auth } = await caller.auth.getUser();
  if (!auth.user) return json({ error: "unauthenticated" }, 401);

  let body: { vehicleClass?: string; distanceM?: number; durationS?: number };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const { vehicleClass, distanceM, durationS } = body;

  if (!VEHICLE_CLASSES.includes(vehicleClass as VehicleClass)) {
    return json({ error: "unknown_vehicle_class" }, 400);
  }
  if (typeof distanceM !== "number" || distanceM < 0 || !Number.isFinite(distanceM)) {
    return json({ error: "invalid_distance" }, 400);
  }
  if (typeof durationS !== "number" || durationS < 0 || !Number.isFinite(durationS)) {
    return json({ error: "invalid_duration" }, 400);
  }

  const svc = serviceClient();
  const { data: row, error: policyError } = await svc
    .rpc("current_fare_policy", { p_class: vehicleClass })
    .single();

  // current_fare_policy() returns a COMPOSITE, so "no effective policy" arrives
  // as one row of nulls, not as no rows: `policyError || !row` is false and the
  // null rates coerce to 0, quoting every passenger a free ride. A null id is the
  // discriminator - see _shared/policy.ts.
  const policyRow = row as FarePolicyRow | null;
  const policy = policyFromRow(policyRow);
  if (policyError || !policy || !policyRow) {
    return json({ error: "no_fare_policy" }, 503);
  }

  const amountRwf = quoteFare(policy, distanceM, durationS);
  const expiresAt = new Date(Date.now() + QUOTE_TTL_SECONDS * 1000).toISOString();

  const { data: quote, error: writeError } = await svc
    .from("fare_quotes")
    .insert({
      passenger_id: auth.user.id,
      policy_id: policyRow.id,
      vehicle_class: vehicleClass,
      distance_m: Math.round(distanceM),
      duration_s: Math.round(durationS),
      amount_rwf: amountRwf,
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (writeError || !quote) return json({ error: "quote_write_failed" }, 500);

  return json({
    quoteId: quote.id,
    amountRwf,
    expiresAt,
    vehicleClass,
    distanceM: Math.round(distanceM),
    durationS: Math.round(durationS),
  });
});
