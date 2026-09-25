// Pure decision logic, split out of index.ts so it can be imported by tests
// without triggering Deno.serve at module load (see the note in
// complete-trip/index_test.ts: importing an index.ts that calls Deno.serve
// at the top level requires --allow-net and starts a listener as a side
// effect of import, which is not something a unit test should do).
import { rankByEta } from "../_shared/core.ts";
import type { VehicleClass, EtaProvider } from "../_shared/core.ts";

/** `requested`: nobody has been offered yet. `offered`: covers re-dispatch
 *  after a decline, a timeout, or a retry that lands while an offer is still
 *  live - whether that retry creates a new offer or rejoins the existing one
 *  is create_trip_offer's decision, not this guard's. Every other state means
 *  the trip is no longer dispatch's to touch. */
export function isDispatchable(state: string): boolean {
  return state === "requested" || state === "offered";
}

/** Pure ranking: given a candidate set already narrowed by geography and
 *  eligibility (find_candidates_for_trip's job), rank by real ETA and return
 *  the winner, or null when there is nobody to rank.
 *
 *  This is only the PROPOSAL dispatch makes. Whether this candidate is who
 *  actually ends up holding the offer is decided by create_trip_offer, which
 *  can idempotently hand back a different, pre-existing offer - the caller
 *  must build its response from that RPC's return value, never from this
 *  function's. */
export async function selectBestCandidate(
  rows: readonly { driver_id: string; distance_m: number }[],
  vehicleClass: VehicleClass,
  provider: EtaProvider,
): Promise<{ driverId: string; etaSeconds: number } | null> {
  if (rows.length === 0) return null;

  const ranked = await rankByEta(
    rows.map((c) => ({ driverId: c.driver_id, distanceM: Number(c.distance_m) })),
    vehicleClass,
    provider,
  );

  const best = ranked[0];
  return best ? { driverId: best.driverId, etaSeconds: best.etaSeconds } : null;
}
