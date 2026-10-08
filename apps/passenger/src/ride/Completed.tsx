import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  Button,
  Chip,
  Enter,
  ImigongoBand,
  MoodRating,
  Odometer,
  SuccessMark,
  Txt,
  ZigzagEdge,
  c,
  money,
  radius,
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
  const pay = total?.paidRwf ?? quoted ?? 0;

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
        {/* What to pay, on the night, in the yellow: the number read across
            the kerb while the cash is counted out. */}
        <View style={styles.receipt}>
          <Txt v="label" tone="onHeroMuted">
            Pay {riderName} in cash
          </Txt>
          <View style={styles.total}>
            <Odometer value={money(pay)} v="hero" tone="onHero" />
            <Txt v="heading" tone="onHeroMuted">
              RWF
            </Txt>
          </View>
          {total && (total.waitingChargeRwf > 0 || total.promoDiscountRwf > 0) ? (
            <View style={styles.lines}>
              <Line label="Trip" value={total.fareRwf} />
              {total.waitingChargeRwf > 0 ? <Line label="Waiting time" value={total.waitingChargeRwf} /> : null}
              {total.promoDiscountRwf > 0 ? (
                <Line label={`Promo ${total.promoCode ?? ""}`.trim()} value={-total.promoDiscountRwf} />
              ) : null}
            </View>
          ) : (
            <Txt v="caption" tone="onHeroMuted">
              The price you agreed before you set off.
            </Txt>
          )}
          <ImigongoBand height={18} opacity={0.9} colour={c.highlight} style={styles.band} />
        </View>
        <ZigzagEdge colour={c.hero} />
      </View>

      {rated ? (
        <Enter i={0} style={styles.thanks}>
          <Ionicons name="heart" size={20} color={c.danger} />
          <Txt v="bodyStrong">Thanks - {riderName} will see it.</Txt>
        </Enter>
      ) : (
        <View style={styles.stack}>
          <Txt v="section">How was your ride with {riderName}?</Txt>
          <MoodRating value={stars} onChange={setStars} />
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

function Line({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <View style={styles.line}>
      <Txt v="label" tone="onHeroMuted">
        {label}
      </Txt>
      <Txt v="label" tone="onHero" tabularNums>
        {value < 0 ? `−${money(-value)}` : money(value)}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  stack: { gap: space.md },
  arrived: { flexDirection: "row", alignItems: "center", gap: space.md },
  receipt: {
    backgroundColor: c.hero,
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
