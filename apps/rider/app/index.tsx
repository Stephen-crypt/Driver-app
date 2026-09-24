import { useEffect, useState } from "react";
import { View, Text, ActivityIndicator, StyleSheet } from "react-native";
import { Redirect } from "expo-router";
import { lightTheme, tokens } from "@gera/ui";
import { supabase } from "../src/lib/supabase";

export default function Home() {
  // null while the stored session is still being read off disk. Rendering the
  // redirect before that resolves would bounce a signed-in rider back through
  // onboarding on every cold start.
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (active) setSignedIn(data.session !== null);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setSignedIn(session !== null);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  if (signedIn === null) {
    return (
      <View style={styles.root}>
        <ActivityIndicator color={lightTheme.accent} size="large" />
      </View>
    );
  }

  if (!signedIn) return <Redirect href="/onboarding/phone" />;

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Gera</Text>
      <Text style={styles.sub}>Map and booking sheet arrive in Phase 2.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: lightTheme.surface,
    alignItems: "center",
    justifyContent: "center",
    padding: tokens.space.lg,
  },
  title: {
    fontSize: tokens.type.display.size,
    fontWeight: "700",
    color: lightTheme.textStrong,
  },
  sub: { fontSize: tokens.type.body.size, color: lightTheme.textMuted, marginTop: tokens.space.sm },
});
