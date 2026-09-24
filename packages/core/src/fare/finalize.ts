import { roundFareRwf, type FarePolicy } from "./policy";

/** Detours up to this fraction beyond the quoted distance are absorbed. */
export const OVERAGE_TOLERANCE = 0.15;

export interface FinalFare {
  readonly totalRwf: number;
  readonly quotedRwf: number;
  readonly overageRwf: number;
  readonly overageMetres: number;
}

export function finalizeFare(
  policy: FarePolicy,
  quotedRwf: number,
  quotedDistanceMetres: number,
  actualDistanceMetres: number,
): FinalFare {
  if (actualDistanceMetres < 0) throw new Error("actualDistanceMetres must be >= 0");

  const bandEnd = quotedDistanceMetres * (1 + OVERAGE_TOLERANCE);
  const overageMetres = Math.max(0, Math.round(actualDistanceMetres - bandEnd));
  const overageRwf =
    overageMetres === 0 ? 0 : roundFareRwf((overageMetres / 1000) * policy.perKmRwf);

  return {
    totalRwf: quotedRwf + overageRwf,
    quotedRwf,
    overageRwf,
    overageMetres,
  };
}
