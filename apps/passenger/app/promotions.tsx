import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Banner, Button, Divider, Field, Group, Row, Screen, Txt, c, radius, space, useOverlay } from "@nova/kit";
import { addPromoCode, listMyPromos, promoLabel, type MyPromo, type PromoStatus } from "@nova/data";
import { supabase } from "../src/lib/supabase";
import { goBack } from "../src/lib/nav";

const GONE: Record<Exclude<PromoStatus, "ready">, string> = {
  used: "Used",
  used_up: "Used up",
  ended: "Ended",
  paused: "Not active right now",
  not_started: "Not active yet",
};

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Kigali" });

/** "500 RWF off. 2 uses left. Ends 30 Oct." */
function about(p: MyPromo): string {
  const parts = [promoLabel(p)];
  if (p.status === "ready") {
    if (p.usesLeft > 1) parts.push(`${p.usesLeft} uses left`);
    if (p.endsAt) parts.push(`Ends ${day(p.endsAt)}`);
  } else {
    parts.push(GONE[p.status]);
  }
  return `${parts.join(". ")}.`;
}

export default function Promotions() {
  const router = useRouter();
  const overlay = useOverlay();
  const [code, setCode] = useState("");
  const [promos, setPromos] = useState<MyPromo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    listMyPromos(supabase)
      .then(setPromos)
      .catch(() => setPromos((p) => p ?? []));
  }, []);
  useFocusEffect(load);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await addPromoCode(supabase, code);
      if (r.ok) {
        setCode("");
        overlay.toast({
          message: r.already ? `${r.promo.code} is already saved.` : `${r.promo.code} added. ${promoLabel(r.promo)} on your next ride.`,
          icon: "pricetag",
          tone: "good",
        });
        load();
      } else {
        setError(r.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add that code.");
    } finally {
      setBusy(false);
    }
  };

  const ready = (promos ?? []).filter((p) => p.status === "ready");
  const gone = (promos ?? []).filter((p) => p.status !== "ready");

  return (
    <Screen
      title="Promotions"
      subtitle="Add a code and your next ride it fits costs less. The saving shows before you book, so the price you see is the price you pay."
      onBack={() => goBack(router)}
      gap={space.lg}
    >
      <View key="add" style={styles.add}>
        <View style={styles.flex}>
          <Field
            label="Promo code"
            value={code}
            onChangeText={(t) => {
              setCode(t.toUpperCase());
              setError(null);
            }}
            placeholder="e.g. NOVA50"
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={() => void add()}
            maxLength={24}
          />
        </View>
        <Button label="Add" onPress={() => void add()} loading={busy} disabled={code.trim().length < 3} compact style={styles.addButton} />
      </View>

      {error ? (
        <Banner key="error" tone="bad" icon="alert-circle">
          {error}
        </Banner>
      ) : null}

      {ready.length > 0 ? (
        <Group key="ready" title="Ready to use">
          {ready.map((p, i) => (
            <View key={p.id}>
              {i > 0 ? <Divider inset={space.md + 38 + space.md} /> : null}
              <Row icon="pricetag" iconTone="good" title={p.code} subtitle={about(p)} />
            </View>
          ))}
        </Group>
      ) : promos ? (
        <View key="none" style={styles.empty}>
          <Txt v="bodyStrong">No codes yet</Txt>
          <Txt v="label" tone="muted">
            When Nova sends you a code, add it here. It's used on your next ride it fits, and you can turn it off for a
            ride when you book.
          </Txt>
        </View>
      ) : null}

      {gone.length > 0 ? (
        <View key="gone" style={styles.faded}>
          <Group title="Used and ended">
            {gone.map((p, i) => (
              <View key={p.id}>
                {i > 0 ? <Divider inset={space.md + 38 + space.md} /> : null}
                <Row icon="pricetag" iconTone="neutral" title={p.code} subtitle={about(p)} />
              </View>
            ))}
          </Group>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  add: { flexDirection: "row", alignItems: "flex-end", gap: space.sm },
  addButton: { minWidth: 84 },
  empty: { gap: 4, padding: space.md, borderRadius: radius.lg, backgroundColor: c.surfaceRaised },
  faded: { opacity: 0.6 },
});
