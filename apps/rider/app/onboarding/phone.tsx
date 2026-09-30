import { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { AuthNote, AuthScreen, AuthSwitch, Banner, Button, PhoneField, PhoneScene } from "@nova/kit";
import { requestOtp } from "@nova/data";
import { supabase } from "../../src/lib/supabase";
import { SIGNUP_STEPS } from "../../src/onboarding/steps";
import { useLightStatusBar } from "../../src/lib/statusBar";

export default function PhoneScreen() {
  useLightStatusBar();
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string }>();
  const login = params.mode === "login";
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = phone.replace(/\D/g, "").length >= 9;

  async function submit() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await requestOtp(supabase, phone);
      router.push({ pathname: "/onboarding/verify", params: { phone, mode: login ? "login" : "signup" } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthScreen
      scene={<PhoneScene />}
      title={login ? "Welcome back" : "Ride with Nova"}
      subtitle={
        login
          ? "Enter your number and we'll text you a code to sign in."
          : "Start with your number. We'll text you a six-digit code - it's how you sign in, every time."
      }
      onBack={router.canGoBack() ? () => router.back() : undefined}
      {...(login ? {} : { step: 0, steps: SIGNUP_STEPS.length })}
      footer={
        <>
          <Button label={login ? "Send my code" : "Continue"} variant="highlight" onPress={submit} loading={busy} disabled={!ready} />
          <AuthSwitch
            question={login ? "New rider?" : "Already a Nova rider?"}
            action={login ? "Sign up" : "Log in"}
            onPress={() => router.setParams({ mode: login ? "signup" : "login" })}
          />
        </>
      }
    >
      <PhoneField value={phone} onChangeText={setPhone} onSubmitEditing={submit} />
      <AuthNote icon="lock-closed">Passengers see your first name and your vest number. Your phone number stays with Nova.</AuthNote>
      {error ? (
        <Banner tone="bad" icon="alert-circle">
          {error}
        </Banner>
      ) : null}
    </AuthScreen>
  );
}
