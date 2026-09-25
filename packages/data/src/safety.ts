import type { GeraClient } from "./client";

export interface DriverPosition {
  readonly lng: number;
  readonly lat: number;
  readonly recordedAt: string;
  readonly metresAway: number;
  readonly etaSeconds: number;
}

/**
 * Where the driver is now, and roughly how long until they reach whichever end
 * of the trip they are heading for. Null before the first fix arrives, which is
 * an ordinary state and not an error.
 */
export async function getDriverPosition(
  client: GeraClient,
  tripId: string,
): Promise<DriverPosition | null> {
  const { data, error } = await client.rpc("trip_driver_position", { p_trip_id: tripId });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as {
    lng: number;
    lat: number;
    recorded_at: string;
    metres_away: number;
    eta_seconds: number;
  }[];
  const r = rows[0];
  if (!r) return null;

  return {
    lng: Number(r.lng),
    lat: Number(r.lat),
    recordedAt: r.recorded_at,
    metresAway: Number(r.metres_away),
    etaSeconds: Number(r.eta_seconds),
  };
}

/** The driver's own position, published while a trip is live. */
export async function publishTrackPoint(
  client: GeraClient,
  tripId: string,
  at: { lng: number; lat: number },
  accuracyM?: number,
): Promise<void> {
  const { error } = await client.rpc("publish_track_point", {
    p_trip_id: tripId,
    p_lng: at.lng,
    p_lat: at.lat,
    p_accuracy_m: accuracyM ?? null,
  });
  if (error) throw new Error(error.message);
}

/**
 * Raise a safety alert.
 *
 * Every argument is optional on purpose: somebody in trouble should not be
 * filling in a form, and an alert with only a user id on it is still worth far
 * more than no alert.
 */
export async function raiseSos(
  client: GeraClient,
  args: {
    readonly tripId?: string;
    readonly at?: { lng: number; lat: number };
    readonly note?: string;
  } = {},
): Promise<string> {
  const { data, error } = await client.rpc("raise_sos", {
    p_trip_id: args.tripId ?? null,
    p_lng: args.at?.lng ?? null,
    p_lat: args.at?.lat ?? null,
    p_note: args.note ?? null,
  });
  if (error) throw new Error(error.message);
  return String(data);
}

/** Rwanda's emergency number. One tap away from the SOS sheet. */
export const EMERGENCY_NUMBER = "112";

/**
 * A plain-text message a rider can send to someone who should know where they
 * are. Not a link: there is no public trip-status page to link to, and a URL
 * that 404s is worse than the facts written out.
 */
export function shareTripText(args: {
  readonly pickupLabel: string;
  readonly dropoffLabel: string;
  readonly driverName?: string | null;
  readonly plate?: string | null;
  readonly etaSeconds?: number | null;
}): string {
  const lines = [
    `I'm taking a Gera ride from ${args.pickupLabel} to ${args.dropoffLabel}.`,
  ];
  if (args.driverName) {
    lines.push(
      args.plate
        ? `My driver is ${args.driverName}, plate ${args.plate}.`
        : `My driver is ${args.driverName}.`,
    );
  }
  if (typeof args.etaSeconds === "number" && args.etaSeconds > 0) {
    lines.push(`About ${Math.max(1, Math.round(args.etaSeconds / 60))} min away.`);
  }
  return lines.join("\n");
}

/** "about 4 min", floored at one so nothing ever reads "about 0 min". */
export function etaLabel(seconds: number | null | undefined): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "—";
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}
