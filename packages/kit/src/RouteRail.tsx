import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { c, space } from "./theme";
import { Txt } from "./Txt";
import { Press } from "./Press";

interface Stop {
  readonly label: string;
  /** A second line: "Outside the pharmacy", "07:30". */
  readonly note?: string;
  readonly onPress?: () => void;
  /** Drawn at the end of the stop's line: a time, an edit icon. */
  readonly trailing?: ReactNode;
}

/**
 * Pickup and drop-off as a line diagram: a ring where you are, a square where
 * you are going, joined by the line. It is the same shape in search, on a trip
 * card, on a receipt and in history, so a person learns it once. The map uses
 * the same two marks.
 */
export function RouteRail({
  from,
  to,
  dense,
  divided,
}: {
  readonly from: Stop;
  readonly to: Stop;
  /** Tight rows for cards and lists; the full size is for search and receipts. */
  readonly dense?: boolean;
  /** A hairline between the two stops, when each can be tapped to change it. */
  readonly divided?: boolean;
}) {
  const h = dense ? (from.note || to.note ? 40 : 30) : 52;
  return (
    <View style={styles.wrap}>
      <View style={[styles.rail, { paddingTop: h / 2 - 6, paddingBottom: h / 2 - 5 }]} pointerEvents="none">
        <View style={styles.ring} />
        <View style={styles.line} />
        <View style={styles.square} />
      </View>
      <View style={styles.stops}>
        <StopRow stop={from} height={h} dense={dense} />
        {divided ? <View style={styles.divider} /> : null}
        <StopRow stop={to} height={h} dense={dense} strong />
      </View>
    </View>
  );
}

function StopRow({ stop, height, dense, strong }: { stop: Stop; height: number; dense?: boolean; strong?: boolean }) {
  const body = (
    <View style={[styles.stop, { minHeight: height }]}>
      <View style={styles.flex}>
        <Txt v={dense ? "label" : "bodyStrong"} tone={strong || !dense ? "strong" : "default"} lines={1}>
          {stop.label}
        </Txt>
        {stop.note ? (
          <Txt v="caption" tone="muted" lines={1}>
            {stop.note}
          </Txt>
        ) : null}
      </View>
      {stop.trailing}
    </View>
  );
  if (!stop.onPress) return body;
  return (
    <Press onPress={stop.onPress} scaleTo={1} accessibilityRole="button" accessibilityLabel={stop.label}>
      {body}
    </Press>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", gap: space.md },
  flex: { flex: 1, minWidth: 0 },
  rail: { width: 14, alignItems: "center" },
  ring: { width: 12, height: 12, borderRadius: 6, borderWidth: 3, borderColor: c.textStrong, backgroundColor: c.surfaceRaised },
  line: { flex: 1, width: 2, borderRadius: 1, backgroundColor: c.border, marginVertical: 3 },
  square: { width: 10, height: 10, borderRadius: 2, backgroundColor: c.destination },
  stops: { flex: 1, minWidth: 0 },
  stop: { flexDirection: "row", alignItems: "center", gap: space.sm },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: c.border },
});
