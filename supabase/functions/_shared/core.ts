// Runtime values come from the generated bundle, which lives inside the
// directory supabase functions serve mounts into its container.
//
// Types are declared in the sibling core.bundle.d.ts, not imported from
// @gera/core directly: supabase functions serve's dependency-graph builder
// resolves type-only imports/exports too (it does not erase them before
// deciding what to fetch), so even `export type {...} from "@gera/core"`
// fails to boot inside the container exactly like a value import would -
// packages/core lives outside the directory it mounts. core_test.ts checks
// core.bundle.d.ts stays structurally identical to packages/core's real
// types, so this can never quietly drift.
// @deno-types="./core.bundle.d.ts"
export {
  quoteFare,
  buildReceipt,
  commissionFor,
  roundFareRwf,
  VEHICLE_CLASSES,
  OFFER_TTL_SECONDS,
  DISPATCH_RADII_M,
  CANDIDATE_SHORTLIST,
  AVERAGE_SPEED_MPS,
  straightLineEta,
  rankByEta,
  type FarePolicy,
  type VehicleClass,
  type Receipt,
  type EtaProvider,
} from "./core.bundle.js";
