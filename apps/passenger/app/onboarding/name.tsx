import { useState } from "react";
import { useRouter } from "expo-router";
import { Banner, Button, Field, Screen, StepTrack, Txt, notify } from "@nova/kit";
import { normaliseRwandanPhone } from "@nova/data";
import { supabase } from "../../src/lib/supabase";

function normalisePhone(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    return normaliseRwandanPhone(raw);
  } catch {
    return null;
  }
}

export default function NameScreen() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        setError("Session expired. Start again.");
        return;
      }

      // Supabase Auth stores the phone digits-only (250788123456), but
      // profiles.phone is E.164 by contract and its unique constraint cannot see
      // that the two spellings are the same person.
      const phone = normalisePhone(auth.user.phone);
      if (!phone) {
        setError("We could not read your phone number. Start again.");
        return;
      }

      const { error: writeError } = await supabase.from("profiles").insert({
        id: auth.user.id,
        role: "passenger",
        first_name: name.trim(),
        phone,
      });

      // Already there means a double tap or a retry after a dropped response -
      // the profile exists, which is what this screen wanted.
      if (writeError && writeError.code !== "23505") {
        setError("We couldn't save that. Check your connection and try again.");
        return;
      }
      notify("success");
      router.replace("/");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title="What should we call you?"
      subtitle="Your rider sees your first name, so they know who they're looking for."
      stagger={false}
      footer={<Button label="Continue" onPress={submit} loading={busy} disabled={!name.trim()} />}
    >
      <StepTrack steps={["Your number", "The code", "Your name"]} current={2} />
      <Field value={name} onChangeText={setName} placeholder="Aline" autoFocus autoCapitalize="words" onSubmitEditing={submit} returnKeyType="done" />
      <Txt v="caption" tone="muted">
        Just a first name is fine.
      </Txt>
      {error ? <Banner tone="bad" icon="alert-circle">{error}</Banner> : null}
    </Screen>
  );
}
