import * as Location from "expo-location";

export interface Coords {
  readonly lat: number;
  readonly lng: number;
}

/**
 * Kimironko Market. Used only until the first real fix arrives, so the map has
 * somewhere to sit - never written to presence, because a driver reported at a
 * place they are not is worse than a driver who is not reported at all.
 */
export const KIGALI_FALLBACK: Coords = { lat: -1.9403, lng: 30.1128 };

export async function requestPermission(): Promise<boolean> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === "granted";
}

export async function getCurrent(): Promise<Coords | null> {
  try {
    const p = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return { lat: p.coords.latitude, lng: p.coords.longitude };
  } catch {
    return null;
  }
}

/**
 * Streams position while the driver is online. Balanced accuracy and a 10-metre
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
