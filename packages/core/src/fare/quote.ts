import { roundFareRwf, type FarePolicy } from "./policy";

export function quoteFare(
  policy: FarePolicy,
  distanceMetres: number,
  durationSeconds: number,
): number {
  if (distanceMetres < 0) throw new Error("distanceMetres must be >= 0");
  if (durationSeconds < 0) throw new Error("durationSeconds must be >= 0");

  const distanceCharge = (distanceMetres / 1000) * policy.perKmRwf;
  const timeCharge = (durationSeconds / 60) * policy.perMinuteRwf;
  const raw = policy.baseRwf + distanceCharge + timeCharge;

  return roundFareRwf(Math.max(raw, policy.minimumRwf));
}
