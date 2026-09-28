import { useCallback, useState } from "react";
import { Linking, StyleSheet, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import Constants from "expo-constants";
import {
  Avatar,
  Button,
  Divider,
  Group,
  IconButton,
  Row,
  Screen,
  Txt,
  c,
  space,
  useOverlay,
} from "@gera/kit";
import { EMERGENCY_NUMBER, deleteSavedPlace, listSavedPlaces, type SavedPlace } from "@gera/data";
import { supabase } from "../../src/lib/supabase";
import { useSession } from "../../src/lib/session";

function placeIcon(label: string): "home" | "briefcase" | "bookmark" {
  return /home|urugo/i.test(label) ? "home" : /work|office|akazi/i.test(label) ? "briefcase" : "bookmark";
}

export default function Account() {
  const router = useRouter();
  const overlay = useOverlay();
  const { userId } = useSession();
  const [name, setName] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [places, setPlaces] = useState<SavedPlace[]>([]);

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      let active = true;
      (async () => {
        const [{ data: user }, profile, saved] = await Promise.all([
          supabase.auth.getUser(),
          supabase.from("profiles").select("first_name, phone").eq("id", userId).maybeSingle(),
          listSavedPlaces(supabase, userId).catch(() => [] as SavedPlace[]),
        ]);
        if (!active) return;
        const p = profile.data as { first_name?: string; phone?: string } | null;
        setName(p?.first_name ?? null);
        setPhone(p?.phone ?? user.user?.phone ?? null);
        setPlaces(saved);
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
      title: "Sign out of Gera?",
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

  return (
    <Screen>
      <View style={styles.identity}>
        <Avatar name={name ?? "?"} size={68} tone="dark" />
        <View style={styles.flex}>
          <Txt v="title">{name ?? "Your account"}</Txt>
          {phone ? (
            <Txt v="body" tone="muted" tabularNums>
              {phone}
            </Txt>
          ) : null}
        </View>
      </View>

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
        </Group>

        <Group title="Help">
          <Row title="Help and safety" subtitle="Staying safe, prices, common questions" icon="shield-checkmark" onPress={() => router.push("/help")} />
          <Divider inset={70} />
          <Row title="Your reports" subtitle="Lost property, problems, and our answers" icon="document-text" onPress={() => router.push("/reports")} />
          <Divider inset={70} />
          <Row
            title={`Call ${EMERGENCY_NUMBER}`}
            subtitle="Police, ambulance and fire"
            icon="call"
            iconTone="bad"
            onPress={() => void Linking.openURL(`tel:${EMERGENCY_NUMBER}`)}
          />
        </Group>

        <Button label="Sign out" variant="quiet" onPress={() => void signOut()} />
        {version ? (
          <Txt v="caption" tone="muted" align="center">
            Gera {version}
          </Txt>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  identity: { flexDirection: "row", alignItems: "center", gap: space.md, paddingTop: space.lg, paddingBottom: space.xl },
  stack: { gap: space.lg },
});
