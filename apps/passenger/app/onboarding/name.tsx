import { useState } from "react";
import { useRouter } from "expo-router";
import { AuthNote, AuthScreen, Banner, Button, Field, NameScene, notify } from "@nova/kit";
import { normaliseRwandanPhone } from "@nova/data";
import { supabase } from "../../src/lib/supabase";
import { useLightStatusBar } from "../../src/lib/statusBar";

function normalisePhone(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    return normaliseRwandanPhone(raw);
  } catch {
    return null;
  }
}

export default function NameScreen() {
  useLightStatusBar();
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const first = name.trim();

  async function submit() {
    if (!first || busy) return;
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
        first_name: first,
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
    <AuthScreen
      scene={<NameScene name={name} />}
      title="What should we call you?"
      subtitle="Your rider sees your first name, so they know who they're looking for."
      step={2}
      steps={3}
      footer={<Button label="Continue" variant="highlight" onPress={submit} loading={busy} disabled={!first} />}
    >
      {/* The scene above fills in as they type: the card a rider's arrival
          will show, with this name on it. */}
      <Field
        label="First name"
        value={name}
        onChangeText={setName}
        placeholder="Aline"
        autoFocus
        autoCapitalize="words"
        onSubmitEditing={submit}
        returnKeyType="done"
      />
      <AuthNote icon="eye-off">Just a first name is fine. Your surname and number are never shown.</AuthNote>
      {error ? (
        <Banner tone="bad" icon="alert-circle">
          {error}
        </Banner>
      ) : null}
    </AuthScreen>
  );
}
