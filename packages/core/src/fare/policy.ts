export const VEHICLE_CLASSES = ["moto", "cab", "cab_xl"] as const;
export type VehicleClass = (typeof VEHICLE_CLASSES)[number];

export interface FarePolicy {
  readonly vehicleClass: VehicleClass;
  /** Flat charge applied to every trip, in whole RWF. */
  readonly baseRwf: number;
  readonly perKmRwf: number;
  readonly perMinuteRwf: number;
  /** No passenger is ever quoted below this, in whole RWF. */
  readonly minimumRwf: number;
  /** Platform commission as a percentage of the fare, 0-100. */
  readonly commissionPct: number;
}

/** Passenger-facing fares are always whole hundreds of francs, rounded up. */
export function roundFareRwf(amount: number): number {
  return Math.ceil(amount / 100) * 100;
}
