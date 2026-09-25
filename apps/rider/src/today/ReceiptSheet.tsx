import { Modal, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Divider, Txt, c, money, space } from "@gera/kit";
import type { CompleteTripResult } from "@gera/data";

/**
 * The moment money changes hands, so it gets the whole screen. The number to
 * collect is the biggest thing the rider sees all day, because collecting the
 * wrong amount is the one mistake here that costs someone real money.
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
  return (
    <Modal visible animationType="fade" onRequestClose={onDone} statusBarTranslucent>
      <View style={[styles.root, { paddingTop: insets.top + space.xxl, paddingBottom: insets.bottom + space.lg }]}>
        <View style={styles.flex}>
          <Txt v="heading" tone="muted">
            Collect in cash
          </Txt>
          <View style={styles.total}>
            <Txt v="hero" tabularNums style={styles.big}>
              {money(result.receipt.totalRwf)}
            </Txt>
            <Txt v="title" tone="muted">
              RWF
            </Txt>
          </View>

          <View style={styles.lines}>
            {result.receipt.lines.map((l) => (
              <View key={l.label} style={styles.line}>
                <Txt v="body" tone="default">
                  {l.label}
                </Txt>
                <Txt v="bodyStrong" tabularNums>
                  {money(l.amountRwf)}
                </Txt>
              </View>
            ))}
            <Divider />
            <View style={styles.line}>
              <Txt v="bodyStrong" tone="good">
                You earned
              </Txt>
              <Txt v="figure" tone="good" tabularNums>
                {money(result.riderEarningRwf)} RWF
              </Txt>
            </View>
          </View>

          <Txt v="label" tone="muted" style={styles.small}>
            The cash is handed in at the end of your shift. Your share is paid to you separately.
          </Txt>
        </View>
        <Button label="Cash collected" onPress={onDone} icon="checkmark" />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  root: { flex: 1, backgroundColor: c.surface, paddingHorizontal: space.lg },
  total: { flexDirection: "row", alignItems: "baseline", gap: space.sm, marginTop: space.xs },
  big: { fontSize: 88, lineHeight: 92 },
  lines: {
    marginTop: space.xl,
    padding: space.md,
    gap: space.md,
    borderRadius: 20,
    backgroundColor: c.surfaceRaised,
  },
  line: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  small: { marginTop: space.md },
});
