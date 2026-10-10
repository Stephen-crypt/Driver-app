import { ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Press, Txt, c, radius, shadow, space, type IconName } from "@nova/kit";

const CARDS: readonly { icon: IconName; title: string; body: string; ground: string; ink: string }[] = [
  {
    icon: "keypad",
    title: "A PIN on every ride",
    body: "Your rider can't start the trip until you give them your four numbers.",
    ground: c.tintYellow,
    ink: c.accent,
  },
  {
    icon: "shield-checkmark",
    title: "Check the vest and plate",
    body: "Both are on your trip screen. If they don't match, don't get on.",
    ground: c.tintBlue,
    ink: c.accent,
  },
  {
    icon: "share-social",
    title: "Share your trip",
    body: "Send your route, rider and plate to someone from the Safety button.",
    ground: c.tintGreen,
    ink: c.success,
  },
  {
    icon: "pricetag",
    title: "The price is fixed",
    body: "What you agree when you book is what you pay. Only waiting adds to it.",
    ground: c.tintAmber,
    ink: c.warning,
  },
];

/**
 * Four things that make a Nova ride safe, as a strip of cards to swipe. Each
 * is true of every trip, and each opens the help page that says more.
 */
export function SafetyCards({ onOpen }: { readonly onOpen: () => void }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      snapToInterval={CARD + space.sm + 4}
      decelerationRate="fast"
      style={styles.strip}
      contentContainerStyle={styles.row}
    >
      {CARDS.map((k) => (
        <Press key={k.title} onPress={onOpen} scaleTo={0.97} style={styles.card} accessibilityRole="button" accessibilityLabel={`${k.title}. ${k.body}`}>
          <View style={[styles.well, { backgroundColor: k.ground }]}>
            <Ionicons name={k.icon} size={20} color={k.ink} />
          </View>
          <Txt v="bodyStrong">{k.title}</Txt>
          <Txt v="label" tone="muted" lines={3}>
            {k.body}
          </Txt>
        </Press>
      ))}
    </ScrollView>
  );
}

const CARD = 236;

const styles = StyleSheet.create({
  // The strip bleeds to the screen's edges, so it reads as something to swipe.
  strip: { marginHorizontal: -space.lg },
  row: { gap: space.sm + 4, paddingHorizontal: space.lg, paddingVertical: space.sm },
  card: {
    width: CARD,
    gap: space.xs,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: c.surfaceRaised,
    ...shadow.card,
  },
  well: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center", marginBottom: space.xs },
});
