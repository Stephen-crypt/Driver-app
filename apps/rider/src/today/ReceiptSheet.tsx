import { Modal, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Button,
  Divider,
  Enter,
  ImigongoBand,
  Odometer,
  SuccessMark,
  Txt,
  ZigzagEdge,
  c,
  money,
  radius,
  space,
} from "@nova/kit";
import type { CompleteTripResult } from "@nova/data";

/**
 * The moment money changes hands, so it gets the whole screen. The number to
 * collect is the biggest thing the rider sees all day, because collecting the
 * wrong amount is the one mistake here that costs someone real money. It is set
 * on the same torn-off receipt the passenger is looking at, so the two screens
 * can be held side by side at the kerb.
 */
export function ReceiptSheet({
  result,
  onDone,
}: {
  readonly result: CompleteTripResult | null;
  readonly onDone: () => void;
}) {
  const insets = useSafeAreaInsets();
  if (!result) return null;
  // What the passenger hands over: the total less any promo, which Nova covers.
  const total = result.receipt.paidRwf ?? result.receipt.totalRwf;
  const promo = result.receipt.promoRwf ?? 0;
  return (
    <Modal visible animationType="fade" onRequestClose={onDone} statusBarTranslucent>
      <View style={[styles.root, { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.lg }]}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.head}>
            <SuccessMark size={52} />
            <View style={styles.flex}>
              <Txt v="h2">Trip complete</Txt>
              <Txt v="label" tone="muted">
                Collect the fare before your passenger goes.
              </Txt>
            </View>
          </View>

          <Enter i={1}>
            <View style={styles.receipt}>
              <Txt v="label" tone="muted">
                Collect in cash
              </Txt>
              <View style={styles.total}>
                <Odometer value={money(total)} v="hero" style={styles.big} delay={200} accessibilityLabel={`${money(total)} Rwandan francs`} />
                <Txt v="title" tone="muted">
                  RWF
                </Txt>
              </View>
              <View style={styles.lines}>
                {result.receipt.lines.map((l) => (
                  <View key={l.label} style={styles.line}>
                    <Txt v="body" tone="muted">
                      {l.label}
                    </Txt>
                    <Txt v="bodyStrong" tabularNums tone={l.amountRwf < 0 ? "good" : undefined}>
                      {l.amountRwf < 0 ? `−${money(-l.amountRwf)}` : money(l.amountRwf)}
                    </Txt>
                  </View>
                ))}
              </View>
              {promo > 0 ? (
                <Txt v="caption" tone="muted">
                  Nova covers the promo. Your earning is on the full fare.
                </Txt>
              ) : null}
              <ImigongoBand height={18} opacity={0.16} style={styles.band} />
            </View>
            <ZigzagEdge colour={c.surfaceRaised} />
          </Enter>

          <Enter i={2}>
            <View style={styles.earned}>
              <View style={styles.flex}>
                <Txt v="bodyStrong" tone="good">
                  You earned
                </Txt>
                <Txt v="caption" tone="muted">
                  Paid to you separately
                </Txt>
              </View>
              <View style={styles.amount}>
                <Odometer value={money(result.riderEarningRwf)} v="figure" tone="good" delay={520} />
                <Txt v="label" tone="good">
                  RWF
                </Txt>
              </View>
            </View>
            <Divider />
            <Txt v="label" tone="muted" style={styles.small}>
              The cash is company money. Hand it in at the end of your shift.
            </Txt>
          </Enter>
        </ScrollView>
        <Button label="Cash collected" onPress={onDone} icon="checkmark" />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  root: { flex: 1, backgroundColor: c.surface, paddingHorizontal: space.lg },
  scroll: { gap: space.lg, paddingBottom: space.lg },
  head: { flexDirection: "row", alignItems: "center", gap: space.md, paddingTop: space.md },
  receipt: {
    backgroundColor: c.surfaceRaised,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: space.md,
    paddingTop: space.md,
    gap: space.xs,
  },
  total: { flexDirection: "row", alignItems: "baseline", gap: space.sm },
  big: { fontSize: 84, lineHeight: 88 },
  lines: { marginTop: space.sm, gap: space.sm },
  line: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  band: { marginTop: space.md, marginHorizontal: -space.md },
  earned: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md },
  amount: { flexDirection: "row", alignItems: "baseline", gap: 4 },
  small: { marginTop: space.md },
});
