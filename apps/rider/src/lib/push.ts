import { Platform } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";

/**
 * expo-notifications is loaded LAZILY, and that is not a style choice.
 *
 * On Expo Go for Android, SDK 53 removed remote push, and the module throws the
 * moment it is imported - before any code of ours runs. A top-level
 * `import * as Notifications from "expo-notifications"` therefore took down the
 * whole screen that imported this file: the route failed to produce a default
 * export and the app died on an ErrorBoundary, with a push error as the only
 * clue. Detecting Expo Go inside registerForPush() was too late, because the
 * import had already thrown.
 *
 * `typeof import(...)` below is a type-only construct; it emits no runtime
 * import, so nothing is loaded until the require() actually runs.
 */
type NotificationsModule = typeof import("expo-notifications");
type DeviceModule = typeof import("expo-device");

/** Expo Go cannot do remote push on Android at all. Checked before any load. */
const IN_EXPO_GO = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

export type PushResult =
  | { readonly ok: true; readonly token: string }
  | {
      readonly ok: false;
      readonly reason: "expo_go" | "simulator" | "denied" | "no_project" | "error";
    };

let handlerSet = false;

/**
 * Registers this install for push and returns the Expo token.
 *
 * Every failure is a named reason rather than a throw, because none of them
 * should stop the app: a rider with no push still sees offers while the app is
 * open - they just cannot leave it in their pocket.
 */
export async function registerForPush(): Promise<PushResult> {
  if (IN_EXPO_GO) return { ok: false, reason: "expo_go" };

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Notifications = require("expo-notifications") as NotificationsModule;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Device = require("expo-device") as DeviceModule;

    // Notifications arriving while the app is open should still be seen: a
    // passenger watching the map is exactly who needs to know their rider arrived.
    if (!handlerSet) {
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
        }),
      });
      handlerSet = true;
    }

    // A simulator has no push transport at all; asking anyway produces a
    // confusing error rather than a useful one.
    if (!Device.isDevice) return { ok: false, reason: "simulator" };

    if (Platform.OS === "android") {
      // The channel must exist before the first notification lands, and the
      // importance is what lets a trip update make a sound on a locked phone.
      await Notifications.setNotificationChannelAsync("offers", {
        name: "Trip offers",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#F5A524",
        sound: "default",
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    let granted = existing.granted;
    if (!granted) {
      const asked = await Notifications.requestPermissionsAsync();
      granted = asked.granted;
    }
    if (!granted) return { ok: false, reason: "denied" };

    // SDK 53+ requires an EAS project id to mint a token. Until `eas init` has
    // been run there is no id, and that is a setup gap - not a bug to hide.
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      (Constants.easConfig as { projectId?: string } | undefined)?.projectId;

    if (!projectId) return { ok: false, reason: "no_project" };

    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    return { ok: true, token: token.data };
  } catch {
    return { ok: false, reason: "error" };
  }
}
