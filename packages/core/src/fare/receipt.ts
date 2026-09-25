import { finalizeFare } from "./finalize";
import { commissionFor, riderEarningFor } from "../ledger/entries";
import type { FarePolicy } from "./policy";

export interface ReceiptLine {
  readonly label: string;
  readonly amountRwf: number;
}

export interface Receipt {
  readonly lines: readonly ReceiptLine[];
  readonly totalRwf: number;
  /** The company's share. Internal - never shown to a passenger. */
  readonly commissionRwf: number;
  /** What the rider is owed for this trip. The number they actually care about. */
  readonly riderEarningRwf: number;
}

/**
 * Spec 3.4: an overage is always its own line. A passenger who paid more than the
 * quote must be able to see exactly why, so the fare line keeps the quoted
 * figure and the excess is stated separately. Waiting time (NOVA §15) is the
 * same: its own line, never folded into the fare.
 *
 * The waiting charge is passed in, not computed here: it depends on the trip's
 * event timestamps, which only the database holds. trip_wait_status() is where
 * the caller gets it, and it is the same function complete_trip() bills from.
 */
export function buildReceipt(
  policy: FarePolicy,
  quotedRwf: number,
  quotedDistanceMetres: number,
  actualDistanceMetres: number,
  waitingChargeRwf = 0,
): Receipt {
  const final = finalizeFare(policy, quotedRwf, quotedDistanceMetres, actualDistanceMetres);

  const lines: ReceiptLine[] = [{ label: "Fare", amountRwf: final.quotedRwf }];
  if (final.overageRwf > 0) {
    lines.push({ label: "Extra distance", amountRwf: final.overageRwf });
  }
  if (waitingChargeRwf > 0) {
    lines.push({ label: "Waiting time", amountRwf: waitingChargeRwf });
  }

  const totalRwf = final.totalRwf + Math.max(0, waitingChargeRwf);

  return {
    lines,
    totalRwf,
    commissionRwf: commissionFor(totalRwf, policy.commissionPct),
    riderEarningRwf: riderEarningFor(totalRwf, policy.commissionPct),
  };
}
