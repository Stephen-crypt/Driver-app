import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { theme, tokens } from "@gera/ui";
import { normaliseRwandanPhone } from "@gera/data";
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

  async function submit() {
    setError(null);
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      setError("Session expired. Start again.");
      return;
    }

    // Supabase Auth stores the phone digits-only (250788123456), but
    // profiles.phone is E.164 by contract and its unique constraint cannot see
    // that the two spellings are the same person. The old `?? ""` fallback was
    // worse still: it claimed the unique empty-string slot for the first user
    // whose session carried no phone, locking every later one out.
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

    if (writeError) {
      setError(writeError.message);
      return;
    }
    router.replace("/");
  }

  return (
    <View style={styles.root}>
      <Text style={styles.title}>What should we call you?</Text>

      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="Aline"
        placeholderTextColor={theme.textMuted}
        autoFocus
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        style={[styles.cta, !name.trim() && styles.ctaBusy]}
        onPress={submit}
        disabled={!name.trim()}
      >
        <Text style={styles.ctaText}>Start riding</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.surface, padding: tokens.space.lg },
  title: {
    fontSize: tokens.type.title.size,
    fontWeight: "700",
    color: theme.textStrong,
    marginTop: tokens.space.xxl,
  },
  input: {
    marginTop: tokens.space.xl,
    fontSize: tokens.type.title.size,
    color: theme.textStrong,
    borderBottomWidth: 2,
    borderBottomColor: theme.accent,
    paddingVertical: tokens.space.sm,
  },
  error: { color: theme.danger, marginTop: tokens.space.md },
  cta: {
    marginTop: "auto",
    marginBottom: tokens.space.xl,
    minHeight: tokens.MIN_TOUCH_TARGET,
    backgroundColor: theme.accent,
    borderRadius: tokens.radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaBusy: { opacity: 0.5 },
  ctaText: { fontSize: tokens.type.body.size, fontWeight: "700", color: theme.onAccent },
});
