import { Image, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Button, Txt, c, font, space, type IconName } from "@gera/kit";

/**
 * What a rider actually wants to know before they sign up, in the order they
 * ask it: whose vehicle, what do I earn, and what happens to the cash.
 *
 * Gera owns the vehicles. A rider who believes the cash in their pocket is
 * theirs will spend it, so this screen says otherwise before they agree to
 * anything.
 */
const TERMS: readonly { icon: IconName; title: string; body: string }[] = [
  {
    icon: "key-outline",
    title: "The vehicle is ours",
    body: "You don't buy it, fuel it or fix it. We hand you a working vehicle and you ride.",
  },
  {
    icon: "eye-outline",
    title: "You see the fare before you accept",
    body: "Pickup, drop-off and the exact amount, before you commit to the trip.",
  },
  {
    icon: "wallet-outline",
    title: "You earn a share of every fare",
    body: "Your share of each completed trip is yours, paid out on a fixed schedule.",
  },
  {
    icon: "swap-horizontal-outline",
    title: "The cash you collect is handed in",
    body: "Passengers pay cash, and it is the company's from the moment it reaches your hand. The app always shows you what you're carrying and what you're owed, separately.",
  },
];

export default function RiderWelcome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  return (
    <View style={styles.root}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Full width at its own proportions. Cropped to a taller box it lost
            the rider off the left edge on a narrow phone - and the rider is
            the picture. The sky is within a shade of the page, so it needs no
            frame. */}
        <Image
          source={require("../assets/welcome-hero.jpg")}
          style={{ width, height: (width * 714) / 1280, marginTop: insets.top + space.lg }}
          resizeMode="cover"
          accessible
          accessibilityLabel="A rider in a numbered safety vest standing beside their motorbike, looking down a road through the hills"
        />

        <View style={styles.body}>
          <Txt v="hero" style={styles.wordmark}>
            Gera Rider
          </Txt>
          <Txt v="heading" tone="muted">
            Ride a Gera vehicle. Earn on every trip.
          </Txt>

          <View style={styles.terms}>
            {TERMS.map((t) => (
              <View key={t.title} style={styles.term}>
                <View style={styles.bullet}>
                  <Ionicons name={t.icon} size={19} color={c.accent} />
                </View>
                <View style={styles.flex}>
                  <Txt v="bodyStrong">{t.title}</Txt>
                  <Txt v="body" tone="muted">
                    {t.body}
                  </Txt>
                </View>
              </View>
            ))}
          </View>

          {/* Said plainly here rather than discovered at the end of onboarding. */}
          <View style={styles.needs}>
            <Ionicons name="document-text-outline" size={18} color={c.textMuted} />
            <Txt v="label" tone="muted" style={styles.flex}>
              You'll need a valid licence and a national ID. We check them before your first shift.
            </Txt>
          </View>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + space.md }]}>
        <Button label="Get started" onPress={() => router.push("/onboarding/phone")} />
        <Button label="Staff sign in" variant="quiet" compact onPress={() => router.push("/staff-login")} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  root: { flex: 1, backgroundColor: c.surface },
  scroll: { paddingBottom: space.lg },
  body: { paddingHorizontal: space.lg, marginTop: space.md },
  wordmark: { fontFamily: font.numBold, fontSize: 60, lineHeight: 62, letterSpacing: -1 },
  terms: { marginTop: space.xl, gap: space.lg },
  term: { flexDirection: "row", gap: space.md },
  bullet: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: c.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  needs: {
    flexDirection: "row",
    gap: space.sm,
    marginTop: space.xl,
    padding: space.md,
    borderRadius: 16,
    backgroundColor: c.surfaceRaised,
  },
  footer: {
    gap: 4,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    backgroundColor: c.surface,
  },
});
