import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Banner, Button, OtpBoxes, Press, Screen, StepTrack, Txt, notify, space, useOverlay } from "@nova/kit";
import { requestOtp, verifyOtp } from "@nova/data";
import { supabase } from "../../src/lib/supabase";

const RESEND_AFTER = 30;

export default function VerifyScreen() {
  const router = useRouter();
  const overlay = useOverlay();
  const params = useLocalSearchParams<{ phone?: string | string[] }>();
  const phone = Array.isArray(params.phone) ? params.phone[0] : params.phone;
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(RESEND_AFTER);

  // A code that does not arrive is the commonest dead end in sign-up; the way
  // out is on screen, counting down, rather than hidden behind "go back".
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function submit(value = code) {
    setError(null);
    if (!phone) {
      setError("We lost your number. Go back and enter it again.");
      return;
    }
    setBusy(true);
    try {
      await verifyOtp(supabase, phone, value);
      notify("success");
      // The tabs decide where a passenger belongs: the name question for a new
      // one, straight home for someone signing back in. Sending everyone to the
      // name screen made a returning passenger's second profile insert fail.
      router.replace("/");
    } catch {
      notify("error");
      setError("That code didn't work. Check the message and try again.");
    } finally {
      setBusy(false);
    }
  }

  const resend = async () => {
    if (!phone) return;
    try {
      await requestOtp(supabase, phone);
      setWait(RESEND_AFTER);
      overlay.toast({ message: "New code sent", tone: "good" });
    } catch {
      overlay.toast({ message: "Couldn't send a new code. Check your connection.", tone: "bad" });
    }
  };

  return (
    <Screen
      title="Enter the code"
      subtitle={phone ? `Sent by SMS to ${phone}` : "Enter the code we sent you"}
      onBack={() => router.back()}
      stagger={false}
      footer={<Button label="Verify" onPress={() => submit()} loading={busy} disabled={code.length < 6} />}
    >
      <View style={styles.stack}>
        <StepTrack steps={["Your number", "The code", "Your name"]} current={1} />
        <OtpBoxes
          value={code}
          error={!!error}
          onChange={(v) => {
            setError(null);
            setCode(v);
            // Six digits is the whole code - go, without making them find a button.
            if (v.length === 6) void submit(v);
          }}
        />
        {error ? <Banner tone="bad" icon="alert-circle">{error}</Banner> : null}
        {wait > 0 ? (
          <Txt v="label" tone="muted" align="center">
            You can ask for a new code in 0:{String(wait).padStart(2, "0")}
          </Txt>
        ) : (
          <Press onPress={resend} scaleTo={0.96} style={styles.resend} accessibilityRole="button">
            <Txt v="label" tone="accent" align="center">
              Send me a new code
            </Txt>
          </Press>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  resend: { alignSelf: "center", paddingVertical: space.sm, paddingHorizontal: space.md },
});
