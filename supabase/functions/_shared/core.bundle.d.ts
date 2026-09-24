// Hand-written type surface for core.bundle.js (see scripts/bundle-core.mjs).
//
// core.bundle.js is a flat, generated bundle with no import statements, so
// it carries no embedded type information - Deno would otherwise infer its
// exports as widened plain-JS types (e.g. `string[]` instead of the real
// `"moto" | "cab" | "cab_xl"` union), which is not good enough for
// `strict: true` callers like supabase/functions/quote.
//
// This file restores the real types WITHOUT resolving anything outside this
// directory: supabase functions serve's dependency-graph builder resolves
// type-only imports/exports too (it does not erase them before deciding
// what to fetch), so even a type-only reference to packages/core fails to
// boot inside its container exactly like a value import would. A
// self-contained `.d.ts` with no imports of its own is required.
//
// This is NOT a second place fare/commission arithmetic is authored - only
// the wire shapes are declared here, and only as declarations (no
// implementations). The structural-equivalence test in core_test.ts fails
// the build if these ever diverge from packages/core's real types, so
// drift here is caught the same way a stale core.bundle.js is.
export declare const VEHICLE_CLASSES: readonly ["moto", "cab", "cab_xl"];
export type VehicleClass = (typeof VEHICLE_CLASSES)[number];

export interface FarePolicy {
  readonly vehicleClass: VehicleClass;
  readonly baseRwf: number;
  readonly perKmRwf: number;
  readonly perMinuteRwf: number;
  readonly minimumRwf: number;
  readonly commissionPct: number;
}

export interface ReceiptLine {
  readonly label: string;
  readonly amountRwf: number;
}

export interface Receipt {
  readonly lines: readonly ReceiptLine[];
  readonly totalRwf: number;
  readonly commissionRwf: number;
}

export declare function roundFareRwf(amount: number): number;
export declare function quoteFare(
  policy: FarePolicy,
  distanceMetres: number,
  durationSeconds: number,
): number;
export declare function commissionFor(
  fareRwf: number,
  ratePercent: number,
): number;
export declare function buildReceipt(
  policy: FarePolicy,
  quotedRwf: number,
  quotedDistanceMetres: number,
  actualDistanceMetres: number,
): Receipt;
