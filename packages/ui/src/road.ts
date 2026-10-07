/**
 * Geometry for a road drawn on the map while a rider travels it: how much of
 * it is left, and whether the rider has left it. Pure numbers, so both apps
 * share it and it is tested without a map.
 *
 * Distances use a flat projection around each point - wrong by centimetres
 * across a city, and a hundred times cheaper than great circles on a path of
 * three hundred points re-read every few seconds.
 */

export interface RoadPoint {
  readonly lat: number;
  readonly lng: number;
}

const M_PER_DEG = 111_320;

/** Metres between two points, flat-earth; good to a few centimetres inside Kigali. */
export function metresBetween(a: RoadPoint, b: RoadPoint): number {
  const x = (b.lng - a.lng) * M_PER_DEG * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  const y = (b.lat - a.lat) * M_PER_DEG;
  return Math.sqrt(x * x + y * y);
}

/** Length of a path in metres. */
export function pathLengthM(path: readonly RoadPoint[]): number {
  let m = 0;
  for (let i = 1; i < path.length; i++) m += metresBetween(path[i - 1]!, path[i]!);
  return m;
}

export interface AlongRoad {
  /** The road still ahead, starting at the point on it nearest the rider. */
  readonly remaining: RoadPoint[];
  readonly remainingM: number;
  /** How far the rider is from the road: large means they took another way. */
  readonly offRoadM: number;
}

/** Where `at` is along `path`, and what is left of it. */
export function alongRoad(path: readonly RoadPoint[], at: RoadPoint): AlongRoad {
  if (path.length === 0) return { remaining: [], remainingM: 0, offRoadM: Infinity };
  if (path.length === 1) return { remaining: [path[0]!], remainingM: 0, offRoadM: metresBetween(path[0]!, at) };

  // Work in metres around the rider, so a segment is a plain 2-D line.
  const kx = M_PER_DEG * Math.cos(at.lat * (Math.PI / 180));
  const ky = M_PER_DEG;
  let best = { d2: Infinity, i: 0, t: 0 };
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const ax = (a.lng - at.lng) * kx;
    const ay = (a.lat - at.lat) * ky;
    const dx = (b.lng - a.lng) * kx;
    const dy = (b.lat - a.lat) * ky;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    const px = ax + t * dx;
    const py = ay + t * dy;
    const d2 = px * px + py * py;
    if (d2 < best.d2) best = { d2, i, t };
  }

  const a = path[best.i]!;
  const b = path[best.i + 1]!;
  const onRoad = { lat: a.lat + (b.lat - a.lat) * best.t, lng: a.lng + (b.lng - a.lng) * best.t };
  const rest = path.slice(best.i + 1);
  const remaining = [onRoad, ...rest];
  return { remaining, remainingM: pathLengthM(remaining), offRoadM: Math.sqrt(best.d2) };
}
