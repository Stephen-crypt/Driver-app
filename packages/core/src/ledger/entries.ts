/**
 * The fleet ledger.
 *
 * One table, two readings. A rider paid in cash is holding the company's money
 * while the company owes them their earnings, and those are different
 * quantities that must not be netted into a single "balance":
 *
 *   CASH HELD = fares collected - remittances            (exposure)
 *   NET OWED  = earnings + bonuses - deductions - payouts (liability)
 *
 * A rider carrying 50,000 RWF of unremitted fares who has earned 20,000 nets to
 * -30,000, but the number that decides whether they work tomorrow is the 50,000
 * in their pocket.
 */
export const LEDGER_ENTRY_KINDS = [
  // Cash side.
  "fare_collected",
  "cash_remittance",
  // Earnings side.
  "trip_earning",
  "bonus",
  "deduction",
  "payout",
  "adjustment_credit",
  "adjustment_debit",
  // Retired marketplace kinds. Postgres cannot drop an enum value and the rows
  // already written are real history, so they stay - classified, never written.
  "commission_debit",
  "topup_credit",
] as const;

export type LedgerEntryKind = (typeof LEDGER_ENTRY_KINDS)[number];

export interface LedgerEntry {
  readonly kind: LedgerEntryKind;
  /** Always positive. Direction is carried by `kind`, never by the sign. */
  readonly amountRwf: number;
}

/**
 * Which side of the ledger a kind belongs to, and which way it points.
 *
 * Exhaustive by construction: adding a kind without classifying it here is a
 * compile error, not a silent zero. The previous version of this function
 * classified only two kinds explicitly and let an implicit `else` treat
 * everything else as a debit - which would have silently mis-signed every new
 * fleet kind added above.
 */
type Side = "cash" | "owed" | "none";

function classify(kind: LedgerEntryKind): { side: Side; sign: 1 | -1 } {
  switch (kind) {
    case "fare_collected":
      return { side: "cash", sign: 1 };
    case "cash_remittance":
      return { side: "cash", sign: -1 };

    case "trip_earning":
    case "bonus":
    case "adjustment_credit":
    // A top-up was money the rider had already handed the company, so under
    // the fleet reading it counts the same way: something we owe them back.
    case "topup_credit":
      return { side: "owed", sign: 1 };

    case "deduction":
    case "payout":
    case "adjustment_debit":
    // Commission reduced what a marketplace rider was owed.
    case "commission_debit":
      return { side: "owed", sign: -1 };

    default: {
      const unhandled: never = kind;
      throw new Error(`unhandled ledger entry kind: ${String(unhandled)}`);
    }
  }
}

function total(entries: readonly LedgerEntry[], side: Side): number {
  return entries.reduce((sum, entry) => {
    if (entry.amountRwf < 0) throw new Error("amountRwf must be >= 0");
    const { side: entrySide, sign } = classify(entry.kind);
    return entrySide === side ? sum + sign * entry.amountRwf : sum;
  }, 0);
}

/** Company cash sitting in a rider's pocket. Exposure. */
export function cashHeldOf(entries: readonly LedgerEntry[]): number {
  return total(entries, "cash");
}

/** What the company owes the rider. Negative means they owe the company. */
export function netOwedOf(entries: readonly LedgerEntry[]): number {
  return total(entries, "owed");
}

/** The company's share of a fare. */
export function commissionFor(fareRwf: number, ratePercent: number): number {
  if (ratePercent < 0 || ratePercent > 100) {
    throw new Error("ratePercent must be between 0 and 100");
  }
  return Math.round((fareRwf * ratePercent) / 100);
}

/**
 * The rider's share: the remainder after commission, never an independent
 * percentage. Subtracting guarantees earning + commission = fare exactly; two
 * separate roundings leak a franc on most fares, and a rider who adds up their
 * own trips will find it.
 */
export function riderEarningFor(fareRwf: number, commissionPercent: number): number {
  return fareRwf - commissionFor(fareRwf, commissionPercent);
}

/**
 * A fleet rider works if they have a vehicle and are not carrying too much of
 * the company's cash. The marketplace test - "has a positive float" - is gone:
 * the riders work for us, so they do not buy their way onto the road.
 */
export function canGoOnline(args: {
  readonly hasActiveVehicle: boolean;
  readonly cashHeldRwf: number;
  readonly maxCashHeldRwf: number;
}): boolean {
  return args.hasActiveVehicle && args.cashHeldRwf <= args.maxCashHeldRwf;
}
