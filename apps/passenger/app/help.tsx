import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme, tokens } from "@gera/ui";
import { EMERGENCY_NUMBER } from "@gera/data";
import { Card } from "../src/components/Card";

const SAFETY: readonly {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
}[] = [
  {
    icon: "car-outline",
    title: "Check the plate before you get in",
    body: "The plate and your rider's name are on your trip screen. If they don't match the vehicle in front of you, don't get in.",
  },
  {
    icon: "share-outline",
    title: "Share your trip",
    body: "On any live trip, tap Share. It sends where you're going, who's driving and their plate to whoever you choose.",
  },
  {
    icon: "pricetag-outline",
    title: "The price doesn't change",
    body: "What you agreed before booking is what you pay. If a rider asks for more, that's not a Gera fare — tell us.",
  },
  {
    icon: "cash-outline",
    title: "Pay in cash, at the end",
    body: "Never pay before the trip. Your rider collects when you arrive.",
  },
];

const FAQ = [
  {
    q: "Why can't I go past 'Finding you a rider'?",
    a: "There may be nobody free nearby. We try three riders before telling you so. Wait a few minutes and book again.",
  },
  {
    q: "My rider cancelled. Am I charged?",
    a: "No. Nothing is charged until a trip completes, and cash means nothing leaves your pocket until you hand it over.",
  },
  {
    q: "Can I pay with MTN MoMo?",
    a: "Not yet. Cash is the only method that settles today — we'd rather say so than take a payment we can't complete.",
  },
  {
    // The wallet answer this replaces described a marketplace, where the rider
    // owned the vehicle and paid Gera a commission. Gera owns the vehicles, so
    // the cash is the company's from the moment it is handed over.
    q: "Where does my money go?",
    a: "You hand the fare to your rider in cash. Gera owns the vehicles, so the rider passes that cash on to us and is paid separately for their work. You never pay Gera directly.",
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
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.title}>Help and safety</Text>

      {/* First, because someone opening this screen in a hurry is not here to
          read a FAQ. */}
      <Pressable
        style={styles.emergency}
        onPress={() => Linking.openURL(`tel:${EMERGENCY_NUMBER}`)}
        accessibilityRole="button"
      >
        <View style={styles.emergencyWell}>
          <Ionicons name="call" size={22} color={theme.onAccent} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.emergencyTitle}>Call {EMERGENCY_NUMBER}</Text>
          <Text style={styles.emergencyBody}>Rwanda emergency services</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={theme.danger} />
      </Pressable>

      <Text style={styles.section}>Staying safe</Text>
      {SAFETY.map((s) => (
        <Card key={s.title} style={styles.item}>
          <View style={styles.well}>
            <Ionicons name={s.icon} size={18} color={theme.accent} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.cardTitle}>{s.title}</Text>
            <Text style={styles.cardBody}>{s.body}</Text>
          </View>
        </Card>
      ))}

      <Text style={styles.section}>Common questions</Text>
      {FAQ.map((f) => (
        <Card key={f.q} style={styles.faq}>
          <Text style={styles.cardTitle}>{f.q}</Text>
          <Text style={styles.cardBody}>{f.a}</Text>
        </Card>
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
  flex: { flex: 1 },
  title: {
    fontSize: tokens.type.title.size,
    fontWeight: "700",
    color: theme.textStrong,
    marginBottom: tokens.space.lg,
  },
  emergency: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    padding: tokens.space.md,
    borderRadius: tokens.radius.lg,
    backgroundColor: theme.dangerSoft,
  },
  emergencyWell: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.danger,
    alignItems: "center",
    justifyContent: "center",
  },
  emergencyTitle: {
    fontSize: tokens.type.body.size + 2,
    fontWeight: "700",
    color: theme.danger,
  },
  emergencyBody: { fontSize: tokens.type.label.size, color: theme.danger },
  section: {
    marginTop: tokens.space.xl,
    marginBottom: tokens.space.sm,
    fontSize: tokens.type.label.size,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: theme.textMuted,
  },
  item: {
    flexDirection: "row",
    gap: tokens.space.sm,
    marginBottom: tokens.space.sm,
  },
  well: {
    width: 32,
    height: 32,
    borderRadius: tokens.radius.sm,
    backgroundColor: theme.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  faq: { marginBottom: tokens.space.sm },
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
