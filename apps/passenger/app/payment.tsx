import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Banner, Button, Chip, Divider, Group, Screen, Txt, c, space, tap, type IconName } from "@gera/kit";
import { PAYMENT_KINDS, listPaymentMethods, setDefaultPaymentMethod, type PaymentKind } from "@gera/data";
import { supabase } from "../src/lib/supabase";
import { useSession } from "../src/lib/session";
import { goBack } from "../src/lib/nav";

const ICONS: Record<PaymentKind, IconName> = {
  cash: "cash-outline",
  mtn_momo: "phone-portrait-outline",
  airtel_money: "phone-portrait-outline",
  card: "card-outline",
};

export default function Payment() {
  const router = useRouter();
  const { userId } = useSession();
  const [selected, setSelected] = useState<PaymentKind>("cash");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    listPaymentMethods(supabase, userId)
      .then((m) => {
        const def = m.find((x) => x.isDefault);
        if (def) setSelected(def.kind);
      })
      .catch(() => {
        // No stored preference is the normal first-run case.
      });
  }, [userId]);

  const choose = useCallback(
    async (kind: PaymentKind) => {
      if (!userId || !PAYMENT_KINDS.find((p) => p.kind === kind)?.live) return;
      const previous = selected;
      setSelected(kind);
      setBusy(true);
      setError(null);
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

  return (
    <Screen
      title="How you pay"
      subtitle="Cash is how Gera works today. We'd rather show you what's coming than pretend it's here."
      onBack={() => goBack(router)}
      footer={<Button label="Done" onPress={() => goBack(router)} />}
    >
      <Group>
        {PAYMENT_KINDS.map((p, i) => {
          const on = selected === p.kind;
          return (
            <View key={p.kind}>
              {i > 0 ? <Divider inset={70} /> : null}
              <Pressable
                onPress={() => {
                  tap();
                  void choose(p.kind);
                }}
                disabled={!p.live || busy}
                accessibilityRole="radio"
                accessibilityState={{ selected: on, disabled: !p.live }}
                style={[styles.row, !p.live && styles.dim]}
              >
                <View style={[styles.well, on && styles.wellOn]}>
                  <Ionicons name={ICONS[p.kind]} size={20} color={on ? c.onAccent : c.textMuted} />
                </View>
                <View style={styles.flex}>
                  <Txt v="bodyStrong">{p.label}</Txt>
                  <Txt v="label" tone="muted">
                    {p.blurb}
                  </Txt>
                </View>
                {on ? <Ionicons name="checkmark-circle" size={24} color={c.accent} /> : !p.live ? <Chip label="Soon" /> : null}
              </Pressable>
            </View>
          );
        })}
      </Group>
      {error ? (
        <View style={styles.error}>
          <Banner tone="bad" icon="alert-circle">{error}</Banner>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, minHeight: 68 },
  dim: { opacity: 0.55 },
  well: { width: 38, height: 38, borderRadius: 12, backgroundColor: c.surfaceHigh, alignItems: "center", justifyContent: "center" },
  wellOn: { backgroundColor: c.accent },
  error: { marginTop: space.md },
});
