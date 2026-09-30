import { StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { c, space } from "./theme";
import { Txt } from "./Txt";

export interface TimelineItem {
  readonly label: string;
  /** A time, or "" for a step that has not happened. */
  readonly time: string;
  readonly note?: string;
  readonly tone?: "done" | "bad" | "pending";
}

/**
 * What happened, in order, down the left edge: booked, accepted, picked up,
 * finished. Each step has its time. Read after the fact, when a passenger
 * wants to know how long they waited or a rider wants to prove when they
 * arrived; never live, where the step track does that job.
 */
export function Timeline({ items }: { readonly items: readonly TimelineItem[] }) {
  return (
    <View style={styles.list} accessibilityRole="list">
      {items.map((it, i) => {
        const last = i === items.length - 1;
        const tone = it.tone ?? "done";
        const colour = tone === "bad" ? c.danger : tone === "pending" ? c.border : c.success;
        return (
          <View key={`${it.label}-${i}`} style={styles.item} accessibilityLabel={`${it.label}${it.time ? `, ${it.time}` : ""}`}>
            <View style={styles.rail}>
              <View style={[styles.dot, { backgroundColor: colour }]}>
                {tone === "bad" ? <Ionicons name="close" size={11} color={c.onAccent} /> : tone === "done" ? <Ionicons name="checkmark" size={11} color={c.onAccent} /> : null}
              </View>
              {!last ? <View style={[styles.line, { backgroundColor: tone === "pending" ? c.border : c.successSoft }]} /> : null}
            </View>
            <View style={[styles.text, !last && styles.textGap]}>
              <View style={styles.head}>
                <Txt v="bodyStrong" tone={tone === "pending" ? "muted" : "strong"} style={styles.flex}>
                  {it.label}
                </Txt>
                {it.time ? (
                  <Txt v="label" tone="muted" tabularNums>
                    {it.time}
                  </Txt>
                ) : null}
              </View>
              {it.note ? (
                <Txt v="label" tone="muted">
                  {it.note}
                </Txt>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  list: { paddingVertical: space.xs },
  item: { flexDirection: "row", gap: space.md },
  rail: { width: 18, alignItems: "center" },
  dot: { width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", marginTop: 3 },
  line: { flex: 1, width: 2, borderRadius: 1, marginVertical: 3 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  textGap: { paddingBottom: space.md },
  head: { flexDirection: "row", alignItems: "baseline", gap: space.sm },
});
