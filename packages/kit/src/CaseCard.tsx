import { StyleSheet, View } from "react-native";
import { Txt } from "./Txt";
import { c, radius, space } from "./theme";

type Status = "open" | "in_progress" | "resolved";

const DOT: Record<Status, string> = { open: c.warning, in_progress: c.accent, resolved: c.success };

/**
 * One report, as the person who filed it sees it: the number to quote on the
 * phone, what they said, and - once someone has dealt with it - Gera's answer,
 * set apart so it reads as a reply rather than more of their own words.
 */
export function CaseCard({
  number,
  title,
  status,
  statusLabel,
  when,
  description,
  resolution,
}: {
  readonly number: number;
  readonly title: string;
  readonly status: Status;
  readonly statusLabel: string;
  readonly when: string;
  readonly description: string;
  readonly resolution: string | null;
}) {
  return (
    <View style={styles.card} accessible accessibilityLabel={`Report ${number}, ${title}, ${statusLabel}`}>
      <View style={styles.head}>
        <Txt v="figure" tone="muted" tabularNums>
          #{number}
        </Txt>
        <View style={styles.flex}>
          <Txt v="bodyStrong">{title}</Txt>
          <Txt v="caption" tone="muted">
            {when}
          </Txt>
        </View>
        <View style={styles.status}>
          <View style={[styles.dot, { backgroundColor: DOT[status] }]} />
          <Txt v="caption" tone={status === "resolved" ? "good" : "default"}>
            {statusLabel}
          </Txt>
        </View>
      </View>
      <Txt v="body" tone="default" lines={resolution ? 2 : 4}>
        {description}
      </Txt>
      {resolution ? (
        <View style={styles.reply}>
          <Txt v="caption" tone="accent">
            Gera replied
          </Txt>
          <Txt v="body">{resolution}</Txt>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: c.surfaceRaised, borderRadius: radius.lg, padding: space.md, gap: space.sm },
  head: { flexDirection: "row", alignItems: "center", gap: space.sm },
  flex: { flex: 1, minWidth: 0 },
  status: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  reply: { backgroundColor: c.accentSoft, borderRadius: radius.md, padding: space.md, gap: 2, borderLeftWidth: 3, borderLeftColor: c.accent },
});
