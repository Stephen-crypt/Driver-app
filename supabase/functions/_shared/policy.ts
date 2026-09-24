import type { FarePolicy, VehicleClass } from "./core.ts";

/**
 * A row as current_fare_policy() and fare_policy_for_quote() return it.
 *
 * Both are SQL functions returning the `public.fare_policies` COMPOSITE type,
 * and that is the trap this module exists for: when no row is effective, the
 * composite is not "no rows" - PostgREST hands back exactly ONE row with every
 * field null. So `error || !row` is false, `row.per_km_rwf` is null, and null
 * coerces to 0 through every arithmetic step: ops setting effective_to = now()
 * with the replacement effective tomorrow would have every moto trip quote
 * 0 RWF, with no error anywhere to notice it by.
 */
export interface FarePolicyRow {
  readonly id: string | null;
  readonly vehicle_class: VehicleClass;
  readonly base_rwf: number | null;
  readonly per_km_rwf: number | null;
  readonly per_minute_rwf: number | null;
  readonly minimum_rwf: number | null;
  readonly commission_pct: number | string | null;
}

/**
 * The policy, or null when there isn't one. `id` is the discriminator: it is the
 * primary key, so a row with a null id is the all-null composite and never a
 * real policy. Callers turn null into the 503 they already return.
 */
export function policyFromRow(
  row: FarePolicyRow | null | undefined,
): FarePolicy | null {
  if (!row || row.id == null) return null;

  return {
    vehicleClass: row.vehicle_class,
    baseRwf: Number(row.base_rwf),
    perKmRwf: Number(row.per_km_rwf),
    perMinuteRwf: Number(row.per_minute_rwf),
    minimumRwf: Number(row.minimum_rwf),
    commissionPct: Number(row.commission_pct),
  };
}
