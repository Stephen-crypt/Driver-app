import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { Txt, c, radius, space } from "@gera/kit";

/**
 * Time that runs out drains, left to right, at the speed it is really going:
 * the offer's fifteen seconds, the free wait at a pickup. Linear on purpose -
 * an eased bar would lie about how much time is left.
 */
export function useDrain(endsAt: number, totalMs: number): SharedValue<number> {
  const p = useSharedValue(1);
  useEffect(() => {
    const ms = Math.max(0, endsAt - Date.now());
    p.set(totalMs > 0 ? Math.min(1, ms / totalMs) : 0);
    // Never skipped for reduced motion: with the system setting on, a timing
    // jumps to its end, and an empty bar would say the time was already up.
    // A bar creeping across is information, not decoration.
    if (ms > 0) p.set(withTiming(0, { duration: ms, easing: Easing.linear, reduceMotion: ReduceMotion.Never }));
  }, [endsAt, totalMs]); // eslint-disable-line react-hooks/exhaustive-deps
  return p;
}

export function DrainBar({ endsAt, totalMs, tone = "accent" }: { readonly endsAt: number; readonly totalMs: number; readonly tone?: "accent" | "warn" }) {
  const p = useDrain(endsAt, totalMs);
  const fill = useAnimatedStyle(() => ({ transform: [{ scaleX: p.get() }] }));
  return (
    <View style={styles.track} accessibilityElementsHidden>
      <Animated.View style={[styles.fill, { backgroundColor: tone === "warn" ? c.warning : c.accent }, fill]} />
    </View>
  );
}

/** What the passenger wrote for the rider, set apart so it is read, not skimmed. */
export function PassengerNote({ text }: { readonly text: string }) {
  return (
    <View style={styles.note} accessibilityLabel={`Note from the passenger: ${text}`}>
      <Ionicons name="chatbubble-ellipses" size={16} color={c.textMuted} style={styles.noteIcon} />
      <Txt v="label" style={styles.flex}>
        {text}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  track: { height: 4, borderRadius: 2, backgroundColor: c.surfaceHigh, overflow: "hidden" },
  fill: { ...StyleSheet.absoluteFill, borderRadius: 2, transformOrigin: "left" },
  note: {
    flexDirection: "row",
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    backgroundColor: c.surfaceHigh,
  },
  noteIcon: { marginTop: 1 },
});
