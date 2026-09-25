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
 * figure and the excess is stated separately.
 */
export function buildReceipt(
  policy: FarePolicy,
  quotedRwf: number,
  quotedDistanceMetres: number,
  actualDistanceMetres: number,
): Receipt {
  const final = finalizeFare(policy, quotedRwf, quotedDistanceMetres, actualDistanceMetres);

  const lines: ReceiptLine[] = [{ label: "Fare", amountRwf: final.quotedRwf }];
  if (final.overageRwf > 0) {
    lines.push({ label: "Extra distance", amountRwf: final.overageRwf });
  }

  return {
    lines,
    totalRwf: final.totalRwf,
    commissionRwf: commissionFor(final.totalRwf, policy.commissionPct),
    riderEarningRwf: riderEarningFor(final.totalRwf, policy.commissionPct),
  };
}
