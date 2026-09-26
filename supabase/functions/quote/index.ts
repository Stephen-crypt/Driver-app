import { quoteFare, VEHICLE_CLASSES } from "../_shared/core.ts";
import type { VehicleClass } from "../_shared/core.ts";
import { policyFromRow, type FarePolicyRow } from "../_shared/policy.ts";
import { callerClient, serviceClient, json } from "../_shared/supabase.ts";
import { MAX_DISTANCE_M, inServiceArea, isPoint, pricedRoute } from "./route.ts";

const QUOTE_TTL_SECONDS = 120;

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const caller = callerClient(req);
  const { data: auth } = await caller.auth.getUser();
  if (!auth.user) return json({ error: "unauthenticated" }, 401);

  let body: { vehicleClass?: string; distanceM?: number; durationS?: number; pickup?: unknown; dropoff?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const { vehicleClass, pickup, dropoff } = body;

  if (!VEHICLE_CLASSES.includes(vehicleClass as VehicleClass)) {
    return json({ error: "unknown_vehicle_class" }, 400);
  }
  // The route is the server's to price, not the app's: see route.ts.
  if (!isPoint(pickup) || !isPoint(dropoff)) {
    return json({ error: "route_required" }, 400);
  }
  if (!inServiceArea(pickup) || !inServiceArea(dropoff)) {
    return json({ error: "outside_service_area" }, 400);
  }
  const { distanceM, durationS } = pricedRoute(pickup, dropoff, body);
  if (distanceM > MAX_DISTANCE_M) {
    return json({ error: "too_far" }, 400);
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
      distance_m: distanceM,
      duration_s: durationS,
      amount_rwf: amountRwf,
      expires_at: expiresAt,
      pickup: `SRID=4326;POINT(${pickup.lng} ${pickup.lat})`,
      dropoff: `SRID=4326;POINT(${dropoff.lng} ${dropoff.lat})`,
    })
    .select("id")
    .single();

  if (writeError || !quote) return json({ error: "quote_write_failed" }, 500);

  return json({
    quoteId: quote.id,
    amountRwf,
    expiresAt,
    vehicleClass,
    distanceM,
    durationS,
  });
});
