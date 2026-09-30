import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { c, font, radius, shadow, space } from "./theme";
import { Txt } from "./Txt";
import { Press } from "./Press";
import { Button, type IconName } from "./controls";
import { ChoiceRow } from "./choice";
import { TextArea } from "./Field";
import { ModalSheet } from "./overlay";

// ---------------------------------------------------------------------------
// The bell and what is behind it.
// ---------------------------------------------------------------------------

/** The bell, with the unread count on it in the yellow. */
export function BellButton({
  count,
  onPress,
  onHero,
}: {
  readonly count: number;
  readonly onPress: () => void;
  /** On the midnight hero; otherwise a white disc that floats over a map. */
  readonly onHero?: boolean;
}) {
  return (
    <Press
      onPress={onPress}
      scaleTo={0.92}
      hitSlop={4}
      style={[styles.bell, onHero ? styles.bellHero : styles.bellFloat]}
      accessibilityRole="button"
      accessibilityLabel={count > 0 ? `Notifications, ${count} unread` : "Notifications"}
    >
      <Ionicons name={count > 0 ? "notifications" : "notifications-outline"} size={21} color={onHero ? c.onHero : c.textStrong} />
      {count > 0 ? (
        <View style={[styles.badge, { borderColor: onHero ? c.hero : c.surfaceRaised }]}>
          <Txt v="caption" tone="onHighlight" style={styles.badgeText}>
            {count > 9 ? "9+" : String(count)}
          </Txt>
        </View>
      ) : null}
    </Press>
  );
}

export interface Notice {
  readonly id: number;
  readonly title: string;
  readonly body: string;
  readonly kind: string;
  readonly at: string;
  readonly read: boolean;
}

