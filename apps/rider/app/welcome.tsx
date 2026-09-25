import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme, tokens } from "@gera/ui";

/**
 * What a rider actually wants to know before they sign up, in the order they
 * ask it: whose vehicle, what do I earn, and what happens to the cash.
 *
 * The version this replaces described a marketplace - the rider keeping the
 * fare and topping up a wallet we took commission from. Gera owns the vehicles,
 * so every one of those sentences was the opposite of true. This is the screen
 * a rider reads before they agree to anything, and a rider who believes the
 * cash in their pocket is theirs will spend it.
 */
const TERMS: readonly {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
}[] = [
  {
    icon: "key-outline",
    title: "The vehicle is ours",
    body: "You do not buy it, fuel it or fix it. We hand you a working vehicle and you ride.",
  },
  {
    icon: "eye-outline",
    title: "You see the fare before you accept",
    body: "Pickup, drop-off and the exact amount, before you commit to the trip.",
  },
  {
    icon: "wallet-outline",
    title: "You earn a share of every fare",
    body: "Your share of each completed trip is yours, and we pay it out on a fixed schedule.",
  },
  {
    icon: "swap-horizontal-outline",
    title: "The cash you collect is handed in",
    body: "Passengers pay cash, and that money is the company’s from the moment it reaches your hand. What you carry and what you are owed are two separate numbers, and the app shows you both.",
  },
];

export default function RiderWelcome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

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
            accessibilityLabel="A rider in a numbered safety vest standing beside their motorbike, looking down a road through the hills"
          />
        </View>

        <View style={styles.brandBlock}>
          <Text style={styles.wordmark}>Gera Rider</Text>
          <Text style={styles.tagline}>Your road, your earnings.</Text>
        </View>

        <View style={styles.terms}>
          {TERMS.map((t) => (
            <View key={t.title} style={styles.term}>
              <View style={styles.bullet}>
                <Ionicons name={t.icon} size={18} color={theme.accent} />
              </View>
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
  heroFrame: {
    marginHorizontal: tokens.space.lg,
    borderRadius: tokens.radius.xl,
    overflow: "hidden",
    backgroundColor: theme.surfaceHigh,
  },
  hero: { width: "100%", aspectRatio: 16 / 9, maxHeight: 200 },
  brandBlock: {
    paddingHorizontal: tokens.space.lg,
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
  terms: { paddingHorizontal: tokens.space.lg, gap: tokens.space.lg },
  term: { flexDirection: "row", gap: tokens.space.md },
  bullet: {
    width: 34,
    height: 34,
    borderRadius: tokens.radius.sm,
    backgroundColor: theme.accentSoft,
    alignItems: "center",
    justifyContent: "center",
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
    marginHorizontal: tokens.space.lg,
    padding: tokens.space.md,
    borderRadius: tokens.radius.md,
    backgroundColor: theme.surfaceRaised,
    fontSize: tokens.type.body.size,
    lineHeight: tokens.type.body.leading,
    color: theme.textMuted,
  },
  footer: {
    paddingHorizontal: tokens.space.lg,
    paddingTop: tokens.space.md,
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
});
