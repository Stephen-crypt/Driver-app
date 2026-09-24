export const LEDGER_ENTRY_KINDS = [
  "commission_debit",
  "topup_credit",
  "adjustment_credit",
  "adjustment_debit",
] as const;

export type LedgerEntryKind = (typeof LEDGER_ENTRY_KINDS)[number];

export interface LedgerEntry {
  readonly kind: LedgerEntryKind;
  /** Always positive. Direction is carried by `kind`, never by the sign. */
  readonly amountRwf: number;
}

const CREDIT_KINDS: readonly LedgerEntryKind[] = ["topup_credit", "adjustment_credit"];

export function commissionFor(fareRwf: number, ratePercent: number): number {
  if (ratePercent < 0 || ratePercent > 100) {
    throw new Error("ratePercent must be between 0 and 100");
  }
  return Math.round((fareRwf * ratePercent) / 100);
}

export function balanceOf(entries: readonly LedgerEntry[]): number {
  return entries.reduce((total, entry) => {
    if (entry.amountRwf < 0) throw new Error("amountRwf must be >= 0");
    return CREDIT_KINDS.includes(entry.kind)
      ? total + entry.amountRwf
      : total - entry.amountRwf;
  }, 0);
}

export function canGoOnline(balanceRwf: number, minimumRwf: number): boolean {
  return balanceRwf >= minimumRwf;
}