/** What a notification is about, from its kind and, for trips, its title. */
function look(n: Notice): { icon: IconName; ground: string; ink: string } {
  const t = n.title.toLowerCase();
  if (n.kind === "message") return { icon: "chatbubble", ground: c.tintBlue, ink: c.accent };
  if (n.kind === "case") return { icon: "document-text", ground: c.tintGreen, ink: c.success };
  if (n.kind === "rider_changed") return { icon: "swap-horizontal", ground: c.tintAmber, ink: c.warning };
  if (/cancel|no riders|couldn't|could not/.test(t)) return { icon: "close-circle", ground: c.dangerSoft, ink: c.danger };
  if (/complete|pay/.test(t)) return { icon: "receipt", ground: c.tintGreen, ink: c.success };
  if (/here|arrived/.test(t)) return { icon: "location", ground: c.tintYellow, ink: c.onHighlight };
  return { icon: "navigate", ground: c.tintBlue, ink: c.accent };
}

function dayOf(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/**
 * Notifications by day, newest first, each on its own tint so a trip, a
 * message and an answer from the office are told apart at a glance. Unread
 * ones carry a yellow dot.
 */
export function NotificationList({
  items,
  onOpen,
}: {
  readonly items: readonly Notice[];
  readonly onOpen?: (n: Notice) => void;
}) {
  const groups: { day: string; items: Notice[] }[] = [];
  for (const n of items) {
    const k = dayOf(n.at);
    const last = groups[groups.length - 1];
    if (last && last.day === k) last.items.push(n);
    else groups.push({ day: k, items: [n] });
  }
  return (
    <View style={styles.groups}>
      {groups.map((g) => (
        <View key={g.day} style={styles.group}>
          <Txt v="section" style={styles.day}>
            {g.day}
          </Txt>
          <View style={styles.card}>
            {g.items.map((n, i) => {
              const l = look(n);
              const body = (
                <>
                  <View style={[styles.well, { backgroundColor: l.ground }]}>
                    <Ionicons name={l.icon} size={19} color={l.ink} />
                  </View>
                  <View style={styles.text}>
                    <Txt v="bodyStrong" lines={1}>
                      {n.title}
                    </Txt>
                    <Txt v="label" tone="muted" lines={2}>
                      {n.body}
                    </Txt>
                  </View>
                  <View style={styles.meta}>
                    <Txt v="caption" tone="muted" tabularNums>
                      {clock(n.at)}
                    </Txt>
                    {!n.read ? <View style={styles.dot} accessibilityLabel="Unread" /> : null}
                  </View>
                </>
              );
              return onOpen ? (
                <Press
                  key={n.id}
                  onPress={() => onOpen(n)}
                  scaleTo={1}
                  bg={c.surfaceRaised}
                  pressedBg={c.surfaceHigh}
                  style={[styles.row, i > 0 && styles.rowLine, !n.read && styles.rowUnread]}
                  accessibilityRole="button"
                  accessibilityLabel={`${n.read ? "" : "Unread. "}${n.title}. ${n.body}`}
                >
                  {body}
                </Press>
              ) : (
                <View key={n.id} style={[styles.row, i > 0 && styles.rowLine, !n.read && styles.rowUnread]}>
                  {body}
                </View>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Cancelling, with a reason.
// ---------------------------------------------------------------------------

/**
 * Why someone is cancelling, as one choice from a short list or a sentence of
 * their own. The reason goes on the trip's record. The button stays grey until
 * there is a reason, and "keep" is always the easier thing to press.
 */
export function ReasonSheet({
  visible,
  onClose,
  title,
  message,
  reasons,
  confirmLabel,
  keepLabel,
  busy,
  onConfirm,
}: {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly message?: string;
  readonly reasons: readonly { label: string; icon?: IconName }[];
  readonly confirmLabel: string;
  readonly keepLabel: string;
  readonly busy?: boolean;
  readonly onConfirm: (reason: string) => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [other, setOther] = useState("");
  const OTHER = "Something else";
  const reason = picked === OTHER ? other.trim() : picked;

  return (
    <ModalSheet
      visible={visible}
      onClose={onClose}
      title={title}
      subtitle={message}
      onClosed={() => {
        setPicked(null);
        setOther("");
      }}
    >
      <View style={styles.reasons} accessibilityRole="radiogroup">
        {[...reasons, { label: OTHER, icon: "create-outline" as IconName }].map((r) => (
          <ChoiceRow key={r.label} kind="radio" on={picked === r.label} onPress={() => setPicked(r.label)} title={r.label} icon={r.icon} />
        ))}
      </View>
      {picked === OTHER ? (
        <TextArea value={other} onChangeText={setOther} placeholder="Tell us in a sentence" minHeight={88} autoFocus onPaper />
      ) : null}
      <View style={styles.reasonActions}>
        <Button label={confirmLabel} variant="dangerSolid" onPress={() => reason && onConfirm(reason)} disabled={!reason} loading={busy} />
        <Button label={keepLabel} variant="secondary" onPress={onClose} />
      </View>
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  bell: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
  bellHero: { backgroundColor: c.heroRaised },
  bellFloat: { backgroundColor: c.surfaceRaised, ...shadow.float },
  badge: {
    position: "absolute",
    top: -3,
    right: -3,
    minWidth: 21,
    height: 21,
    borderRadius: 11,
    paddingHorizontal: 5,
    backgroundColor: c.highlight,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontFamily: font.numBold, fontSize: 11, lineHeight: 14 },
  groups: { gap: space.lg },
  group: { gap: space.sm + 2 },
  day: { paddingHorizontal: 2 },
  card: { borderRadius: radius.lg, overflow: "hidden", backgroundColor: c.surfaceRaised, ...shadow.card },
  row: { flexDirection: "row", alignItems: "flex-start", gap: space.md, padding: space.md },
  rowLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
  // Unread: a yellow bar down the left edge, and the dot. The row itself stays
  // white, so a yellow icon well on it is still seen.
  rowUnread: { borderLeftWidth: 4, borderLeftColor: c.highlight, paddingLeft: space.md - 4 },
  well: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, minWidth: 0, gap: 2 },
  meta: { alignItems: "flex-end", gap: 8, paddingTop: 2 },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: c.highlight, borderWidth: 1.5, borderColor: c.onHighlight },
  reasons: { gap: space.xs, marginBottom: space.sm },
  reasonActions: { gap: space.sm, marginTop: space.sm },
});
