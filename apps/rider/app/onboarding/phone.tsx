import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { theme, tokens } from "@gera/ui";
import { requestOtp } from "@gera/data";
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
    <View style={styles.root}>
      <Text style={styles.title}>What's your number?</Text>
      <Text style={styles.sub}>We'll text you a code to sign in.</Text>

      <TextInput
        style={styles.input}
        value={phone}
        onChangeText={setPhone}
        placeholder="078 812 3456"
        placeholderTextColor={theme.textMuted}
        keyboardType="phone-pad"
        autoFocus
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        style={[styles.cta, busy && styles.ctaBusy]}
        onPress={submit}
        disabled={busy}
      >
        <Text style={styles.ctaText}>{busy ? "Sending…" : "Continue"}</Text>
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
  sub: {
    fontSize: tokens.type.body.size,
    color: theme.textMuted,
    marginTop: tokens.space.sm,
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
  // The primary action lives in the bottom third, within one-thumb reach.
  cta: {
    marginTop: "auto",
    marginBottom: tokens.space.xl,
    minHeight: tokens.MIN_TOUCH_TARGET,
    backgroundColor: theme.accent,
    borderRadius: tokens.radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaBusy: { opacity: 0.6 },
  ctaText: { fontSize: tokens.type.body.size, fontWeight: "700", color: theme.onAccent },
});
