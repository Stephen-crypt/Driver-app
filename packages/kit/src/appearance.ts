import { Appearance as Device, Platform } from "react-native";
import { reloadAppAsync } from "expo";
import { File, Paths } from "expo-file-system";
import { parseAppearance, resolveScheme, type Appearance, type Scheme } from "@nova/ui";

export type { Appearance, Scheme };

// The theme is chosen once, here, as this module loads - before any screen's
// styles are built. So the choice has to be readable synchronously: a one-line
// file on the phone, localStorage on the web. Changing it restarts the app.
const KEY = "nova.appearance";
const FILE = "appearance.txt";

const prefFile = () => new File(Paths.document, FILE);

export function readAppearance(): Appearance {
  try {
    if (Platform.OS === "web") return parseAppearance(globalThis.localStorage?.getItem(KEY));
    const f = prefFile();
    return parseAppearance(f.exists ? f.textSync() : null);
  } catch {
    // An unreadable preference is no preference: follow the device.
    return "system";
  }
}

export function writeAppearance(a: Appearance): void {
  if (Platform.OS === "web") {
    globalThis.localStorage?.setItem(KEY, a);
    return;
  }
  const f = prefFile();
  if (!f.exists) f.create();
  f.write(a);
}

/** What was saved, and what this run of the app draws. */
export const appearance: Appearance = readAppearance();
export const scheme: Scheme = resolveScheme(appearance, Device.getColorScheme());

/** Saves the choice and restarts the app so every screen is rebuilt in it. */
export async function setAppearance(a: Appearance): Promise<void> {
  writeAppearance(a);
  await reloadAppAsync("appearance");
}
