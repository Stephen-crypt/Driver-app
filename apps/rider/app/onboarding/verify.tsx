import { useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { AuthScreen, Banner, Button, CodeScene, OtpBoxes, ResendRow, notify, prettyPhone, useOverlay } from "@nova/kit";
import { requestOtp, verifyOtp } from "@nova/data";
import { supabase } from "../../src/lib/supabase";
import { SIGNUP_STEPS } from "../../src/onboarding/steps";
import { useLightStatusBar } from "../../src/lib/statusBar";

const RESEND_AFTER = 30;

export default function VerifyScreen() {
  useLightStatusBar();
  const router = useRouter();
  const overlay = useOverlay();
  const params = useLocalSearchParams<{ phone?: string | string[]; mode?: string }>();
  const login = params.mode === "login";
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
      // The tabs decide where an existing rider belongs - details, the review
      // queue, or straight to work. Sending everyone to details made a rider
      // who signed back in fill the form in again.
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
    <AuthScreen
      scene={<CodeScene />}
      title="Enter the code"
      subtitle={phone ? `We sent six digits by SMS to ${prettyPhone(phone)}.` : "Enter the code we sent you."}
      onBack={() => router.back()}
      {...(login ? {} : { step: 1, steps: SIGNUP_STEPS.length })}
      footer={<Button label="Verify" variant="highlight" onPress={() => submit()} loading={busy} disabled={code.length < 6} />}
    >
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
      {error ? (
        <Banner tone="bad" icon="alert-circle">
          {error}
        </Banner>
      ) : null}
      <ResendRow wait={wait} onResend={() => void resend()} onChangeNumber={() => router.back()} />
    </AuthScreen>
  );
}
