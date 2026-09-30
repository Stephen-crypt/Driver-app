import { useState } from "react";
import { useRouter } from "expo-router";
import { AuthNote, AuthScreen, Banner, Button, Field, IdScene } from "@nova/kit";
import { normaliseRwandanPhone } from "@nova/data";
import { supabase } from "../../src/lib/supabase";
import { SIGNUP_STEPS } from "../../src/onboarding/steps";
import { useLightStatusBar } from "../../src/lib/statusBar";

function normalisePhone(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    return normaliseRwandanPhone(raw);
  } catch {
    return null;
  }
}

/**
 * Who the rider is - not what they ride. Nova owns the vehicles and assigns one
 * when it approves the rider, so this screen used to ask for a plate, a vest
 * and a vehicle class nobody had yet: a marketplace question left over in a
 * fleet.
 */
export default function DetailsScreen() {
  useLightStatusBar();
  const router = useRouter();
  const [name, setName] = useState("");
  const [licence, setLicence] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const idDigits = nationalId.replace(/\D/g, "");
  const ready = Boolean(name.trim() && licence.trim() && (idDigits.length === 0 || idDigits.length === 16));

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        setError("Session expired. Start again.");
        return;
      }

      // Supabase Auth stores the phone digits-only; profiles.phone is E.164 by
      // contract and its unique constraint cannot see the two are one person.
      const phone = normalisePhone(auth.user.phone);
      if (!phone) {
        setError("We could not read your phone number. Start again.");
        return;
      }

      const { error: registerError } = await supabase.rpc("register_rider", {
        p_first_name: name.trim(),
        p_phone: phone,
        p_licence: licence.trim(),
        p_national_id: idDigits || null,
      });

      if (registerError) {
        setError(
          registerError.code === "23505"
            ? "Those details are already registered to another account."
            : "We could not submit your details. Check your connection and try again.",
        );
        return;
      }

      // Documents before the waiting room: a rider parked on "pending" with
      // nothing uploaded is waiting for a review that can never happen.
      router.replace("/onboarding/documents");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthScreen
      scene={<IdScene />}
      title="About you"
      subtitle="As it appears on your licence and your national ID."
      step={2}
      steps={SIGNUP_STEPS.length}
      footer={<Button label="Continue" variant="highlight" onPress={submit} loading={busy} disabled={!ready} />}
    >
        <Field label="First name" value={name} onChangeText={setName} autoCapitalize="words" />
        <Field label="Driving licence number" value={licence} onChangeText={setLicence} autoCapitalize="characters" />
        <Field
          label="National ID number"
          value={nationalId}
          onChangeText={setNationalId}
          keyboardType="number-pad"
          maxLength={20}
          hint={idDigits.length > 0 && idDigits.length !== 16 ? "A Rwandan national ID has 16 digits." : "16 digits, on the front of your ID."}
        />
        <AuthNote icon="key">
          You don't need a vehicle. Once you're approved, the fleet office assigns you one, with its plate and your vest number.
        </AuthNote>
        {error ? <Banner tone="bad" icon="alert-circle">{error}</Banner> : null}
    </AuthScreen>
  );
}
