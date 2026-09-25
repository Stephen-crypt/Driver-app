import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme, tokens } from "@gera/ui";
import { supabase } from "../../src/lib/supabase";

type Verification = "submitted" | "verified" | "rejected" | string;

/** How often to re-read while waiting. Cheap: one row, the rider's own. */
const POLL_MS = 5000;

export default function PendingScreen() {
  const router = useRouter();
  const [status, setStatus] = useState<Verification | null>(null);
  const [checking, setChecking] = useState(false);

  // This screen used to be two paragraphs and nothing else. It never looked at
  // the rider's status, so an approved rider sat here until they thought to
  // kill the app - and nothing told them that was the way out.
  const check = useCallback(async () => {
    setChecking(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const id = auth.user?.id;
      if (!id) return;
      const { data } = await supabase
        .from("riders")
        .select("verification")
        .eq("id", id)
        .maybeSingle();
      const v = (data as { verification?: Verification } | null)?.verification ?? null;
      setStatus(v);
      if (v === "verified") router.replace("/");
    } catch {
      // A failed read is not a verdict. Keep waiting; the next poll will try.
    } finally {
      setChecking(false);
    }
  }, [router]);

  useEffect(() => {
    void check();
    const timer = setInterval(() => void check(), POLL_MS);
    return () => clearInterval(timer);
  }, [check]);

  if (status === "rejected") {
    return (
      <View style={styles.root}>
        <View style={[styles.well, styles.wellBad]}>
          <Ionicons name="alert-circle-outline" size={32} color={theme.danger} />
        </View>
        <Text style={styles.title}>Something needs fixing</Text>
        <Text style={styles.body}>
          One or more of your documents was not accepted. Each one says why.
        </Text>
        <Pressable
          style={styles.cta}
          onPress={() => router.replace("/onboarding/documents")}
          accessibilityRole="button"
        >
          <Text style={styles.ctaText}>See my documents</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* A rider lands here and then waits, possibly for hours. A screen of two
          grey paragraphs reads as a dead end; the mark gives it a state. */}
      <View style={styles.well}>
        <Ionicons name="hourglass-outline" size={32} color={theme.accent} />
      </View>
      <Text style={styles.title}>We're checking your documents</Text>
      <Text style={styles.body}>
        This usually takes a few hours. This screen moves on by itself the moment
        you're approved.
      </Text>

      <Pressable
        style={styles.ghost}
        onPress={() => void check()}
        disabled={checking}
        accessibilityRole="button"
      >
        {checking ? (
          <ActivityIndicator color={theme.accent} />
        ) : (
          <Text style={styles.ghostText}>Check now</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1, backgroundColor: theme.surface,
    alignItems: "center", justifyContent: "center", padding: tokens.space.lg,
  },
  well: {
    width: 76, height: 76, borderRadius: 38,
    backgroundColor: theme.accentSoft,
    alignItems: "center", justifyContent: "center",
    marginBottom: tokens.space.lg,
  },
  wellBad: { backgroundColor: theme.dangerSoft },
  title: {
    fontSize: tokens.type.title.size, fontWeight: "700",
    color: theme.textStrong, textAlign: "center",
  },
  body: {
    fontSize: tokens.type.body.size, color: theme.textMuted,
    textAlign: "center", marginTop: tokens.space.md, lineHeight: tokens.type.body.leading,
  },
  ghost: {
    marginTop: tokens.space.lg,
    minHeight: tokens.MIN_TOUCH_TARGET,
    minWidth: 140,
    paddingHorizontal: tokens.space.lg,
    borderRadius: tokens.radius.pill,
    backgroundColor: theme.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  ghostText: { fontSize: tokens.type.body.size, fontWeight: "700", color: theme.accent },
  cta: {
    marginTop: tokens.space.xl,
    alignSelf: "stretch",
    minHeight: tokens.MIN_TOUCH_TARGET + 8,
    borderRadius: tokens.radius.pill,
    backgroundColor: theme.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: { fontSize: tokens.type.body.size + 1, fontWeight: "700", color: theme.onAccent },
});
