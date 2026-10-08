import { useCallback, useState } from "react";
import { Linking, StyleSheet, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import Constants from "expo-constants";
import { Ionicons } from "@expo/vector-icons";
import {
  Avatar,
  Button,
  Card,
  Divider,
  Group,
  IconButton,
  Row,
  Press,
  Screen,
  Txt,
  c,
  font,
  radius,
  space,
  useOverlay,
  type IconName,
} from "@nova/kit";
import { EMERGENCY_NUMBER, deleteSavedPlace, listMyPromos, listSavedPlaces, listTrips, type SavedPlace } from "@nova/data";
import { supabase } from "../../src/lib/supabase";
import { useSession } from "../../src/lib/session";
import { useLightStatusBar } from "../../src/lib/statusBar";

function placeIcon(label: string): "home" | "briefcase" | "bookmark" {
  return /home|urugo/i.test(label) ? "home" : /work|office|akazi/i.test(label) ? "briefcase" : "bookmark";
}

export default function Account() {
  useLightStatusBar();
  const router = useRouter();
  const overlay = useOverlay();
  const { userId } = useSession();
  const [name, setName] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [taken, setTaken] = useState<number | null>(null);
  const [since, setSince] = useState<string | null>(null);
  const [promos, setPromos] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      let active = true;
      (async () => {
        const [{ data: user }, profile, saved, trips, codes] = await Promise.all([
          supabase.auth.getUser(),
          supabase.from("profiles").select("first_name, phone, created_at").eq("id", userId).maybeSingle(),
          listSavedPlaces(supabase, userId).catch(() => [] as SavedPlace[]),
          listTrips(supabase, "passenger_id", userId, 200).catch(() => null),
          listMyPromos(supabase).catch(() => null),
        ]);
        if (!active) return;
        const p = profile.data as { first_name?: string; phone?: string; created_at?: string } | null;
        setTaken(trips ? trips.filter((t) => t.state === "completed").length : null);
        setSince(p?.created_at ? new Date(p.created_at).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : null);
        setName(p?.first_name ?? null);
        setPhone(p?.phone ?? user.user?.phone ?? null);
        setPlaces(saved);
        setPromos(codes ? codes.filter((p) => p.status === "ready").length : null);
      })();
      return () => {
        active = false;
      };
    }, [userId]),
  );

  const remove = async (p: SavedPlace) => {
    const ok = await overlay.confirm({
      title: `Remove ${p.label}?`,
      message: "You can pin it again any time.",
      confirmLabel: "Remove place",
      cancelLabel: "Keep it",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await deleteSavedPlace(supabase, p.id);
      setPlaces((ps) => ps.filter((x) => x.id !== p.id));
      overlay.toast({ message: `${p.label} removed`, tone: "good" });
    } catch {
      overlay.toast({ message: "Couldn't remove that place. Try again.", tone: "bad" });
    }
  };

  const signOut = async () => {
    const ok = await overlay.confirm({
      title: "Sign out of Nova?",
      message: "Your trips and saved places stay on your account.",
      confirmLabel: "Sign out",
      cancelLabel: "Stay signed in",
      tone: "danger",
    });
    if (!ok) return;
    await supabase.auth.signOut();
    router.replace("/welcome");
  };

  const version = Constants.expoConfig?.version;

  const identity = (
    <View style={styles.identity}>
      <Avatar name={name ?? "?"} size={72} tone="highlight" />
      <View style={styles.flex}>
        <Txt v="title" tone="onHero" lines={1}>
          {name ?? "Your account"}
        </Txt>
        {phone ? (
          <Txt v="body" tone="onHeroMuted" tabularNums>
            {phone}
          </Txt>
        ) : null}
        <View style={styles.pills}>
          {taken !== null ? (
            <View style={styles.pill}>
              <Ionicons name="navigate" size={12} color={c.highlight} />
              <Txt v="caption" tone="onHero" style={styles.pillText}>
                {taken} {taken === 1 ? "trip" : "trips"}
              </Txt>
            </View>
          ) : null}
          {since ? (
            <View style={styles.pill}>
              <Ionicons name="calendar" size={12} color={c.highlight} />
              <Txt v="caption" tone="onHero" style={styles.pillText}>
                With Nova since {since}
              </Txt>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );

  const shortcuts: { icon: IconName; label: string; ground: string; ink: string; onPress: () => void }[] = [
    { icon: "shield-checkmark", label: "Help and safety", ground: c.tintBlue, ink: c.accent, onPress: () => router.push("/help") },
    { icon: "document-text", label: "Your reports", ground: c.tintGreen, ink: c.success, onPress: () => router.push("/reports") },
    { icon: "call", label: `Call ${EMERGENCY_NUMBER}`, ground: c.dangerSoft, ink: c.danger, onPress: () => void Linking.openURL(`tel:${EMERGENCY_NUMBER}`) },
  ];

  return (
    <Screen brand hero={identity} overlap={44} gap={space.lg}>
      <Card inner={styles.shortcuts}>
        {shortcuts.map((x) => (
          <Press key={x.label} onPress={x.onPress} scaleTo={0.95} style={styles.shortcut} accessibilityRole="button" accessibilityLabel={x.label}>
            <View style={[styles.shortcutWell, { backgroundColor: x.ground }]}>
              <Ionicons name={x.icon} size={22} color={x.ink} />
            </View>
            <Txt v="caption" tone="strong" align="center" lines={2} style={styles.shortcutText}>
              {x.label}
            </Txt>
          </Press>
        ))}
      </Card>

      <View style={styles.stack}>
        <Group title="Saved places">
          {places.map((p, i) => (
            <View key={p.id}>
              {i > 0 ? <Divider inset={70} /> : null}
              <Row
                title={p.label}
                subtitle={p.note ?? undefined}
                icon={placeIcon(p.label)}
                trailing={<IconButton icon="trash-outline" label={`Remove ${p.label}`} onPress={() => void remove(p)} size={40} />}
              />
            </View>
          ))}
          {places.length > 0 ? <Divider inset={70} /> : null}
          <Row
            title={places.length === 0 ? "Save a place" : "Add another place"}
            subtitle={places.length === 0 ? "Home, work - book it in one tap" : undefined}
            icon="add"
            iconTone="neutral"
            onPress={() => router.push({ pathname: "/destination", params: { map: "1" } })}
          />
        </Group>

        <Group title="Payments">
          <Row title="How you pay" subtitle="Cash, paid to your rider at the end" icon="cash" iconTone="good" onPress={() => router.push("/payment")} />
          <Divider inset={space.md + 38 + space.md} />
          <Row
            title="Promotions"
            subtitle={promos ? `${promos} ${promos === 1 ? "code" : "codes"} ready to use` : "Add a promo code"}
            icon="pricetag"
            iconTone="good"
            onPress={() => router.push("/promotions")}
          />
        </Group>

        <Button label="Sign out" variant="quiet" onPress={() => void signOut()} />
        {version ? (
          <Txt v="caption" tone="muted" align="center">
            Nova {version}
          </Txt>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  identity: { flexDirection: "row", alignItems: "center", gap: space.md, paddingTop: space.sm },
  stack: { gap: space.lg },
  shortcuts: { flexDirection: "row", paddingVertical: space.md, paddingHorizontal: space.sm },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.sm },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: c.heroRaised,
  },
  pillText: { fontFamily: font.semibold },
  shortcut: { flex: 1, alignItems: "center", gap: space.sm },
  shortcutWell: { width: 52, height: 52, borderRadius: radius.md + 2, alignItems: "center", justifyContent: "center" },
  shortcutText: { fontFamily: font.semibold, paddingHorizontal: 4 },
});
