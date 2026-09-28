import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Banner, Button, Chip, ChoiceRow, Divider, Group, Screen, Txt, Well, c, radius, space, type IconName } from "@gera/kit";
import { PAYMENT_KINDS, listPaymentMethods, setDefaultPaymentMethod, type PaymentKind } from "@gera/data";
import { supabase } from "../src/lib/supabase";
import { useSession } from "../src/lib/session";
import { goBack } from "../src/lib/nav";

const ICONS: Record<PaymentKind, IconName> = {
  cash: "cash",
  mtn_momo: "phone-portrait",
  airtel_money: "phone-portrait",
  card: "card",
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
      gap={space.lg}
    >
      <Group key="methods">
        {PAYMENT_KINDS.map((p, i) => (
          <View key={p.kind}>
            {i > 0 ? <Divider inset={space.md + 38 + space.md} /> : null}
            <ChoiceRow
              kind="radio"
              icon={ICONS[p.kind]}
              on={selected === p.kind}
              onPress={() => void choose(p.kind)}
              disabled={!p.live || busy}
              title={p.label}
              hint={p.blurb}
              trailing={!p.live ? <Chip label="Soon" /> : undefined}
            />
          </View>
        ))}
      </Group>
      {error ? (
        <Banner key="error" tone="bad" icon="alert-circle">
          {error}
        </Banner>
      ) : null}
      <View key="how" style={styles.how}>
        <Well icon="cash" tone="good" />
        <View style={styles.flex}>
          <Txt v="bodyStrong">How paying in cash works</Txt>
          <Txt v="label" tone="muted">
            The price is fixed before you book. At the end, your screen and your rider's show the same amount, so there is
            nothing to argue about. Pay them, and you're done.
          </Txt>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  how: {
    flexDirection: "row",
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: c.surfaceRaised,
  },
});
