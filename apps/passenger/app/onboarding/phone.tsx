import { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { AuthNote, AuthScreen, AuthSwitch, Banner, Button, PhoneField, PhoneScene } from "@nova/kit";
import { requestOtp } from "@nova/data";
import { supabase } from "../../src/lib/supabase";
import { useLightStatusBar } from "../../src/lib/statusBar";

/**
 * Signing up and logging in are the same thing underneath - a number and a
 * code - but people arrive meaning one or the other, so the screen says what
 * they came to do and offers the way across.
 */
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
      title={login ? "Welcome back" : "Create your account"}
      subtitle={
        login
          ? "Enter your number and we'll text you a code to sign in."
          : "Just your number. We'll text you a six-digit code, so there's no password to remember."
      }
      onBack={router.canGoBack() ? () => router.back() : undefined}
      {...(login ? {} : { step: 0, steps: 3 })}
      footer={
        <>
          <Button label={login ? "Send my code" : "Continue"} variant="highlight" onPress={submit} loading={busy} disabled={!ready} />
          <AuthSwitch
            question={login ? "New to Nova?" : "Already have an account?"}
            action={login ? "Create an account" : "Log in"}
            onPress={() => router.setParams({ mode: login ? "signup" : "login" })}
          />
        </>
      }
    >
      <PhoneField value={phone} onChangeText={setPhone} onSubmitEditing={submit} />
      <AuthNote icon="lock-closed">Your rider only ever sees your first name. Your number stays with Nova.</AuthNote>
      {error ? (
        <Banner tone="bad" icon="alert-circle">
          {error}
        </Banner>
      ) : null}
    </AuthScreen>
  );
}
