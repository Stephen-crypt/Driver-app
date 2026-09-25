import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme, tokens } from "@gera/ui";
import { EMERGENCY_NUMBER } from "@gera/data";

const SAFETY = [
  {
    title: "Check the plate before you get in",
    body: "The plate and your driver's name are on your trip screen. If they don't match the vehicle in front of you, don't get in.",
  },
  {
    title: "Share your trip",
    body: "On any live trip, tap Share. It sends where you're going, who's driving and their plate to whoever you choose.",
  },
  {
    title: "The price doesn't change",
    body: "What you agreed before booking is what you pay. If a driver asks for more, that's not a Gera fare — tell us.",
  },
  {
    title: "Pay in cash, at the end",
    body: "Never pay before the trip. Your driver collects when you arrive.",
  },
];

const FAQ = [
  {
    q: "Why can't I go past 'Finding you a driver'?",
    a: "There may be nobody free nearby. We try three drivers before telling you so. Wait a few minutes and book again.",
  },
  {
    q: "My driver cancelled. Am I charged?",
    a: "No. Nothing is charged until a trip completes, and cash means nothing leaves your pocket until you hand it over.",
  },
  {
    q: "Can I pay with MTN MoMo?",
    a: "Not yet. Cash is the only method that settles today — we'd rather say so than take a payment we can't complete.",
  },
  {
    q: "Where does my money go?",
    a: "All of it goes to your driver, in cash. Gera takes its commission from a wallet the driver tops up separately.",
  },
];

export default function Help() {
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + tokens.space.md, paddingBottom: insets.bottom + tokens.space.xl },
      ]}
    >
      <Text style={styles.title}>Help and safety</Text>

      {/* First, because someone opening this screen in a hurry is not here to
          read a FAQ. */}
      <Pressable
        style={styles.emergency}
        onPress={() => Linking.openURL(`tel:${EMERGENCY_NUMBER}`)}
        accessibilityRole="button"
      >
        <Text style={styles.emergencyTitle}>Call {EMERGENCY_NUMBER}</Text>
        <Text style={styles.emergencyBody}>Rwanda emergency services</Text>
      </Pressable>

      <Text style={styles.section}>Staying safe</Text>
      {SAFETY.map((s) => (
        <View key={s.title} style={styles.card}>
          <Text style={styles.cardTitle}>{s.title}</Text>
          <Text style={styles.cardBody}>{s.body}</Text>
        </View>
      ))}

      <Text style={styles.section}>Common questions</Text>
      {FAQ.map((f) => (
        <View key={f.q} style={styles.card}>
          <Text style={styles.cardTitle}>{f.q}</Text>
          <Text style={styles.cardBody}>{f.a}</Text>
        </View>
      ))}

      {/* Said plainly rather than implied by a support button that goes
          nowhere. A promise of help nobody answers is worse than none. */}
      <Text style={styles.footnote}>
        Gera does not have a 24-hour support line yet. For anything urgent during a
        trip, use the Help button on your trip screen — it records your location and
        who you're with — and call {EMERGENCY_NUMBER} if you're in danger.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.surface },
  content: { paddingHorizontal: tokens.space.lg },
  title: {
    fontSize: tokens.type.title.size,
    fontWeight: "700",
    color: theme.textStrong,
    marginBottom: tokens.space.lg,
  },
  emergency: {
    padding: tokens.space.lg,
    borderRadius: tokens.radius.lg,
    borderWidth: 2,
    borderColor: theme.danger,
    backgroundColor: theme.surfaceRaised,
  },
  emergencyTitle: {
    fontSize: tokens.type.title.size,
    fontWeight: "700",
    color: theme.danger,
  },
  emergencyBody: { fontSize: tokens.type.body.size, color: theme.textMuted },
  section: {
    marginTop: tokens.space.xl,
    marginBottom: tokens.space.sm,
    fontSize: tokens.type.label.size,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: theme.textMuted,
  },
  card: {
    padding: tokens.space.md,
    marginBottom: tokens.space.sm,
    borderRadius: tokens.radius.md,
    backgroundColor: theme.surfaceRaised,
  },
  cardTitle: {
    fontSize: tokens.type.body.size,
    fontWeight: "700",
    color: theme.textStrong,
  },
  cardBody: {
    marginTop: tokens.space.xs,
    fontSize: tokens.type.body.size,
    lineHeight: tokens.type.body.leading,
    color: theme.textMuted,
  },
  footnote: {
    marginTop: tokens.space.xl,
    fontSize: tokens.type.label.size,
    lineHeight: 20,
    color: theme.textMuted,
  },
});
