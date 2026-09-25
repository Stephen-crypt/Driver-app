import * as Location from "expo-location";

export interface Coords {
  readonly lat: number;
  readonly lng: number;
}

/**
 * Kimironko Market. Used only until the first real fix arrives, so the map has
 * somewhere to sit - never written to presence, because a rider reported at a
 * place they are not is worse than a rider who is not reported at all.
 */
export const KIGALI_FALLBACK: Coords = { lat: -1.9403, lng: 30.1128 };

export async function requestPermission(): Promise<boolean> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === "granted";
}

/**
 * A position, or null - never a wait. A first fix indoors can take tens of
 * seconds, and starting a shift, ending one, or filing a report must not hang
 * on it: the position is useful context on those records, not a precondition.
 * The last known fix answers instantly and is minutes fresh at worst.
 */
export async function getCurrent(timeoutMs = 5000): Promise<Coords | null> {
  try {
    const known = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000 });
    if (known) return { lat: known.coords.latitude, lng: known.coords.longitude };
  } catch {
    // Fall through to a fresh fix.
  }
  try {
    const p = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    return p ? { lat: p.coords.latitude, lng: p.coords.longitude } : null;
  } catch {
    return null;
  }
}

/**
 * Streams position while the rider is online. Balanced accuracy and a 10-metre
 * filter on purpose: dispatch matches within a 1-4km radius, so metre-perfect
 * fixes buy nothing and cost battery on a phone that is already running a map
 * all day.
 */
export function watch(
  onMove: (c: Coords) => void,
): Promise<Location.LocationSubscription> {
  return Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 5000,
      distanceInterval: 10,
    },
    (p) => onMove({ lat: p.coords.latitude, lng: p.coords.longitude }),
  );
}
