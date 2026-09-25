/**
 * Geometry for the origin → destination stack: two dots joined by a vertical
 * rail, the pattern every ride app uses because it reads as a journey rather
 * than as two unrelated lines of text.
 *
 * Kept here as numbers rather than as a component so both apps share the exact
 * proportions without packages/ui taking on a React Native dependency.
 */
export const ROUTE_DOT = {
  size: 12,
  /** The rail joining the dots. Thin enough to read as a connector. */
  railWidth: 2,
  /** Vertical gap between the two rows. The rail spans this. */
  gap: 22,
} as const;

/** Where the rail starts and how tall it is, given the dot geometry. */
export function railGeometry(): { readonly top: number; readonly height: number } {
  return {
    top: ROUTE_DOT.size,
    height: ROUTE_DOT.gap,
  };
}

/**
 * Status words a passenger or rider actually reads, and which tone renders them.
 *
 * `tone` maps to a theme colour rather than a hex, so the status of a trip can
 * never be the one thing on screen that fails contrast.
 */
export type StatusTone = "success" | "danger" | "muted";

export function statusFor(state: string): { readonly label: string; readonly tone: StatusTone } {
  switch (state) {
    case "completed":
      return { label: "Completed", tone: "success" };
    case "cancelled_by_passenger":
      return { label: "You cancelled", tone: "danger" };
    case "cancelled_by_rider":
      return { label: "Rider cancelled", tone: "danger" };
    case "no_riders":
      return { label: "No riders found", tone: "danger" };
    case "expired":
      return { label: "Timed out", tone: "danger" };
    case "requested":
    case "offered":
      return { label: "Finding a rider", tone: "muted" };
    case "accepted":
      return { label: "Rider on the way", tone: "muted" };
    case "arrived":
      return { label: "Rider waiting", tone: "muted" };
    case "in_progress":
      return { label: "On the way", tone: "muted" };
    default:
      return { label: "In progress", tone: "muted" };
  }
}
