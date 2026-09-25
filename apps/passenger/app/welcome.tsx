import { useState } from "react";
import { Image, Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Button, PinPatches, Paper, Txt, c, font, space, type IconName } from "@gera/kit";

const PROMISES: readonly { icon: IconName; title: string; body: string }[] = [
  {
    icon: "pricetag-outline",
    title: "The price before you go",
    body: "You agree the fare before you book. No meter, no argument at the end.",
  },
  {
    icon: "keypad-outline",
    title: "A PIN on every trip",
    body: "Your rider can't start until you give them your four numbers. It's how you both know it's the right ride.",
  },
  {
    icon: "cash-outline",
    title: "Pay in cash, at the end",
    body: "Hand it to your rider when you arrive. Mobile money is coming.",
  },
];

export default function Welcome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [riderInfo, setRiderInfo] = useState(false);

  return (
    <View style={styles.root}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Full width at its own proportions. The sky is within a shade of the
            page ground, so the picture needs no frame to sit on it. */}
        <Image
          source={require("../assets/welcome-hero.jpg")}
          style={{ width, height: (width * 714) / 1280, marginTop: insets.top + space.lg }}
          resizeMode="cover"
          accessible
          accessibilityLabel="A moto carrying a passenger along a winding road through terraced green hills"
        />

        <View style={styles.body}>
          {/* kugera: to arrive, to reach. The name is the promise. */}
          <Txt v="hero" style={styles.wordmark}>
            Gera
          </Txt>
          <Txt v="heading" tone="muted">
            Motos and cabs across Kigali, at a price agreed before you go.
          </Txt>

          <View style={styles.promises}>
            {PROMISES.map((p) => (
              <View key={p.title} style={styles.promise}>
                <View style={styles.bullet}>
                  <Ionicons name={p.icon} size={19} color={c.accent} />
                </View>
                <View style={styles.flex}>
                  <Txt v="bodyStrong">{p.title}</Txt>
                  <Txt v="body" tone="muted">
                    {p.body}
                  </Txt>
                </View>
              </View>
            ))}
          </View>

          {/* The PIN, shown the way it will look on the trip screen - the one
              piece of Gera a first-time passenger has never seen before. */}
          <View style={styles.pinDemo}>
            <PinPatches pin="4821" size="sm" />
            <Txt v="label" tone="muted" style={styles.flex}>
              Your PIN appears here once a rider accepts.
            </Txt>
          </View>
        </View>
      </ScrollView>

      {/* Primary action in the bottom third, within one-handed reach. */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + space.md }]}>
        <Button label="Get started" onPress={() => router.push("/onboarding/phone")} />
        <Button label="I want to ride for Gera" variant="quiet" compact onPress={() => setRiderInfo(true)} />
      </View>

      <Modal visible={riderInfo} transparent animationType="slide" onRequestClose={() => setRiderInfo(false)}>
        <Pressable style={styles.backdrop} onPress={() => setRiderInfo(false)}>
          <Pressable>
            <Paper>
              <View style={styles.sheet}>
                <Txt v="title">Ride for Gera</Txt>
                <Txt v="body" tone="muted">
                  Riders use a separate app, Gera Rider. We provide the vehicle - you don't buy it,
                  fuel it or fix it.
                </Txt>
                <Txt v="body" tone="muted">
                  You collect fares in cash and hand them in, and your share of every trip is paid to
                  you on a fixed schedule. You'll need a valid licence and a national ID.
                </Txt>
                <Button label="Got it" onPress={() => setRiderInfo(false)} />
              </View>
            </Paper>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  root: { flex: 1, backgroundColor: c.surface },
  scroll: { paddingBottom: space.lg },
  body: { paddingHorizontal: space.lg, marginTop: space.md },
  wordmark: { fontFamily: font.numBold, fontSize: 72, lineHeight: 74, letterSpacing: -1 },
  promises: { marginTop: space.xl, gap: space.lg },
  promise: { flexDirection: "row", gap: space.md },
  bullet: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: c.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  pinDemo: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    marginTop: space.xl,
    padding: space.md,
    borderRadius: 16,
    backgroundColor: c.surfaceRaised,
  },
  footer: { paddingHorizontal: space.lg, paddingTop: space.md, gap: space.xs, backgroundColor: c.surface },
  backdrop: { flex: 1, backgroundColor: "rgba(11,13,18,0.45)", justifyContent: "flex-end" },
  sheet: { gap: space.md },
});
