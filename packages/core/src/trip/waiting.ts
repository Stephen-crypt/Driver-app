/**
 * NOVA §15. The rider waits a grace period free of charge; after it, each whole
 * minute costs the passenger a fixed amount. Mirrored by waiting_charge_rwf()
 * in SQL, with a parity test - the app draws the running charge, the database
 * is what bills it.
 *
 * Whole minutes only: a passenger who comes out at 5:59 of a five-minute grace
 * pays for nothing, not for a minute they did not use.
 */
export function waitingChargeFor(
  waitedSeconds: number,
  graceSeconds: number,
  perMinuteRwf: number,
): number {
  if (waitedSeconds <= graceSeconds) return 0;
  return Math.floor((waitedSeconds - graceSeconds) / 60) * perMinuteRwf;
}

/** Seconds of free waiting left, never negative. */
export function graceRemaining(waitedSeconds: number, graceSeconds: number): number {
  return Math.max(0, graceSeconds - waitedSeconds);
}
