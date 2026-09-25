import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { theme, tokens } from "@gera/ui";
import {
  PAYMENT_KINDS,
  listPaymentMethods,
  setDefaultPaymentMethod,
  type PaymentKind,
} from "@gera/data";
import { supabase } from "../src/lib/supabase";

export default function Payment() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [selected, setSelected] = useState<PaymentKind>("cash");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(async ({ data }) => {
      const id = data.user?.id ?? null;
      if (!active) return;
      setUserId(id);
      if (!id) {
        setLoading(false);
        return;
      }
      try {
        const methods = await listPaymentMethods(supabase, id);
        const def = methods.find((m) => m.isDefault);
        if (active && def) setSelected(def.kind);
      } catch {
        // No stored preference is the normal first-run case, not an error.
      } finally {
        if (active) setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const choose = useCallback(
    async (kind: PaymentKind) => {
      if (!userId) return;
      const entry = PAYMENT_KINDS.find((p) => p.kind === kind);
      if (!entry?.live) return;
      setBusy(true);
      setError(null);
      const previous = selected;
      setSelected(kind);
      try {
        await setDefaultPaymentMethod(supabase, userId, kind);
      } catch (e) {
        setSelected(previous);
        setError(e instanceof Error ? e.message : "Could not save that.");
      } finally {
        setBusy(false);
      }
    },
    [userId, selected],
  );

  if (loading) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>How you pay</Text>
      <Text style={styles.sub}>
        Cash is how Gera works today. Everything else is on the way — we'd rather
        show you what's coming than pretend it's here.
      </Text>

      {PAYMENT_KINDS.map((p) => {
        const active = selected === p.kind;
        return (
          <Pressable
            key={p.kind}
            style={[styles.row, active && styles.rowActive, !p.live && styles.rowDim]}
            onPress={() => choose(p.kind)}
            disabled={!p.live || busy}
            accessibilityRole="radio"
            accessibilityState={{ selected: active, disabled: !p.live }}
          >
            <View style={styles.flex}>
              <Text style={styles.rowLabel}>{p.label}</Text>
              <Text style={styles.rowBlurb}>{p.blurb}</Text>
            </View>
            {active ? <Text style={styles.check}>✓</Text> : null}
            {!p.live ? <Text style={styles.soon}>Soon</Text> : null}
          </Pressable>
        );
      })}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable style={styles.cta} onPress={() => router.back()} accessibilityRole="button">
        <Text style={styles.ctaText}>Done</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.surface },
  content: { padding: tokens.space.lg, paddingBottom: tokens.space.xxl },
  flex: { flex: 1 },
  centre: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.surface,
  },
  title: {
    fontSize: tokens.type.title.size,
    fontWeight: "700",
    color: theme.textStrong,
  },
  sub: {
    marginTop: tokens.space.sm,
    marginBottom: tokens.space.lg,
    fontSize: tokens.type.body.size,
    lineHeight: tokens.type.body.leading,
    color: theme.textMuted,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: tokens.MIN_TOUCH_TARGET + 8,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
    marginBottom: tokens.space.sm,
    borderRadius: tokens.radius.md,
    borderWidth: 2,
    borderColor: "transparent",
    backgroundColor: theme.surfaceRaised,
  },
  rowActive: { borderColor: theme.accent },
  rowDim: { opacity: 0.55 },
  rowLabel: {
    fontSize: tokens.type.body.size,
    fontWeight: "700",
    color: theme.textStrong,
  },
  rowBlurb: { fontSize: tokens.type.label.size, color: theme.textMuted },
  check: {
    fontSize: tokens.type.title.size,
    fontWeight: "700",
    color: theme.accent,
  },
  soon: { fontSize: tokens.type.label.size, color: theme.textMuted },
  error: { color: theme.danger, fontSize: tokens.type.body.size },
  cta: {
    marginTop: tokens.space.lg,
    minHeight: tokens.MIN_TOUCH_TARGET,
    backgroundColor: theme.accent,
    borderRadius: tokens.radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: {
    fontSize: tokens.type.body.size,
    fontWeight: "700",
    color: theme.onAccent,
  },
});
