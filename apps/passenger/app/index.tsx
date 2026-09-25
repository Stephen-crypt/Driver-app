import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme, tokens } from "@gera/ui";
import { registerDeviceToken } from "@gera/data";
import { supabase } from "../src/lib/supabase";
import { registerForPush } from "../src/lib/push";
import { TripMap } from "../src/components/TripMap";
import { Sheet } from "../src/components/Sheet";

// Kimironko Market. Real GPS pickup arrives with background location; until
// then every trip starts here, which is honest rather than silently wrong.
const KIGALI = { lat: -1.9403, lng: 30.1128 };

export default function Home() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setSignedIn(Boolean(data.session));
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setSignedIn(Boolean(session));
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Register for push once signed in. Every failure is silent on purpose: a
  // passenger without push still has a working booking screen, and an alert about
  // notification plumbing on first launch is noise they cannot act on.
  useEffect(() => {
    if (!signedIn) return;
    let active = true;
    (async () => {
      const result = await registerForPush();
      if (!active || !result.ok) return;
      const { data } = await supabase.auth.getUser();
      if (!active || !data.user) return;
      try {
        await registerDeviceToken(supabase, data.user.id, result.token, "android");
      } catch {
        // Not worth interrupting the passenger over.
      }
    })();
    return () => {
      active = false;
    };
  }, [signedIn]);

  if (signedIn === null) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  if (!signedIn) return <Redirect href="/welcome" />;

  return (
    <View style={styles.root}>
      <TripMap
        center={KIGALI}
        markers={[{ id: "me", at: KIGALI, label: "You are near here", kind: "pickup" }]}
      />

      <Pressable
        style={[styles.accountButton, { top: insets.top + tokens.space.sm }]}
        onPress={() => router.push("/account")}
        accessibilityRole="button"
        accessibilityLabel="Your account"
      >
        <Ionicons name="person-circle-outline" size={26} color={theme.textStrong} />
      </Pressable>

      <Sheet state="idle">
        <Pressable
          style={styles.search}
          onPress={() => router.push("/destination")}
          accessibilityRole="button"
          accessibilityLabel="Choose where you are going"
        >
          <Ionicons name="search" size={20} color={theme.accent} />
          <Text style={styles.searchText}>Where to?</Text>
          <Ionicons name="arrow-forward" size={18} color={theme.textMuted} />
        </Pressable>
        <Text style={styles.hint}>Search a landmark, or drop a pin on the map.</Text>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.surface },
  centre: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.surface,
  },
  // A filled field rather than an outlined one. The outline was the only
  // 2pt accent border on the screen and it pulled the eye away from the map,
  // which is the thing the passenger is actually reading.
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    minHeight: tokens.MIN_TOUCH_TARGET + 4,
    paddingHorizontal: tokens.space.md,
    borderRadius: tokens.radius.pill,
    backgroundColor: theme.surfaceHigh,
  },
  searchText: {
    flex: 1,
    fontSize: tokens.type.body.size + 2,
    fontWeight: "700",
    color: theme.textStrong,
  },
  hint: {
    marginTop: tokens.space.md,
    fontSize: tokens.type.body.size,
    color: theme.textMuted,
  },
  // Top comes from the inset at the call site: the status bar is not a fixed
  // height across Android devices, and the guessed 48 put this under the clock
  // on a tall phone.
  accountButton: {
    position: "absolute",
    left: tokens.space.lg,
    width: tokens.MIN_TOUCH_TARGET,
    height: tokens.MIN_TOUCH_TARGET,
    borderRadius: tokens.radius.pill,
    backgroundColor: theme.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },

});
