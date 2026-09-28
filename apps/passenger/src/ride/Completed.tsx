import { useEffect, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import {
  Button,
  Chip,
  Enter,
  ImigongoBand,
  Odometer,
  Press,
  SuccessMark,
  Txt,
  ZigzagEdge,
  c,
  ease,
  money,
  radius,
  selection,
  space,
} from "@nova/kit";
import type { TripTotal } from "@nova/data";

const PRAISE = ["Safe riding", "On time", "Friendly", "Knew the way", "Clean helmet"];

/**
 * The trip's end, where the cash changes hands. What to pay is the biggest
 * thing on the screen, set on a receipt and broken down, so a waiting charge
 * is never a surprise argued about at the kerb.
 */
export function Completed({
  total,
  quoted,
  riderName,
  destination,
  onRate,
  rated,
  onDone,
}: {
  readonly total: TripTotal | null;
  readonly quoted: number | null;
  readonly riderName: string;
  readonly destination: string;
  readonly onRate: (stars: number, comment: string) => void;
  readonly rated: boolean;
  readonly onDone: () => void;
}) {
  const [stars, setStars] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const pay = total?.totalRwf ?? quoted ?? 0;

  return (
    <View style={styles.stack}>
      <View style={styles.arrived}>
        <SuccessMark size={48} />
        <View style={styles.flex}>
          <Txt v="h2">You've arrived</Txt>
          <Txt v="label" tone="muted" lines={1}>
            {destination}
          </Txt>
        </View>
      </View>

      <View>
        <View style={styles.receipt}>
          <Txt v="label" tone="muted">
            Pay {riderName} in cash
          </Txt>
          <View style={styles.total}>
            <Odometer value={money(pay)} v="hero" />
            <Txt v="heading" tone="muted">
              RWF
            </Txt>
          </View>
          {total && total.waitingChargeRwf > 0 ? (
            <View style={styles.lines}>
              <Line label="Trip" value={total.fareRwf} />
              <Line label="Waiting time" value={total.waitingChargeRwf} />
            </View>
          ) : (
            <Txt v="caption" tone="muted">
              The price you agreed before you set off.
            </Txt>
          )}
          <ImigongoBand height={18} opacity={0.16} style={styles.band} />
        </View>
        <ZigzagEdge colour={c.surfaceHigh} />
      </View>

      {rated ? (
        <Enter i={0} style={styles.thanks}>
          <Ionicons name="heart" size={20} color={c.danger} />
          <Txt v="bodyStrong">Thanks - {riderName} will see it.</Txt>
        </Enter>
      ) : (
        <View style={styles.stack}>
          <Txt v="heading">How was {riderName}?</Txt>
          <View style={styles.stars} accessibilityRole="radiogroup" accessibilityLabel="Rating">
            {[1, 2, 3, 4, 5].map((n) => (
              <Star
                key={n}
                n={n}
                on={n <= stars}
                onPress={() => {
                  selection();
                  setStars(n);
                }}
              />
            ))}
          </View>
          {stars >= 4 ? (
            <Enter i={0} style={styles.tags}>
              {PRAISE.map((t) => {
                const on = tags.includes(t);
                return (
                  <Chip
                    key={t}
                    label={t}
                    selected={on}
                    onPress={() => setTags((prev) => (on ? prev.filter((x) => x !== t) : [...prev, t]))}
                  />
                );
              })}
            </Enter>
          ) : stars > 0 ? (
            <Enter i={0}>
              <TextInput
                style={styles.input}
                value={comment}
                onChangeText={setComment}
                placeholder="What went wrong? The fleet office reads these."
                placeholderTextColor={c.textMuted}
                multiline
                accessibilityLabel="What went wrong"
              />
            </Enter>
          ) : null}
          {stars > 0 ? (
            <Button
              label="Send rating"
              variant="secondary"
              onPress={() => onRate(stars, [...tags, comment.trim()].filter(Boolean).join(". "))}
            />
          ) : null}
        </View>
      )}

      <Button label="Done" onPress={onDone} />
    </View>
  );
}

/** A star that gives a small, springy nod when it turns on. */
function Star({ n, on, onPress }: { n: number; on: boolean; onPress: () => void }) {
  const s = useSharedValue(1);
  useEffect(() => {
    if (!on) return;
    s.set(withSequence(withTiming(1.22, { duration: 110, easing: ease.out }), withTiming(1, { duration: 200, easing: ease.out })));
  }, [on]); // eslint-disable-line react-hooks/exhaustive-deps
  const a = useAnimatedStyle(() => ({ transform: [{ scale: s.get() }] }));
  return (
    <Press onPress={onPress} scaleTo={0.9} hitSlop={6} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`${n} star${n > 1 ? "s" : ""}`}>
      <Animated.View style={a}>
        <Ionicons name={on ? "star" : "star-outline"} size={40} color={on ? c.warning : c.textMuted} />
      </Animated.View>
    </Press>
  );
}

function Line({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <View style={styles.line}>
      <Txt v="label" tone="muted">
        {label}
      </Txt>
      <Txt v="label" tabularNums>
        {money(value)}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  stack: { gap: space.md },
  arrived: { flexDirection: "row", alignItems: "center", gap: space.md },
  receipt: {
    backgroundColor: c.surfaceHigh,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: space.md,
    paddingTop: space.md,
    gap: 4,
  },
  band: { marginTop: space.sm, marginHorizontal: -space.md },
  total: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  lines: { marginTop: space.xs, gap: 2 },
  line: { flexDirection: "row", justifyContent: "space-between" },
  thanks: { flexDirection: "row", alignItems: "center", gap: space.sm },
  stars: { flexDirection: "row", gap: space.sm },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  input: {
    minHeight: 72,
    borderRadius: radius.md,
    backgroundColor: c.surfaceHigh,
    padding: space.md,
    fontSize: 16,
    color: c.textStrong,
    textAlignVertical: "top",
  },
});
