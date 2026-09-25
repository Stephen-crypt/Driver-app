import { useState } from "react";
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme, tokens } from "@gera/ui";

const PROMISES: readonly {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
}[] = [
  {
    icon: "pricetag-outline",
    title: "The price before you go",
    body: "You agree the fare before you book. No meter, no argument at the end.",
  },
  {
    icon: "bicycle-outline",
    title: "Moto first",
    body: "The fastest way through Kigali traffic, and the one most people take.",
  },
  {
    icon: "cash-outline",
    title: "Pay in cash",
    body: "Hand it to your rider when you arrive. Mobile money is coming.",
  },
];

export default function Welcome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [riderInfo, setRiderInfo] = useState(false);

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Boxed in a rounded frame: the art is drawn on a near-white sky
            that is a shade off the page ground, and without an edge the top of
            the picture dissolves into the screen and reads as a layout gap. */}
        <View style={styles.heroFrame}>
          <Image
            source={require("../assets/welcome-hero.jpg")}
            style={styles.hero}
            resizeMode="cover"
          accessible
            accessibilityLabel="A moto carrying a passenger along a winding road through terraced green hills"
          />
        </View>

        <View style={styles.brandBlock}>
          <Text style={styles.wordmark}>Gera</Text>
          {/* kugera: to arrive, to reach. The name is the promise. */}
          <Text style={styles.tagline}>Gera. Get there.</Text>
        </View>

        <View style={styles.promises}>
          {PROMISES.map((p) => (
            <View key={p.title} style={styles.promise}>
              <View style={styles.bullet}>
                <Ionicons name={p.icon} size={18} color={theme.accent} />
              </View>
              <View style={styles.flex}>
                <Text style={styles.promiseTitle}>{p.title}</Text>
                <Text style={styles.promiseBody}>{p.body}</Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* Primary action in the bottom third, within one-handed reach. */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + tokens.space.lg }]}>
        <Pressable
          style={styles.cta}
          onPress={() => router.push("/onboarding/phone")}
          accessibilityRole="button"
        >
          <Text style={styles.ctaText}>Get started</Text>
        </Pressable>

        <Pressable
          style={styles.ghost}
          onPress={() => setRiderInfo(true)}
          accessibilityRole="button"
        >
          <Text style={styles.ghostText}>I want to drive with Gera</Text>
        </Pressable>
      </View>

      <Modal
        visible={riderInfo}
        transparent
        animationType="slide"
        onRequestClose={() => setRiderInfo(false)}
      >
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + tokens.space.xl }]}>
            <View style={styles.grabber} />
            <Text style={styles.sheetTitle}>Drive with Gera</Text>
            <Text style={styles.sheetBody}>
              Driving uses a separate app, Gera Rider, so your map and your earnings
              never get in the way of each other.
            </Text>
            <Text style={styles.sheetBody}>
              You'll need a valid licence, your vehicle's papers, and a national ID. We
              check them before you can take your first trip.
            </Text>
            {/* This used to say the rider keeps the cash and tops up a wallet we
                take commission from. That was the marketplace Gera is not: we own
                the vehicles, so the fare is company money from the moment it is
                collected. Getting this wrong here sets up an argument on a kerb. */}
            <Text style={styles.sheetBody}>
              We provide the vehicle. You collect fares in cash and hand them in, and
              your share of every completed trip is paid to you on a fixed schedule.
            </Text>
            <Pressable style={styles.cta} onPress={() => setRiderInfo(false)}>
              <Text style={styles.ctaText}>Got it</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.surface },
  flex: { flex: 1 },
  content: { paddingBottom: tokens.space.lg },
  heroFrame: {
    marginHorizontal: tokens.space.lg,
    borderRadius: tokens.radius.xl,
    overflow: "hidden",
    backgroundColor: theme.surfaceHigh,
  },
  hero: {
    width: "100%",
    aspectRatio: 16 / 9,
    // Capped so it cannot eat a tall screen and push the wordmark and the
    // promises below the fold, which is what it was doing.
    maxHeight: 200,
  },
  brandBlock: {
    paddingHorizontal: tokens.space.lg,
    marginTop: tokens.space.md,
    marginBottom: tokens.space.lg,
  },
  wordmark: {
    fontSize: 48,
    fontWeight: "700",
    letterSpacing: -2,
    color: theme.textStrong,
  },
  tagline: {
    marginTop: tokens.space.xs,
    fontSize: tokens.type.title.size,
    color: theme.accent,
    fontWeight: "600",
  },
  promises: { paddingHorizontal: tokens.space.lg, gap: tokens.space.lg },
  promise: { flexDirection: "row", gap: tokens.space.md },
  bullet: {
    width: 34,
    height: 34,
    borderRadius: tokens.radius.sm,
    backgroundColor: theme.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  promiseTitle: {
    fontSize: tokens.type.body.size,
    fontWeight: "700",
    color: theme.textStrong,
  },
  promiseBody: {
    marginTop: 2,
    fontSize: tokens.type.body.size,
    lineHeight: tokens.type.body.leading,
    color: theme.textMuted,
  },
  footer: {
    paddingHorizontal: tokens.space.lg,
    paddingTop: tokens.space.md,
    gap: tokens.space.sm,
    backgroundColor: theme.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.border,
  },
  cta: {
    minHeight: tokens.MIN_TOUCH_TARGET + 8,
    backgroundColor: theme.accent,
    borderRadius: tokens.radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: {
    fontSize: tokens.type.body.size + 2,
    fontWeight: "700",
    color: theme.onAccent,
  },
  ghost: {
    minHeight: tokens.MIN_TOUCH_TARGET,
    alignItems: "center",
    justifyContent: "center",
  },
  ghostText: { fontSize: tokens.type.body.size, color: theme.textMuted },
  backdrop: { flex: 1, backgroundColor: "rgba(11,13,18,0.45)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: theme.surfaceRaised,
    borderTopLeftRadius: tokens.radius.xl,
    borderTopRightRadius: tokens.radius.xl,
    padding: tokens.space.lg,
    paddingTop: tokens.space.md,
    gap: tokens.space.md,
  },
  grabber: {
    alignSelf: "center",
    width: 44,
    height: 5,
    borderRadius: tokens.radius.pill,
    backgroundColor: theme.border,
    marginBottom: tokens.space.sm,
  },
  sheetTitle: {
    fontSize: tokens.type.title.size,
    fontWeight: "700",
    color: theme.textStrong,
  },
  sheetBody: {
    fontSize: tokens.type.body.size,
    lineHeight: tokens.type.body.leading,
    color: theme.textMuted,
  },
});
