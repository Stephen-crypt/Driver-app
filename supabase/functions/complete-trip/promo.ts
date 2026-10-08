// The receipt with a promo on it. totalRwf is what the rider collects: rider
// apps from before promos show it as "Collect in cash", so it must already be
// net of the promo. grossRwf is what the ride was worth, which the rider's
// earning is worked out on - Nova covers the difference.
interface Line {
  readonly label: string;
  readonly amountRwf: number;
}

export function withPromo(receipt: { readonly lines: readonly Line[]; readonly totalRwf: number }, promoRwf: number) {
  const promo = Math.max(0, promoRwf);
  const paid = receipt.totalRwf - promo;
  return {
    lines: promo > 0 ? [...receipt.lines, { label: "Promo", amountRwf: -promo }] : receipt.lines,
    totalRwf: paid,
    grossRwf: receipt.totalRwf,
    promoRwf: promo,
    paidRwf: paid,
  };
}
