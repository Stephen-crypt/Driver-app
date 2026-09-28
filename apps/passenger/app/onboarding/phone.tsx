import { useState } from "react";
import { useRouter } from "expo-router";
import { Banner, Button, Field, Screen, StepTrack, Txt } from "@nova/kit";
import { requestOtp } from "@nova/data";
import { supabase } from "../../src/lib/supabase";

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
      footer={<Button label="Send code" onPress={submit} loading={busy} disabled={phone.trim().length < 9} />}
    >
      <StepTrack steps={["Your number", "The code", "Your name"]} current={0} />
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
        Your rider only ever sees your first name. Your number stays with Nova.
      </Txt>
      {error ? <Banner tone="bad" icon="alert-circle">{error}</Banner> : null}
    </Screen>
  );
}
