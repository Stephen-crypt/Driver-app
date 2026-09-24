import type { FarePolicy } from "./policy";

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

  // Arithmetically roundFareRwf((overageMetres / 1000) * perKmRwf), but the
  // multiply happens in integers BEFORE the divide. Written the other way round
  // it is binary floating point: the intermediate (metres / 1000) is inexact,
  // and at per-km rates that are multiples of 125 the error is big enough to
  // push the ceiling over a whole hundred. At 1000 RWF/km an overage of 16100m
  // charged 16200 here while the SQL mirror, which is exact numeric, charged
  // 16100. The seeded rates (250/600/800) never diverged, so this was latent
  // until ops set a rate like 500 or 1000. Kept honest by
  // packages/core/test/fare/sql-parity.test.ts.
  const overageRwf =
    overageMetres === 0
      ? 0
      : Math.ceil((overageMetres * policy.perKmRwf) / 100000) * 100;

  return {
    totalRwf: quotedRwf + overageRwf,
    quotedRwf,
    overageRwf,
    overageMetres,
  };
}
