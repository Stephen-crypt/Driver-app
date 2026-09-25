import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants, { ExecutionEnvironment } from "expo-constants";

// Notifications that arrive while the app is open should still be seen: a
// rider watching the map is exactly who needs to know their driver arrived.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export type PushResult =
  | { readonly ok: true; readonly token: string }
  | {
      readonly ok: false;
      readonly reason: "expo_go" | "simulator" | "denied" | "no_project" | "error";
    };

/**
 * Registers this install for push and returns the Expo token.
 *
 * Every failure is a named reason rather than a throw, because none of them
 * should stop the app: a driver with no push still sees offers while the app is
 * open - they just cannot leave it in their pocket.
 */
export async function registerForPush(): Promise<PushResult> {
  // Expo Go on Android dropped remote push in SDK 53. Nothing in this function
  // can work around that - it needs a development build (npx expo run:android,
  // or an EAS build). Detected first so the reason is the real one rather than
  // a downstream token error that looks like a bug in our code.
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    return { ok: false, reason: "expo_go" };
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

  try {
    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    return { ok: true, token: token.data };
  } catch {
    return { ok: false, reason: "error" };
  }
}
