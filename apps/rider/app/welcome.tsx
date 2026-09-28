import { useEffect } from "react";
import { ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { Button, Enter, ImigongoBand, Txt, VestPatch, Well, c, ease, font, radius, space, type IconName } from "@nova/kit";

/**
 * What a rider actually wants to know before they sign up, in the order they
 * ask it: whose vehicle, what do I earn, and what happens to the cash.
 *
 * Nova owns the vehicles. A rider who believes the cash in their pocket is
 * theirs will spend it, so this screen says otherwise before they agree to
 * anything.
 */
const TERMS: readonly { icon: IconName; title: string; body: string }[] = [
  {
    icon: "key",
    title: "The vehicle is ours",
    body: "You don't buy it, fuel it or fix it. We hand you a working vehicle and you ride.",
  },
  {
    icon: "eye",
    title: "You see the fare before you accept",
    body: "Pickup, drop-off and the exact amount, before you commit to the trip.",
  },
  {
    icon: "wallet",
    title: "You earn a share of every fare",
    body: "Your share of each completed trip is yours, paid out on a fixed schedule.",
  },
  {
    icon: "swap-horizontal",
    title: "The cash you collect is handed in",
    body: "Passengers pay cash, and it is the company's from the moment it reaches your hand. The app always shows what you're carrying and what you're owed, separately.",
  },
];

export default function RiderWelcome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const reduce = useReducedMotion();

  const settle = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    if (!reduce) settle.set(withTiming(1, { duration: 900, easing: ease.out }));
  }, [reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  const hero = useAnimatedStyle(() => ({ opacity: settle.get(), transform: [{ scale: 1.05 - 0.05 * settle.get() }] }));

  return (
    <View style={styles.root}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Full width at its own proportions. Cropped to a taller box it lost
            the rider off the left edge on a narrow phone - and the rider is
            the picture. */}
        <View style={[styles.heroFrame, { marginTop: insets.top + space.lg }]}>
          <Animated.Image
            source={require("../assets/welcome-hero.jpg")}
            style={[{ width, height: (width * 714) / 1280 }, hero]}
            resizeMode="cover"
            accessible
            accessibilityLabel="A rider in a numbered safety vest standing beside their motorbike, looking down a road through the hills"
          />
        </View>
        <ImigongoBand height={22} opacity={0.2} style={styles.band} />

        <View style={styles.body}>
          <Enter i={2}>
            <Txt v="hero" style={styles.wordmark}>
              Nova Rider
            </Txt>
          </Enter>
          <Enter i={3}>
            <Txt v="heading" tone="muted">
              Ride a Nova vehicle. Earn on every trip.
            </Txt>
          </Enter>

          <View style={styles.terms}>
            {TERMS.map((t, i) => (
              <Enter key={t.title} i={4 + i} style={styles.term}>
                <Well icon={t.icon} />
                <View style={styles.flex}>
                  <Txt v="bodyStrong">{t.title}</Txt>
                  <Txt v="body" tone="muted">
                    {t.body}
                  </Txt>
                </View>
              </Enter>
            ))}
          </View>

          {/* The vest, shown the way passengers will see it - it is how a
              rider is found at a crowded stage. */}
          <Enter i={8} style={styles.vestDemo}>
            <VestPatch value="214" size="md" roll delay={200} />
            <Txt v="label" tone="muted" style={styles.flex}>
              You get a numbered vest. Passengers look for your number, so they get on the right moto.
            </Txt>
          </Enter>

          {/* Said plainly here rather than discovered at the end of onboarding. */}
          <Enter i={9} style={styles.needs}>
            <Ionicons name="document-text" size={18} color={c.textMuted} />
            <Txt v="label" tone="muted" style={styles.flex}>
              You'll need a valid licence and a national ID. We check them before your first shift.
            </Txt>
          </Enter>
        </View>
      </ScrollView>

      <Enter i={9} style={[styles.footer, { paddingBottom: insets.bottom + space.md }]}>
        <Button label="Get started" onPress={() => router.push("/onboarding/phone")} />
        <Button label="Staff sign in" variant="quiet" compact onPress={() => router.push("/staff-login")} />
      </Enter>
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
  wordmark: { fontFamily: font.numBold, fontSize: 60, lineHeight: 62, letterSpacing: -1 },
  terms: { marginTop: space.xl, gap: space.lg },
  term: { flexDirection: "row", gap: space.md },
  vestDemo: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    marginTop: space.xl,
    padding: space.md,
    borderRadius: radius.md + 4,
    backgroundColor: c.surfaceRaised,
  },
  needs: {
    flexDirection: "row",
    gap: space.sm,
    marginTop: space.md,
    padding: space.md,
    borderRadius: radius.md + 4,
    backgroundColor: c.surfaceRaised,
  },
  footer: { gap: space.xs, paddingHorizontal: space.lg, paddingTop: space.md, backgroundColor: c.surface },
});
