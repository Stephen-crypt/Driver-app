import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { lightTheme, palette, tokens } from "@gera/ui";

const PROMISES = [
  {
    title: "The price before you go",
    body: "You see the fare and agree to it before you book. No meter, no argument at the end.",
  },
  {
    title: "Moto first",
    body: "The fastest way through Kigali traffic, and the one most people actually take.",
  },
  {
    title: "Pay in cash",
    body: "Hand it to your driver when you arrive. Mobile money is coming.",
  },
];

export default function Welcome() {
  const router = useRouter();
  const [driverInfo, setDriverInfo] = useState(false);

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
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
      <View style={styles.footer}>
        <Pressable
          style={styles.cta}
          onPress={() => router.push("/onboarding/phone")}
          accessibilityRole="button"
        >
          <Text style={styles.ctaText}>Get started</Text>
        </Pressable>

        <Pressable
          style={styles.ghost}
          onPress={() => setDriverInfo(true)}
          accessibilityRole="button"
        >
          <Text style={styles.ghostText}>I want to drive with Gera</Text>
        </Pressable>
      </View>

      <Modal
        visible={driverInfo}
        transparent
        animationType="slide"
        onRequestClose={() => setDriverInfo(false)}
      >
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Drive with Gera</Text>
            <Text style={styles.sheetBody}>
              Driving uses a separate app, Gera Driver, so your map and your earnings
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
            <Pressable style={styles.cta} onPress={() => setDriverInfo(false)}>
              <Text style={styles.ctaText}>Got it</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  // Indigo ground: this is the one screen that is pure brand.
  root: { flex: 1, backgroundColor: palette.indigo900 },
  flex: { flex: 1 },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    padding: tokens.space.xl,
    paddingTop: tokens.space.xxl * 2,
  },
  brandBlock: { marginBottom: tokens.space.xxl },
  wordmark: {
    fontSize: 64,
    fontWeight: "700",
    letterSpacing: -2,
    color: palette.white,
  },
  tagline: {
    marginTop: tokens.space.sm,
    fontSize: tokens.type.title.size,
    color: palette.amber500,
    fontWeight: "600",
  },
  promises: { gap: tokens.space.lg },
  promise: { flexDirection: "row", gap: tokens.space.md },
  bullet: {
    width: 10,
    height: 10,
    borderRadius: tokens.radius.pill,
    backgroundColor: palette.amber500,
    marginTop: 7,
  },
  promiseTitle: {
    fontSize: tokens.type.body.size,
    fontWeight: "700",
    color: palette.white,
  },
  promiseBody: {
    marginTop: 2,
    fontSize: tokens.type.body.size,
    lineHeight: tokens.type.body.leading,
    color: palette.indigo300,
  },
  footer: {
    padding: tokens.space.xl,
    paddingTop: tokens.space.lg,
    gap: tokens.space.sm,
  },
  cta: {
    minHeight: tokens.MIN_TOUCH_TARGET + 8,
    backgroundColor: palette.amber500,
    borderRadius: tokens.radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: {
    fontSize: tokens.type.title.size,
    fontWeight: "700",
    color: palette.indigo900,
  },
  ghost: {
    minHeight: tokens.MIN_TOUCH_TARGET,
    alignItems: "center",
    justifyContent: "center",
  },
  ghostText: { fontSize: tokens.type.body.size, color: palette.indigo300 },
  backdrop: { flex: 1, backgroundColor: "rgba(11,16,34,0.6)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: lightTheme.surfaceRaised,
    borderTopLeftRadius: tokens.radius.lg,
    borderTopRightRadius: tokens.radius.lg,
    padding: tokens.space.xl,
    gap: tokens.space.md,
  },
  sheetTitle: {
    fontSize: tokens.type.title.size,
    fontWeight: "700",
    color: lightTheme.textStrong,
  },
  sheetBody: {
    fontSize: tokens.type.body.size,
    lineHeight: tokens.type.body.leading,
    color: lightTheme.textMuted,
  },
});
