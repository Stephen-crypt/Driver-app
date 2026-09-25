import { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Banner, Button, Field, Screen } from "@gera/kit";
import { verifyOtp } from "@gera/data";
import { supabase } from "../../src/lib/supabase";

export default function VerifyScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ phone?: string | string[] }>();
  const phone = Array.isArray(params.phone) ? params.phone[0] : params.phone;
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(value = code) {
    setError(null);
    if (!phone) {
      setError("We lost your number. Go back and enter it again.");
      return;
    }
    setBusy(true);
    try {
      await verifyOtp(supabase, phone, value);
      // The tabs decide where a passenger belongs: the name question for a new
      // one, straight home for someone signing back in. Sending everyone to the
      // name screen made a returning passenger's second profile insert fail.
      router.replace("/");
    } catch {
      setError("That code didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title="Enter the code"
      subtitle={phone ? `Sent to ${phone}` : "Enter the code we sent you"}
      onBack={() => router.back()}
      footer={<Button label="Verify" onPress={() => submit()} loading={busy} disabled={code.length < 6} />}
    >
      <Field
        big
        value={code}
        onChangeText={(v) => {
          setCode(v);
          // Six digits is the whole code - go, without making them find a button.
          if (v.length === 6) void submit(v);
        }}
        keyboardType="number-pad"
        maxLength={6}
        placeholder="000000"
        autoFocus
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        accessibilityLabel="Six digit code"
      />
      {error ? <Banner tone="bad" icon="alert-circle">{error}</Banner> : null}
    </Screen>
  );
}
