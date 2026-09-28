import { useState } from "react";
import { useRouter } from "expo-router";
import { Banner, Button, Field, Screen, StepTrack, Txt, space } from "@nova/kit";
import { requestOtp } from "@nova/data";
import { supabase } from "../../src/lib/supabase";
import { SIGNUP_STEPS } from "../../src/onboarding/steps";

export default function PhoneScreen() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await requestOtp(supabase, phone);
      router.push({ pathname: "/onboarding/verify", params: { phone } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title="What's your number?"
      subtitle="We'll text you a code to sign in."
      onBack={router.canGoBack() ? () => router.back() : undefined}
      stagger={false}
      gap={space.lg}
      footer={<Button label="Send code" onPress={submit} loading={busy} disabled={phone.trim().length < 9} />}
    >
      <StepTrack steps={SIGNUP_STEPS} current={0} />
      <Field
        big
        prefix="+250"
        value={phone}
        onChangeText={setPhone}
        placeholder="78 812 3456"
        keyboardType="phone-pad"
        autoFocus
        accessibilityLabel="Phone number"
      />
      <Txt v="caption" tone="muted">
        Passengers see your first name and your vest number. Your phone number stays with Nova.
      </Txt>
      {error ? <Banner tone="bad" icon="alert-circle">{error}</Banner> : null}
    </Screen>
  );
}
