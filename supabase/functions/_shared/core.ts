// Single import point for the domain core. The fare and commission arithmetic
// has exactly one implementation, in packages/core, which is dependency-free
// specifically so Deno can run it unchanged.
export {
  quoteFare,
  buildReceipt,
  commissionFor,
  roundFareRwf,
  VEHICLE_CLASSES,
} from "@gera/core";

export type { FarePolicy, VehicleClass, Receipt } from "@gera/core";
