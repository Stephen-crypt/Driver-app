import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { AuthNote, AuthScreen, Button, LiveDot, ReviewScene, Timeline, Txt, c, radius, shadow, space, useOverlay } from "@nova/kit";
import { supabase } from "../../src/lib/supabase";
import { SIGNUP_STEPS } from "../../src/onboarding/steps";
import { useLightStatusBar } from "../../src/lib/statusBar";

type Verification = "submitted" | "verified" | "rejected" | string;

/** How often to re-read while waiting. Cheap: one row, the rider's own. */
const POLL_MS = 5000;

export default function PendingScreen() {
  useLightStatusBar();
  const router = useRouter();
  const overlay = useOverlay();
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
    <AuthScreen
      scene={<ReviewScene rejected={rejected} />}
      title={rejected ? "Something needs fixing" : "We're checking your documents"}
      subtitle={
        rejected
          ? "One or more of your documents was not accepted. Each one says why, so you know what to send again."
          : "This usually takes a few hours. This screen moves on by itself the moment you're approved."
      }
      step={rejected ? 3 : 4}
      steps={SIGNUP_STEPS.length}
      footer={
        rejected ? (
          <Button label="See my documents" variant="highlight" onPress={() => router.replace("/onboarding/documents")} />
        ) : (
          <Button label="Check now" variant="secondary" onPress={() => void check(true)} loading={checking} />
        )
      }
    >
      {/* A rider lands here and then waits, possibly for hours. The timeline
          shows how far they have come and what is left: one step. */}
      <View style={styles.card}>
        <Timeline
          items={[
            { label: "Phone number checked", time: "" },
            { label: "Details sent", time: "" },
            { label: "Documents uploaded", time: "", ...(rejected ? { tone: "bad" as const, note: "Some need sending again" } : {}) },
            rejected
              ? { label: "Fleet office review", time: "", tone: "pending" as const }
              : { label: "Fleet office review", time: "", tone: "now" as const, note: "Usually a few hours" },
          ]}
        />
      </View>
      {!rejected ? (
        <View style={styles.live}>
          <LiveDot tone="accent" />
          <Txt v="caption" tone="muted">
            Checking every few seconds
          </Txt>
        </View>
      ) : null}
      <AuthNote icon="notifications">You can close the app. Open it again any time and it picks up where you are.</AuthNote>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  card: { padding: space.md, borderRadius: radius.lg, backgroundColor: c.surfaceRaised, ...shadow.card },
  live: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: 2 },
});
