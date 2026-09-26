import { useCallback, useState } from "react";
import { Alert, Linking, Pressable, StyleSheet, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Avatar, Button, Divider, Group, Row, Screen, Txt, c, space } from "@gera/kit";
import { EMERGENCY_NUMBER, deleteSavedPlace, listSavedPlaces, type SavedPlace } from "@gera/data";
import { supabase } from "../../src/lib/supabase";
import { useSession } from "../../src/lib/session";

export default function Account() {
  const router = useRouter();
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

  const remove = (p: SavedPlace) =>
    Alert.alert("Remove this place?", p.label, [
      { text: "Keep", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteSavedPlace(supabase, p.id);
            setPlaces((ps) => ps.filter((x) => x.id !== p.id));
          } catch {
            Alert.alert("Could not remove that.");
          }
        },
      },
    ]);

  return (
    <Screen>
      <View style={styles.identity}>
        <Avatar name={name ?? "?"} size={64} />
        <View style={styles.flex}>
          <Txt v="title">{name ?? "Your account"}</Txt>
          {phone ? (
            <Txt v="body" tone="muted">
              {phone}
            </Txt>
          ) : null}
        </View>
      </View>

      <View style={styles.stack}>
        <Group title="Saved places">
          {places.length === 0 ? (
            <Row
              title="Nothing saved yet"
              subtitle="Pin a place on the map and name it - Home, Work - to book it in one tap."
              icon="bookmark-outline"
              iconTone="neutral"
            />
          ) : (
            places.map((p, i) => (
              <View key={p.id}>
                {i > 0 ? <Divider inset={70} /> : null}
                <Row
                  title={p.label}
                  subtitle={p.note ?? undefined}
                  icon={/home/i.test(p.label) ? "home" : /work|office/i.test(p.label) ? "briefcase" : "bookmark"}
                  trailing={
                    <Pressable
                      onPress={() => remove(p)}
                      hitSlop={12}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${p.label}`}
                    >
                      <Ionicons name="trash-outline" size={20} color={c.textMuted} />
                    </Pressable>
                  }
                />
              </View>
            ))
          )}
        </Group>

        <Group title="Payments">
          <Row title="How you pay" subtitle="Cash, paid to your rider at the end" icon="cash-outline" iconTone="good" onPress={() => router.push("/payment")} />
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

        <Button
          label="Sign out"
          variant="quiet"
          onPress={async () => {
            await supabase.auth.signOut();
            router.replace("/welcome");
          }}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  identity: { flexDirection: "row", alignItems: "center", gap: space.md, paddingTop: space.lg, paddingBottom: space.xl },
  stack: { gap: space.lg },
});
