import type { VehicleClass } from "../fare/policy";

/** A driver holds an exclusive offer for this long before it passes on. */
export const OFFER_TTL_SECONDS = 15;

/** The search widens only when a stage finds nobody (spec 3.3). */
export const DISPATCH_RADII_M = [1000, 2000, 4000] as const;

/**
 * Only this many candidates get a real ETA lookup. Straight-line narrowing is
 * free; road ETAs are billed per call, so the shortlist is the cost control.
 */
export const CANDIDATE_SHORTLIST = 5;

/**
 * Rough Kigali averages including stops. A moto filters through traffic a car
 * cannot, which is most of why motos dominate the city.
 */
export const AVERAGE_SPEED_MPS: Record<VehicleClass, number> = {
  moto: 7.5,
  cab: 5.5,
  cab_xl: 5.0,
};

export interface EtaProvider {
  estimate(distanceMetres: number, vehicleClass: VehicleClass): Promise<number>;
}

/**
 * Distance over an average speed. Deliberately crude: spec 3.3 calls for Google
 * Distance Matrix on the shortlist, because terrain and one-way streets make
 * straight-line ranking wrong in Kigali. This ships until a key exists, and the
 * real provider replaces it without dispatch logic changing.
 */
export const straightLineEta: EtaProvider = {
  estimate(distanceMetres: number, vehicleClass: VehicleClass): Promise<number> {
    if (distanceMetres < 0) {
      return Promise.reject(new Error("distanceMetres must be >= 0"));
    }
    return Promise.resolve(Math.round(distanceMetres / AVERAGE_SPEED_MPS[vehicleClass]));
  },
};

export async function rankByEta<T extends { driverId: string; distanceM: number }>(
  candidates: readonly T[],
  vehicleClass: VehicleClass,
  provider: EtaProvider,
): Promise<(T & { etaSeconds: number })[]> {
  const withEta = await Promise.all(
    candidates.map(async (c) => ({
      ...c,
      etaSeconds: await provider.estimate(c.distanceM, vehicleClass),
    })),
  );
  return withEta.sort((a, b) => a.etaSeconds - b.etaSeconds);
}
