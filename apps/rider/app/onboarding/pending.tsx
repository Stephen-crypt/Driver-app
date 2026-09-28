import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Enter, HillScene, LiveDot, StepTrack, Txt, c, space, useOverlay } from "@gera/kit";
import { supabase } from "../../src/lib/supabase";
import { SIGNUP_STEPS } from "../../src/onboarding/steps";

type Verification = "submitted" | "verified" | "rejected" | string;

/** How often to re-read while waiting. Cheap: one row, the rider's own. */
const POLL_MS = 5000;

export default function PendingScreen() {
  const router = useRouter();
  const overlay = useOverlay();
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<Verification | null>(null);
  const [checking, setChecking] = useState(false);

  // This screen used to be two paragraphs and nothing else. It never looked at
  // the rider's status, so an approved rider sat here until they thought to
  // kill the app - and nothing told them that was the way out.
  const check = useCallback(
    async (byHand = false) => {
      // Only a check the rider asked for shows as busy; the background poll
      // would otherwise flicker the button every five seconds.
      if (byHand) setChecking(true);
      try {
        const { data: auth } = await supabase.auth.getUser();
        const id = auth.user?.id;
        if (!id) return;
        const { data } = await supabase.from("riders").select("verification").eq("id", id).maybeSingle();
        const v = (data as { verification?: Verification } | null)?.verification ?? null;
        setStatus(v);
        if (v === "verified") router.replace("/");
        else if (byHand && v !== "rejected") overlay.toast("Still being checked. We'll move on by ourselves.");
      } catch {
        // A failed read is not a verdict. Keep waiting; the next poll will try.
      } finally {
        if (byHand) setChecking(false);
      }
    },
    [router, overlay],
  );

  useEffect(() => {
    void check();
    const timer = setInterval(() => void check(), POLL_MS);
    return () => clearInterval(timer);
  }, [check]);

  const rejected = status === "rejected";

  return (
    <View style={[styles.root, { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.lg }]}>
      <StepTrack steps={SIGNUP_STEPS} current={rejected ? 3 : 4} />

      {/* A rider lands here and then waits, possibly for hours. A screen of two
          grey paragraphs reads as a dead end; the scene gives it a state. */}
      <View style={styles.middle}>
        <Enter i={0}>
          <HillScene icon={rejected ? "alert-circle" : "hourglass"} width={220} />
        </Enter>
        <Enter i={1}>
          <Txt v="title" align="center">
            {rejected ? "Something needs fixing" : "We're checking your documents"}
          </Txt>
        </Enter>
        <Enter i={2}>
          <Txt v="body" tone="muted" align="center">
            {rejected
              ? "One or more of your documents was not accepted. Each one says why, so you know what to send again."
              : "This usually takes a few hours. This screen moves on by itself the moment you're approved."}
          </Txt>
        </Enter>
        {!rejected ? (
          <Enter i={3} style={styles.live}>
            <LiveDot tone="accent" />
            <Txt v="caption" tone="muted">
              Checking every few seconds
            </Txt>
          </Enter>
        ) : null}
      </View>

      <Enter i={4} style={styles.footer}>
        {rejected ? (
          <Button label="See my documents" onPress={() => router.replace("/onboarding/documents")} />
        ) : (
          <Button label="Check now" variant="secondary" onPress={() => void check(true)} loading={checking} />
        )}
      </Enter>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.surface, paddingHorizontal: space.lg },
  middle: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.md },
  live: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.sm },
  footer: { gap: space.sm },
});
