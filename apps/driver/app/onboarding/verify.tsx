import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { theme, tokens } from "@gera/ui";
import { verifyOtp } from "@gera/data";
import { supabase } from "../../src/lib/supabase";

export default function VerifyScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ phone?: string | string[] }>();
  const phone = Array.isArray(params.phone) ? params.phone[0] : params.phone;
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    if (!phone) {
      setError("We lost your number. Go back and enter it again.");
      return;
    }
    setBusy(true);
    try {
      await verifyOtp(supabase, phone, code);
      router.replace("/onboarding/details");
    } catch {
      setError("That code didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Enter the code</Text>
      <Text style={styles.sub}>{phone ? `Sent to ${phone}` : "Enter the code we sent you"}</Text>

      <TextInput
        style={styles.input}
        value={code}
        onChangeText={setCode}
        keyboardType="number-pad"
        maxLength={6}
        autoFocus
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable style={[styles.cta, busy && styles.ctaBusy]} onPress={submit} disabled={busy}>
        <Text style={styles.ctaText}>{busy ? "Checking…" : "Verify"}</Text>
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
  sub: { fontSize: tokens.type.body.size, color: theme.textMuted, marginTop: tokens.space.sm },
  input: {
    marginTop: tokens.space.xl,
    fontSize: tokens.type.display.size,
    letterSpacing: 8,
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
  ctaBusy: { opacity: 0.6 },
  ctaText: { fontSize: tokens.type.body.size, fontWeight: "700", color: theme.onAccent },
});
