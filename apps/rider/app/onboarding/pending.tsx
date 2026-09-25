import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Button, Txt, c as theme, space } from "@gera/kit";
import { tokens } from "@gera/ui";
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
        <Txt v="title" align="center">Something needs fixing</Txt>
        <Txt v="body" tone="muted" align="center" style={styles.body}>
          One or more of your documents was not accepted. Each one says why.
        </Txt>
        <View style={styles.cta}>
          <Button label="See my documents" onPress={() => router.replace("/onboarding/documents")} />
        </View>
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
      <Txt v="title" align="center">We're checking your documents</Txt>
      <Txt v="body" tone="muted" align="center" style={styles.body}>
        This usually takes a few hours. This screen moves on by itself the moment
        you're approved.
      </Txt>

      <Pressable
        style={styles.ghost}
        onPress={() => void check()}
        disabled={checking}
        accessibilityRole="button"
      >
        {checking ? (
          <ActivityIndicator color={theme.accent} />
        ) : (
          <Txt v="bodyStrong" tone="accent">Check now</Txt>
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
  body: { marginTop: space.sm },
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
  cta: { marginTop: tokens.space.xl, alignSelf: "stretch" },
});
