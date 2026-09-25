import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
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
        style={styles.accountButton}
        onPress={() => router.push("/account")}
        accessibilityRole="button"
        accessibilityLabel="Your account"
      >
        <Text style={styles.accountGlyph}>☰</Text>
      </Pressable>

      <Sheet state="idle">
        <Pressable
          style={styles.search}
          onPress={() => router.push("/destination")}
          accessibilityRole="button"
          accessibilityLabel="Choose where you are going"
        >
          <Text style={styles.searchText}>Where to?</Text>
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
  search: {
    minHeight: tokens.MIN_TOUCH_TARGET,
    justifyContent: "center",
    paddingHorizontal: tokens.space.md,
    borderRadius: tokens.radius.md,
    borderWidth: 2,
    borderColor: theme.accent,
    backgroundColor: theme.surface,
  },
  searchText: {
    fontSize: tokens.type.title.size,
    fontWeight: "700",
    color: theme.textStrong,
  },
  hint: {
    marginTop: tokens.space.md,
    fontSize: tokens.type.body.size,
    color: theme.textMuted,
  },
  accountButton: {
    position: "absolute",
    top: tokens.space.xxl,
    left: tokens.space.lg,
    width: tokens.MIN_TOUCH_TARGET,
    height: tokens.MIN_TOUCH_TARGET,
    borderRadius: tokens.radius.pill,
    backgroundColor: theme.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  accountGlyph: { fontSize: 20, color: theme.textStrong },
});
