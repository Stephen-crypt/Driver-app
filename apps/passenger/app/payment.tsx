import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme, tokens } from "@gera/ui";
import {
  PAYMENT_KINDS,
  listPaymentMethods,
  setDefaultPaymentMethod,
  type PaymentKind,
} from "@gera/data";
import { supabase } from "../src/lib/supabase";
import { Card, Chip, PrimaryButton } from "../src/components/Card";

/** Each method gets a recognisable mark, so the list scans without reading. */
const ICONS: Record<PaymentKind, keyof typeof Ionicons.glyphMap> = {
  cash: "cash-outline",
  mtn_momo: "phone-portrait-outline",
  airtel_money: "phone-portrait-outline",
  card: "card-outline",
};

export default function Payment() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
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
    <ScrollView
      style={styles.root}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + tokens.space.md, paddingBottom: insets.bottom + tokens.space.xl },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.title}>How you pay</Text>
      <Text style={styles.sub}>
        Cash is how Gera works today. Everything else is on the way — we'd rather
        show you what's coming than pretend it's here.
      </Text>

      <Card style={styles.list}>
        {PAYMENT_KINDS.map((p, i) => {
          const active = selected === p.kind;
          return (
            <View key={p.kind}>
              {i > 0 ? <View style={styles.hairline} /> : null}
              <Pressable
                style={[styles.row, !p.live && styles.rowDim]}
                onPress={() => choose(p.kind)}
                disabled={!p.live || busy}
                accessibilityRole="radio"
                accessibilityState={{ selected: active, disabled: !p.live }}
              >
                <View style={[styles.well, active && styles.wellActive]}>
                  <Ionicons
                    name={ICONS[p.kind]}
                    size={18}
                    color={active ? theme.onAccent : theme.textMuted}
                  />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.rowLabel}>{p.label}</Text>
                  <Text style={styles.rowBlurb}>{p.blurb}</Text>
                </View>
                {/* A tick drawn as a glyph rather than typed as text: the
                    literal character rendered at a different weight to
                    everything around it and read as a typo. */}
                {active ? (
                  <Ionicons name="checkmark-circle" size={22} color={theme.accent} />
                ) : !p.live ? (
                  <Chip label="Soon" />
                ) : null}
              </Pressable>
            </View>
          );
        })}
      </Card>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.footer}>
        <PrimaryButton label="Done" onPress={() => router.back()} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.surface },
  content: { paddingHorizontal: tokens.space.lg, paddingBottom: tokens.space.xxl },
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
  list: { paddingVertical: tokens.space.xs },
  hairline: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.border,
    marginLeft: 36 + tokens.space.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    minHeight: tokens.MIN_TOUCH_TARGET + 4,
  },
  rowDim: { opacity: 0.55 },
  well: {
    width: 36,
    height: 36,
    borderRadius: tokens.radius.sm,
    backgroundColor: theme.surfaceHigh,
    alignItems: "center",
    justifyContent: "center",
  },
  wellActive: { backgroundColor: theme.accent },
  rowLabel: {
    fontSize: tokens.type.body.size,
    fontWeight: "700",
    color: theme.textStrong,
  },
  rowBlurb: { fontSize: tokens.type.label.size, color: theme.textMuted },
  error: {
    marginTop: tokens.space.md,
    color: theme.danger,
    fontSize: tokens.type.body.size,
  },
  footer: { marginTop: tokens.space.lg },
});
