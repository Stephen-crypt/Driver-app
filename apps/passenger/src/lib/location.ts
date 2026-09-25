import * as Location from "expo-location";

export interface Coords {
  readonly lat: number;
  readonly lng: number;
}

/**
 * Kimironko Market, used only until the first real fix arrives so the map has
 * somewhere to sit. Never used as a pickup: a rider sent to where the
 * passenger is not is worse than a passenger asked to wait a second for GPS.
 */
export const KIGALI_FALLBACK: Coords = { lat: -1.9403, lng: 30.1128 };

export async function requestPermission(): Promise<boolean> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    return status === "granted";
  } catch {
    return false;
  }
}

/** A position, or null - never a wait. See the rider app's copy for why. */
export async function getCurrent(timeoutMs = 5000): Promise<Coords | null> {
  try {
    const known = await Location.getLastKnownPositionAsync({ maxAge: 2 * 60_000 });
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
