import { useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Button, Divider, Txt, c, money, radius, space, tap } from "@gera/kit";
import type { TripTotal } from "@gera/data";

const PRAISE = ["Safe riding", "On time", "Friendly", "Knew the way", "Clean helmet"];

/**
 * The trip's end, where the cash changes hands. What to pay is the biggest
 * thing on the screen, broken down so a waiting charge is never a surprise
 * argued about at the kerb.
 */
export function Completed({
  total,
  quoted,
  riderName,
  onRate,
  rated,
  onDone,
}: {
  readonly total: TripTotal | null;
  readonly quoted: number | null;
  readonly riderName: string;
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
      <View>
        <Txt v="label" tone="muted">
          Pay {riderName} in cash
        </Txt>
        <View style={styles.total}>
          <Txt v="hero" tabularNums>
            {money(pay)}
          </Txt>
          <Txt v="heading" tone="muted">
            RWF
          </Txt>
        </View>
        {total && total.waitingChargeRwf > 0 ? (
          <View style={styles.lines}>
            <Line label="Trip" value={total.fareRwf} />
            <Line label="Waiting time" value={total.waitingChargeRwf} />
          </View>
        ) : null}
      </View>

      <Divider />

      {rated ? (
        <View style={styles.thanks}>
          <Ionicons name="heart" size={20} color={c.danger} />
          <Txt v="bodyStrong">Thanks - {riderName} will see it.</Txt>
        </View>
      ) : (
        <View style={styles.stack}>
          <Txt v="heading">How was {riderName}?</Txt>
          <View style={styles.stars}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Pressable
                key={n}
                onPress={() => {
                  tap();
                  setStars(n);
                }}
                accessibilityRole="button"
                accessibilityLabel={`${n} star${n > 1 ? "s" : ""}`}
                hitSlop={6}
              >
                <Ionicons name={n <= stars ? "star" : "star-outline"} size={38} color={n <= stars ? c.warning : c.textMuted} />
              </Pressable>
            ))}
          </View>
          {stars >= 4 ? (
            <View style={styles.tags}>
              {PRAISE.map((t) => {
                const on = tags.includes(t);
                return (
                  <Pressable
                    key={t}
                    onPress={() => setTags((prev) => (on ? prev.filter((x) => x !== t) : [...prev, t]))}
                    style={[styles.tag, on && styles.tagOn]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                  >
                    <Txt v="label" tone={on ? "inverse" : "strong"}>
                      {t}
                    </Txt>
                  </Pressable>
                );
              })}
            </View>
          ) : stars > 0 ? (
            <TextInput
              style={styles.input}
              value={comment}
              onChangeText={setComment}
              placeholder="What went wrong? The fleet office reads these."
              placeholderTextColor={c.textMuted}
              multiline
            />
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
  stack: { gap: space.md },
  total: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  lines: { marginTop: space.xs, gap: 2 },
  line: { flexDirection: "row", justifyContent: "space-between" },
  thanks: { flexDirection: "row", alignItems: "center", gap: space.sm },
  stars: { flexDirection: "row", gap: space.sm },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  tag: {
    paddingHorizontal: space.md,
    height: 36,
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: c.surfaceHigh,
  },
  tagOn: { backgroundColor: c.textStrong },
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
