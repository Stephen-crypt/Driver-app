import { dataError, type NovaClient } from "./client";

// Promo codes (0064-0067). A passenger adds a code once; each quote then
// carries the saved code that saves them most, unless they choose another or
// turn promos off for that ride. Nova pays the difference.

export type PromoKind = "amount" | "percent";
export type PromoStatus = "ready" | "used" | "used_up" | "ended" | "paused" | "not_started";

export interface PromoDiscount {
  readonly kind: PromoKind;
  readonly amountRwf: number | null;
  readonly percent: number | null;
  readonly maxDiscountRwf: number | null;
}

export interface SavedPromo extends PromoDiscount {
  readonly id: string;
  readonly code: string;
  readonly endsAt: string | null;
  readonly usesLeft: number;
}

export interface MyPromo extends SavedPromo {
  readonly minFareRwf: number | null;
  readonly vehicleClasses: readonly string[] | null;
  readonly status: PromoStatus;
}

export type AddPromoResult =
  | { readonly ok: true; readonly already: boolean; readonly promo: SavedPromo }
  | { readonly ok: false; readonly message: string };

const n = (v: number) => v.toLocaleString("en-US");

/** "500 RWF off", "30% off", "30% off, up to 1,000 RWF". */
export function promoLabel(p: PromoDiscount): string {
  if (p.kind === "amount") return `${n(p.amountRwf ?? 0)} RWF off`;
  return p.maxDiscountRwf ? `${p.percent}% off, up to ${n(p.maxDiscountRwf)} RWF` : `${p.percent}% off`;
}

const CLASS_NAME: Record<string, string> = { moto: "Moto", cab: "Cab", cab_xl: "Cab XL" };

/** Why a saved code does not fit this ride - "Moto only" - or null when it does. */
export function promoMisfit(
  p: Pick<MyPromo, "vehicleClasses" | "minFareRwf">,
  vehicleClass: string,
  fareRwf: number,
): string | null {
  if (p.vehicleClasses && !p.vehicleClasses.includes(vehicleClass)) {
    return `${p.vehicleClasses.map((k) => CLASS_NAME[k] ?? k).join(" and ")} only`;
  }
  if (p.minFareRwf && fareRwf < p.minFareRwf) return `For rides from ${n(p.minFareRwf)} RWF`;
  return null;
}

const WHY_NOT: Record<string, string> = {
  not_found: "That code isn't right. Check it and try again.",
  ended: "That code has ended.",
  used_up: "That code has been used up.",
  already_used: "You've already used that code.",
  paused: "That code isn't active right now.",
  not_started: "That code isn't active yet.",
  too_many_tries: "Too many tries. Wait an hour and try again.",
};

interface PromoRow {
  promo_id: string;
  code: string;
  kind: PromoKind;
  amount_rwf: number | null;
  percent: number | null;
  max_discount_rwf: number | null;
  ends_at: string | null;
  uses_left: number;
}

const saved = (r: PromoRow): SavedPromo => ({
  id: r.promo_id,
  code: r.code,
  kind: r.kind,
  amountRwf: r.amount_rwf,
  percent: r.percent,
  maxDiscountRwf: r.max_discount_rwf,
  endsAt: r.ends_at,
  usesLeft: r.uses_left,
});

/** Saves a code to the signed-in passenger. Wrong codes count toward a lock-out. */
export async function addPromoCode(client: NovaClient, code: string): Promise<AddPromoResult> {
  const typed = code.trim();
  if (!typed) return { ok: false, message: "Type a code first." };
  const { data, error } = await client.rpc("add_promo_code", { p_code: typed });
  if (error) throw dataError(error.message);
  const row = ((data ?? []) as (PromoRow & { result: string })[])[0];
  if (!row) return { ok: false, message: WHY_NOT.not_found! };
  if (row.result === "added" || row.result === "already_added") {
    return { ok: true, already: row.result === "already_added", promo: saved(row) };
  }
  return { ok: false, message: WHY_NOT[row.result] ?? WHY_NOT.not_found! };
}

/** The passenger's saved codes, newest first. */
export async function listMyPromos(client: NovaClient): Promise<MyPromo[]> {
  const { data, error } = await client.rpc("my_promos");
  if (error) throw dataError(error.message);
  return ((data ?? []) as (PromoRow & {
    min_fare_rwf: number | null;
    vehicle_classes: string[] | null;
    status: PromoStatus;
  })[]).map((r) => ({
    ...saved(r),
    minFareRwf: r.min_fare_rwf,
    vehicleClasses: r.vehicle_classes,
    status: r.status,
  }));
}

/** What the ride sheet says when a booking is refused because its code ran out. */
export const PROMO_RAN_OUT = "That promo code has just run out. The prices are updated without it.";

/** A booking refused because the code ran out between the quote and the booking. */
export function isPromoUnavailable(e: unknown): boolean {
  return e instanceof Error && /promo_unavailable/.test(e.message);
}
