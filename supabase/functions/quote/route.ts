// What a quote is priced on. The app sends the road distance and time it got
// from the route function, but the app is not the authority on price: the
// server takes the pickup and drop-off and never prices less than the ride
// could possibly be.

export interface Point {
  readonly lat: number;
  readonly lng: number;
}

/** Roads are never straighter than this against the crow's flight. */
export const ROAD_FACTOR = 1.2;
/** Faster than anything moves across Kigali, so a floor, not an estimate. */
export const FASTEST_MPS = 45_000 / 3600;
/** Longer than any ride Gera offers. */
export const MAX_DISTANCE_M = 150_000;

// Rwanda, with a margin for pickups right on the border.
const AREA = { minLat: -2.9, maxLat: -1.0, minLng: 28.8, maxLng: 31.0 };

export function isPoint(p: unknown): p is Point {
  const q = p as Point | null;
  return (
    !!q &&
    typeof q.lat === "number" &&
    typeof q.lng === "number" &&
    Number.isFinite(q.lat) &&
    Number.isFinite(q.lng)
  );
}

export function inServiceArea(p: Point): boolean {
  return p.lat >= AREA.minLat && p.lat <= AREA.maxLat && p.lng >= AREA.minLng && p.lng <= AREA.maxLng;
}

export function straightLineM(a: Point, b: Point): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * The distance and time to price. The app's figures count when they are
 * plausible; anything shorter than the straight line allows is raised to it.
 */
export function pricedRoute(
  pickup: Point,
  dropoff: Point,
  claimed: { distanceM?: unknown; durationS?: unknown },
): { distanceM: number; durationS: number } {
  const floorM = straightLineM(pickup, dropoff) * ROAD_FACTOR;
  const claimedM = typeof claimed.distanceM === "number" && Number.isFinite(claimed.distanceM) ? claimed.distanceM : 0;
  const distanceM = Math.round(Math.max(floorM, claimedM));
  const claimedS = typeof claimed.durationS === "number" && Number.isFinite(claimed.durationS) ? claimed.durationS : 0;
  const durationS = Math.round(Math.max(distanceM / FASTEST_MPS, claimedS));
  return { distanceM, durationS };
}
