import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import {
  Button,
  Enter,
  ImigongoBand,
  ModalSheet,
  PinPatches,
  Txt,
  Well,
  c,
  ease,
  font,
  space,
  type IconName,
} from "@nova/kit";

const PROMISES: readonly { icon: IconName; title: string; body: string }[] = [
  {
    icon: "pricetag",
    title: "The price before you go",
    body: "You agree the fare before you book. No meter, no argument at the end.",
  },
  {
    icon: "keypad",
    title: "A PIN on every trip",
    body: "Your rider can't start until you give them your four numbers. It's how you both know it's the right ride.",
  },
  {
    icon: "cash",
    title: "Pay in cash, at the end",
    body: "Hand it to your rider when you arrive. Mobile money is coming.",
  },
];

/**
 * The one screen with an orchestrated entrance, because it is seen once: the
 * picture settles, the name rises, the promises follow, and the demo PIN turns
 * into place exactly as a real one will on the trip screen.
 */
export default function Welcome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const reduce = useReducedMotion();
  const [riderInfo, setRiderInfo] = useState(false);

  const settle = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    if (!reduce) settle.set(withTiming(1, { duration: 900, easing: ease.out }));
  }, [reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  const hero = useAnimatedStyle(() => ({ opacity: settle.get(), transform: [{ scale: 1.05 - 0.05 * settle.get() }] }));

  return (
    <View style={styles.root}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Full width at its own proportions. The sky is within a shade of the
            page ground, so the picture needs no frame to sit on it. */}
        <View style={[styles.heroFrame, { marginTop: insets.top + space.lg }]}>
          <Animated.Image
            source={require("../assets/welcome-hero.jpg")}
            style={[{ width, height: (width * 714) / 1280 }, hero]}
            resizeMode="cover"
            accessible
            accessibilityLabel="A moto carrying a passenger along a winding road through terraced green hills"
          />
        </View>
        <ImigongoBand height={22} opacity={0.2} style={styles.band} />

        <View style={styles.body}>
          <Enter i={2}>
            <Txt v="hero" style={styles.wordmark}>
              Nova
            </Txt>
          </Enter>
          <Enter i={3}>
            <Txt v="heading" tone="muted">
              Motos and cabs across Kigali, at a price agreed before you go.
            </Txt>
          </Enter>

          <View style={styles.promises}>
            {PROMISES.map((p, i) => (
              <Enter key={p.title} i={4 + i} style={styles.promise}>
                <Well icon={p.icon} />
                <View style={styles.flex}>
                  <Txt v="bodyStrong">{p.title}</Txt>
                  <Txt v="body" tone="muted">
                    {p.body}
                  </Txt>
                </View>
              </Enter>
            ))}
          </View>

          {/* The PIN, shown the way it will look on the trip screen - the one
              piece of Nova a first-time passenger has never seen before. */}
          <Enter i={7} style={styles.pinDemo}>
            <PinPatches pin="4821" size="sm" roll />
            <Txt v="label" tone="muted" style={styles.flex}>
              Your PIN appears like this once a rider accepts.
            </Txt>
          </Enter>
        </View>
      </ScrollView>

      {/* Primary action in the bottom third, within one-handed reach. */}
      <Enter i={8} style={[styles.footer, { paddingBottom: insets.bottom + space.md }]}>
        <Button label="Get started" onPress={() => router.push("/onboarding/phone")} />
        <Button label="I want to ride for Nova" variant="quiet" compact onPress={() => setRiderInfo(true)} />
      </Enter>

      <ModalSheet visible={riderInfo} onClose={() => setRiderInfo(false)} title="Ride for Nova">
        <View style={styles.sheet}>
          <View style={styles.fact}>
            <Ionicons name="key" size={18} color={c.accent} />
            <Txt v="body" tone="muted" style={styles.flex}>
              Riders use a separate app, Nova Rider. We provide the vehicle: you don't buy it, fuel it or fix it.
            </Txt>
          </View>
          <View style={styles.fact}>
            <Ionicons name="wallet" size={18} color={c.accent} />
            <Txt v="body" tone="muted" style={styles.flex}>
              You collect fares in cash and hand them in. Your share of every trip is paid to you on a fixed schedule.
            </Txt>
          </View>
          <View style={styles.fact}>
            <Ionicons name="document-text" size={18} color={c.accent} />
            <Txt v="body" tone="muted" style={styles.flex}>
              You'll need a valid driving licence and a national ID.
            </Txt>
          </View>
          <Button label="Got it" onPress={() => setRiderInfo(false)} />
        </View>
      </ModalSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  root: { flex: 1, backgroundColor: c.surface },
  scroll: { paddingBottom: space.lg },
  heroFrame: { overflow: "hidden" },
  band: { marginTop: space.sm },
  body: { paddingHorizontal: space.lg, marginTop: space.sm },
  wordmark: { fontFamily: font.numBold, fontSize: 72, lineHeight: 74, letterSpacing: -1 },
  promises: { marginTop: space.xl, gap: space.lg },
  promise: { flexDirection: "row", gap: space.md },
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
  sheet: { gap: space.md },
  fact: { flexDirection: "row", gap: space.md, alignItems: "flex-start" },
});
