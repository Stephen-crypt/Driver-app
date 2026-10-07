import { useEffect, useRef, useState } from "react";
import { alongRoad, metresBetween, pathLengthM, type RoadPoint } from "@nova/ui";

/** Asks the router for the road between two points; null when it cannot. */
export type RoadFetch = (
  from: RoadPoint,
  to: RoadPoint,
) => Promise<{ readonly path: readonly RoadPoint[]; readonly durationS: number } | null>;

export interface LiveRoad {
  /** The road still ahead, from the rider to where they are going. */
  readonly path: RoadPoint[];
  /** The router's time for what is left of it. */
  readonly remainingS: number;
}

// Further off the road than this, the rider has taken another way.
const OFF_ROAD_M = 150;
// Every ask spends from the router's daily allowance, so never more often.
const MIN_GAP_MS = 20_000;

/**
 * The road from someone moving to where they are going, kept current while
 * they travel. The line shortens behind them without asking again; the router
 * is asked only when the destination changes or they leave the road.
 */
export function useRoad(at: RoadPoint | null, to: RoadPoint | null, fetchRoad: RoadFetch): LiveRoad | null {
  const [road, setRoad] = useState<{ to: RoadPoint; path: readonly RoadPoint[]; durationS: number; lengthM: number } | null>(null);
  const [askAgain, setAskAgain] = useState(0);
  const lastAsk = useRef(0);
  const atNow = useRef(at);
  atNow.current = at;
  const fetchNow = useRef(fetchRoad);
  fetchNow.current = fetchRoad;
  const hasAt = at !== null;

  useEffect(() => {
    const from = atNow.current;
    if (!from || !to) {
      setRoad(null);
      return;
    }
    let active = true;
    lastAsk.current = Date.now();
    fetchNow
      .current(from, to)
      .then((r) => {
        if (!active) return;
        setRoad(r && r.path.length > 1 ? { to, path: r.path, durationS: r.durationS, lengthM: Math.max(1, pathLengthM(r.path)) } : null);
      })
      .catch(() => active && setRoad(null));
    return () => {
      active = false;
    };
  }, [to?.lat, to?.lng, hasAt, askAgain]); // eslint-disable-line react-hooks/exhaustive-deps

  // A road to somewhere else is not this road.
  const current = road && to && metresBetween(road.to, to) < 30 ? road : null;
  const view = current && at ? alongRoad(current.path, at) : null;
  const offRoad = view !== null && view.offRoadM > OFF_ROAD_M;

  useEffect(() => {
    if (!offRoad) return;
    const wait = Math.max(0, MIN_GAP_MS - (Date.now() - lastAsk.current));
    const id = setTimeout(() => setAskAgain((n) => n + 1), wait);
    return () => clearTimeout(id);
  }, [offRoad]);

  if (!current || !view) return null;
  return {
    path: view.remaining,
    remainingS: Math.round((current.durationS * view.remainingM) / current.lengthM),
  };
}
