import type { GeraClient } from "./client";
import { dataError } from "./client";

export type LedgerKind =
  | "fare_collected"
  | "trip_earning"
  | "cash_remittance"
  | "payout"
  | "bonus"
  | "deduction"
  | string;

export interface LedgerRow {
  readonly id: number;
  readonly kind: LedgerKind;
  readonly amountRwf: number;
  readonly memo: string | null;
  readonly tripId: string | null;
  readonly createdAt: string;
}

export async function listLedger(
  client: GeraClient,
  riderId: string,
  since: Date,
): Promise<LedgerRow[]> {
  const { data, error } = await client
    .from("ledger_entries")
    .select("id, kind, amount_rwf, memo, trip_id, created_at")
    .eq("rider_id", riderId)
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false });
  if (error) throw dataError(error.message);
  return ((data ?? []) as {
    id: number;
    kind: string;
    amount_rwf: number;
    memo: string | null;
    trip_id: string | null;
    created_at: string;
  }[]).map((r) => ({
    id: r.id,
    kind: r.kind,
    amountRwf: r.amount_rwf,
    memo: r.memo,
    tripId: r.trip_id,
    createdAt: r.created_at,
  }));
}

export interface DayEarnings {
  /** Local midnight of the day. */
  readonly day: Date;
  readonly earnedRwf: number;
  readonly trips: number;
}

/**
 * The last `days` days, oldest first, every day present even when empty. A
 * chart with gaps where the rider did not work reads as missing data; a zero
 * bar reads as a day off, which is what it was.
 *
 * Earned means trip earnings plus bonuses minus deductions: what the rider is
 * owed for the day's work. Cash collected and remitted is a different number
 * and is never mixed in here.
 */
export function dailyEarnings(rows: readonly LedgerRow[], days: number, now = new Date()): DayEarnings[] {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));

  const buckets = Array.from({ length: days }, (_, i) => {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    return { day, earnedRwf: 0, trips: new Set<string>() };
  });

  for (const row of rows) {
    const at = new Date(row.createdAt);
    const d = new Date(at);
    d.setHours(0, 0, 0, 0);
    const index = Math.round((d.getTime() - start.getTime()) / 86_400_000);
    const bucket = buckets[index];
    if (!bucket) continue;

    if (row.kind === "trip_earning" || row.kind === "bonus") bucket.earnedRwf += row.amountRwf;
    else if (row.kind === "deduction") bucket.earnedRwf -= row.amountRwf;
    if (row.kind === "trip_earning" && row.tripId) bucket.trips.add(row.tripId);
  }

  return buckets.map((b) => ({ day: b.day, earnedRwf: b.earnedRwf, trips: b.trips.size }));
}

/** How a ledger row reads to the rider, and which way it moves their money. */
export function describeLedgerRow(row: LedgerRow): {
  readonly title: string;
  readonly affects: "cash" | "owed";
  readonly sign: 1 | -1;
} {
  switch (row.kind) {
    case "fare_collected":
      return { title: "Fare collected", affects: "cash", sign: 1 };
    case "cash_remittance":
      return { title: "Cash handed in", affects: "cash", sign: -1 };
    case "trip_earning":
      return { title: "Trip earning", affects: "owed", sign: 1 };
    case "bonus":
      return { title: "Bonus", affects: "owed", sign: 1 };
    case "deduction":
      return { title: "Deduction", affects: "owed", sign: -1 };
    case "payout":
      return { title: "Paid to you", affects: "owed", sign: -1 };
    default:
      return { title: "Adjustment", affects: "owed", sign: 1 };
  }
}

export interface RiderProfile {
  readonly firstName: string;
  readonly phone: string | null;
  readonly verification: string | null;
  readonly vehicle: {
    readonly vehicleClass: string;
    readonly plate: string;
    readonly vestNumber: string | null;
  } | null;
  /** Average of all ratings, one decimal. Null until the first rating. */
  readonly rating: number | null;
  readonly ratingCount: number;
}

export async function getRiderProfile(client: GeraClient, riderId: string): Promise<RiderProfile> {
  const [profile, rider, vehicle] = await Promise.all([
    client.from("profiles").select("first_name, phone").eq("id", riderId).maybeSingle(),
    client
      .from("riders")
      .select("verification, rating_sum, rating_count")
      .eq("id", riderId)
      .maybeSingle(),
    client
      .from("vehicles")
      .select("class, plate, vest_number")
      .eq("rider_id", riderId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const p = profile.data as { first_name?: string; phone?: string } | null;
  const r = rider.data as { verification?: string; rating_sum?: number; rating_count?: number } | null;
  const v = vehicle.data as { class: string; plate: string; vest_number: string | null } | null;

  const count = r?.rating_count ?? 0;
  return {
    firstName: p?.first_name ?? "Rider",
    phone: p?.phone ?? null,
    verification: r?.verification ?? null,
    vehicle: v ? { vehicleClass: v.class, plate: v.plate, vestNumber: v.vest_number } : null,
    rating: count > 0 ? Math.round(((r?.rating_sum ?? 0) / count) * 10) / 10 : null,
    ratingCount: count,
  };
}
