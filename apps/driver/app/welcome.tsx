import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme, tokens } from "@gera/ui";

/**
 * What a driver actually wants to know before they sign up, in the order they
 * ask it: what do I earn, when do I get it, and what does it cost me. Anything
 * about the app itself comes after.
 */
const TERMS = [
  {
    title: "You keep the cash",
    body: "Riders pay you directly at the end of every trip. Nothing waits for a payout.",
  },
  {
    title: "Commission comes from your wallet",
    body: "Top the wallet up, and our share is taken from it after each trip — never out of the fare in your hand.",
  },
  {
    title: "You see the fare before you accept",
    body: "Pickup, drop-off and the exact amount, before you commit to the trip.",
  },
];

export default function DriverWelcome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top }]}
        showsVerticalScrollIndicator={false}
      >
        <Image
          source={require("../assets/welcome-hero.jpg")}
          style={styles.hero}
          resizeMode="contain"
          accessible
          accessibilityLabel="A moto rider in a numbered safety vest looking down a road through the hills at sunrise"
        />

        <View style={styles.brandBlock}>
          <Text style={styles.wordmark}>Gera Driver</Text>
          <Text style={styles.tagline}>Your road, your earnings.</Text>
        </View>

        <View style={styles.terms}>
          {TERMS.map((t) => (
            <View key={t.title} style={styles.term}>
              <View style={styles.bullet} />
              <View style={styles.flex}>
                <Text style={styles.termTitle}>{t.title}</Text>
                <Text style={styles.termBody}>{t.body}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Said plainly here rather than discovered at the end of onboarding. */}
        <Text style={styles.requirements}>
          You'll need a valid licence, your vehicle's papers and a national ID. We check
          them before your first trip.
        </Text>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + tokens.space.lg }]}>
        <Pressable
          style={styles.cta}
          onPress={() => router.push("/onboarding/phone")}
          accessibilityRole="button"
        >
          <Text style={styles.ctaText}>Start driving</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.surface },
  flex: { flex: 1 },
  content: { paddingBottom: tokens.space.lg },
  hero: { width: "100%", aspectRatio: 16 / 9, maxHeight: 220 },
  brandBlock: {
    paddingHorizontal: tokens.space.xl,
    marginTop: tokens.space.lg,
    marginBottom: tokens.space.xl,
  },
  wordmark: {
    fontSize: 42,
    fontWeight: "700",
    letterSpacing: -1.5,
    color: theme.textStrong,
  },
  tagline: {
    marginTop: tokens.space.xs,
    fontSize: tokens.type.title.size,
    color: theme.accent,
    fontWeight: "600",
  },
  terms: { paddingHorizontal: tokens.space.xl, gap: tokens.space.lg },
  term: { flexDirection: "row", gap: tokens.space.md },
  bullet: {
    width: 10,
    height: 10,
    borderRadius: tokens.radius.pill,
    backgroundColor: theme.accent,
    marginTop: 7,
  },
  termTitle: {
    fontSize: tokens.type.body.size,
    fontWeight: "700",
    color: theme.textStrong,
  },
  termBody: {
    marginTop: 2,
    fontSize: tokens.type.body.size,
    lineHeight: tokens.type.body.leading,
    color: theme.textMuted,
  },
  requirements: {
    marginTop: tokens.space.xl,
    marginHorizontal: tokens.space.xl,
    padding: tokens.space.md,
    borderRadius: tokens.radius.md,
    backgroundColor: theme.surfaceRaised,
    fontSize: tokens.type.body.size,
    lineHeight: tokens.type.body.leading,
    color: theme.textMuted,
  },
  footer: { paddingHorizontal: tokens.space.xl, paddingTop: tokens.space.md },
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
});
