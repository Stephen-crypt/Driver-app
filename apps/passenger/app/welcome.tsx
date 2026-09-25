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
import { theme, tokens } from "@gera/ui";

const PROMISES = [
  {
    title: "The price before you go",
    body: "You agree the fare before you book. No meter, no argument at the end.",
  },
  {
    title: "Moto first",
    body: "The fastest way through Kigali traffic, and the one most people take.",
  },
  {
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
        {/* contain, not cover: the illustration is 16:9 and cover was cropping
            it to its left third, hiding the moto and the hill entirely. */}
        <Image
          source={require("../assets/welcome-hero.jpg")}
          style={styles.hero}
          resizeMode="contain"
          accessible
          accessibilityLabel="A moto climbing a winding road through the Kigali hills at night"
        />

        <View style={styles.brandBlock}>
          <Text style={styles.wordmark}>Gera</Text>
          {/* kugera: to arrive, to reach. The name is the promise. */}
          <Text style={styles.tagline}>Gera. Get there.</Text>
        </View>

        <View style={styles.promises}>
          {PROMISES.map((p) => (
            <View key={p.title} style={styles.promise}>
              <View style={styles.bullet} />
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
          <View style={styles.sheet}>
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
            <Text style={styles.sheetBody}>
              You keep the cash you collect. Our commission comes out of a wallet you
              top up, so you're never short at the end of a trip.
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
  hero: {
    width: "100%",
    aspectRatio: 16 / 9,
    // Capped so it cannot eat a tall screen and push the wordmark and the
    // promises below the fold, which is what it was doing.
    maxHeight: 220,
  },
  brandBlock: {
    paddingHorizontal: tokens.space.xl,
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
  promises: { paddingHorizontal: tokens.space.xl, gap: tokens.space.lg },
  promise: { flexDirection: "row", gap: tokens.space.md },
  bullet: {
    width: 10,
    height: 10,
    borderRadius: tokens.radius.pill,
    backgroundColor: theme.accent,
    marginTop: 7,
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
    paddingHorizontal: tokens.space.xl,
    paddingTop: tokens.space.md,
    gap: tokens.space.sm,
  },
  cta: {
    minHeight: tokens.MIN_TOUCH_TARGET + 8,
    backgroundColor: theme.accent,
    borderRadius: tokens.radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: {
    fontSize: tokens.type.title.size,
    fontWeight: "700",
    color: theme.onAccent,
  },
  ghost: {
    minHeight: tokens.MIN_TOUCH_TARGET,
    alignItems: "center",
    justifyContent: "center",
  },
  ghostText: { fontSize: tokens.type.body.size, color: theme.textMuted },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: theme.surfaceRaised,
    borderTopLeftRadius: tokens.radius.lg,
    borderTopRightRadius: tokens.radius.lg,
    padding: tokens.space.xl,
    paddingTop: tokens.space.md,
    gap: tokens.space.md,
  },
  grabber: {
    alignSelf: "center",
    width: 44,
    height: 5,
    borderRadius: tokens.radius.pill,
    backgroundColor: theme.textMuted,
    opacity: 0.35,
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
