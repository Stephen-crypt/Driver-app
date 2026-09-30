import { StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Chip, Press, RouteRail, Txt, c, font, money, radius, shadow, space, type ChipTone } from "@nova/kit";
import { statusFor } from "@nova/ui";
import { isTripLive, tripTime, type TripHistoryItem } from "@nova/data";

const TONE: Record<string, ChipTone> = { success: "good", danger: "bad", muted: "neutral" };

/**
 * One trip as a card: when, how it ended, what it cost, the route, and the two
 * things people do from history - look at the receipt, or go there again.
 */
export function TripCard({
  trip,
  onOpen,
  onAgain,
}: {
  readonly trip: TripHistoryItem;
  readonly onOpen: () => void;
  readonly onAgain: () => void;
}) {
  const s = statusFor(trip.state);
  const done = trip.state === "completed";
  const live = isTripLive(trip.state);
  const time = new Date(tripTime(trip)).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

  return (
    <View style={styles.card}>
      <Press
        onPress={onOpen}
        scaleTo={1}
        bg={c.surfaceRaised}
        pressedBg={c.surfaceHigh}
        style={styles.body}
        accessibilityRole="button"
        accessibilityLabel={`${time}, ${trip.pickupLabel} to ${trip.dropoffLabel}, ${s.label}${done && trip.fareRwf !== null ? `, ${money(trip.fareRwf)} Rwandan francs` : ""}`}
      >
        <View style={styles.head}>
          <Txt v="bodyStrong" tabularNums>
            {time}
          </Txt>
          <Chip label={s.label} tone={live ? "accent" : (TONE[s.tone] ?? "neutral")} dot={live || done} />
          <View style={styles.flex} />
          {done && trip.fareRwf !== null ? (
            <View style={styles.price}>
              <Txt v="figure" tabularNums>
                {money(trip.fareRwf)}
              </Txt>
              <Txt v="caption" tone="muted">
                RWF
              </Txt>
            </View>
          ) : null}
        </View>
        <RouteRail dense from={{ label: trip.pickupLabel }} to={{ label: trip.dropoffLabel }} />
      </Press>
      <View style={styles.actions}>
        <Press onPress={onOpen} scaleTo={0.96} style={styles.action} accessibilityRole="button">
          <Ionicons name={live ? "navigate" : "receipt-outline"} size={16} color={c.accent} />
          <Txt v="label" tone="accent" style={styles.actionText}>
            {live ? "Open trip" : done ? "Receipt" : "Details"}
          </Txt>
        </Press>
        <View style={styles.rule} />
        <Press onPress={onAgain} scaleTo={0.96} style={styles.action} accessibilityRole="button" accessibilityLabel={`Go to ${trip.dropoffLabel} again`}>
          <Ionicons name="refresh" size={16} color={c.accent} />
          <Txt v="label" tone="accent" style={styles.actionText}>
            Book again
          </Txt>
        </Press>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { borderRadius: radius.lg, backgroundColor: c.surfaceRaised, overflow: "hidden", ...shadow.card },
  body: { padding: space.md, gap: space.md },
  head: { flexDirection: "row", alignItems: "center", gap: space.sm },
  price: { flexDirection: "row", alignItems: "baseline", gap: 4 },
  actions: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
  action: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12 },
  actionText: { fontFamily: font.semibold },
  rule: { width: StyleSheet.hairlineWidth, backgroundColor: c.border },
});
