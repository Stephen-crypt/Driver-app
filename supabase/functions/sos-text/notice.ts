// What an SOS text says and who it goes to. Pure, so it is tested offline;
// index.ts does the claiming and sending.

export interface Notice {
  readonly first_name: string | null;
  readonly source: "passenger" | "rider";
  readonly trip_id: string | null;
  readonly lng: number | null;
  readonly lat: number | null;
  readonly note: string | null;
  readonly created_at: string;
}

/**
 * The safety phones, from SOS_ALERT_PHONES: comma-separated, local or
 * international ("0790803794, +250788123456"). Anything that is not a
 * Rwandan-length number is dropped rather than texted.
 */
export function alertPhones(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((p) => p.replace(/[\s-]/g, ""))
    .map((p) => (p.startsWith("+") ? p : p.startsWith("250") ? `+${p}` : p.startsWith("0") ? `+250${p.slice(1)}` : p))
    .filter((p) => /^\+250\d{9}$/.test(p));
}

/** Kigali time as HH:MM. Rwanda has no daylight saving: always UTC+2. */
function kigaliTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 2 * 3600_000);
  return d.toISOString().slice(11, 16);
}

/**
 * Two segments at most: who, when, which trip, a map link that opens on any
 * phone, and their words. The link is a plain Google Maps search - no key,
 * and it opens in the Maps app every Kigali phone already has.
 */
export function sosText(n: Notice): string {
  const who = `${n.first_name ?? "Someone"} (${n.source === "rider" ? "rider" : "passenger"})`;
  const trip = n.trip_id ? `trip NV-${n.trip_id.slice(0, 6).toUpperCase()}` : "no trip";
  const where = n.lat !== null && n.lng !== null
    ? `https://maps.google.com/?q=${n.lat.toFixed(5)},${n.lng.toFixed(5)}`
    : "location not shared";
  const note = n.note?.trim() ? ` "${n.note.trim().slice(0, 80)}"` : "";
  return `NOVA SOS ${kigaliTime(n.created_at)}: ${who}, ${trip}. ${where}${note}. Open the control room.`;
}
