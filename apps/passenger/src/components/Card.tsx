import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme, tokens } from "@gera/ui";

/** A white card on the page ground. The one shape everything else sits in. */
export function Card({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/**
 * A number with its label under it, not in front of it.
 *
 * The reference's whole hierarchy comes from this: the figure is the largest
 * thing on the card and the word explaining it is the smallest, so a rider
 * reads the number first and only reads the label if they need to.
 */
export function Stat({
  value,
  unit,
  label,
  footnote,
  tone = "default",
}: {
  readonly value: string;
  readonly unit?: string;
  readonly label: string;
  readonly footnote?: string;
  readonly tone?: "default" | "good" | "bad";
}) {
  return (
    <View style={styles.statCell}>
      <Text style={styles.statLabel}>{label}</Text>
      <View style={styles.statValueRow}>
        <Text
          style={[
            styles.statValue,
            tone === "good" && styles.statGood,
            tone === "bad" && styles.statBad,
          ]}
        >
          {value}
        </Text>
        {unit ? <Text style={styles.statUnit}>{unit}</Text> : null}
      </View>
      {footnote ? <Text style={styles.statFootnote}>{footnote}</Text> : null}
    </View>
  );
}

/** A small status word on its own tint. Both halves are contrast-tested. */
export function Chip({
  label,
  tone = "neutral",
}: {
  readonly label: string;
  readonly tone?: "neutral" | "good" | "bad" | "warn";
}) {
  const tint =
    tone === "good" ? styles.chipGood
      : tone === "bad" ? styles.chipBad
      : tone === "warn" ? styles.chipWarn
      : styles.chipNeutral;
  const ink =
    tone === "good" ? styles.chipInkGood
      : tone === "bad" ? styles.chipInkBad
      : tone === "warn" ? styles.chipInkWarn
      : styles.chipInkNeutral;

  return (
    <View style={[styles.chip, tint]}>
      <Text style={[styles.chipText, ink]}>{label}</Text>
    </View>
  );
}

/**
 * A row with a tinted icon well, a label, a value and a chevron. The icon well
 * is what stops a list of rows reading as a wall of text.
 */
export function Row({
  icon,
  tone = "accent",
  label,
  value,
  onPress,
  style,
}: {
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly tone?: "accent" | "good" | "bad" | "warn";
  readonly label: string;
  readonly value?: string;
  readonly onPress?: () => void;
  readonly style?: StyleProp<ViewStyle>;
}) {
  const well =
    tone === "good" ? styles.wellGood
      : tone === "bad" ? styles.wellBad
      : tone === "warn" ? styles.wellWarn
      : styles.wellAccent;
  const ink =
    tone === "good" ? theme.success
      : tone === "bad" ? theme.danger
      : tone === "warn" ? theme.warning
      : theme.accent;

  const body = (
    <>
      <View style={[styles.well, well]}>
        <Ionicons name={icon} size={17} color={ink} />
      </View>
      <Text style={styles.rowLabel}>{label}</Text>
      {value ? <Text style={styles.rowValue}>{value}</Text> : null}
      {onPress ? (
        <Ionicons name="chevron-forward" size={17} color={theme.textMuted} />
      ) : null}
    </>
  );

  return onPress ? (
    <Pressable style={[styles.row, style]} onPress={onPress} accessibilityRole="button">
      {body}
    </Pressable>
  ) : (
    <View style={[styles.row, style]}>{body}</View>
  );
}

/** The one primary action. Pill, full width, in the bottom third. */
export function PrimaryButton({
  label,
  onPress,
  disabled,
  tone = "accent",
  badge,
}: {
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly tone?: "accent" | "danger";
  readonly badge?: string;
}) {
  return (
    <Pressable
      style={[
        styles.cta,
        tone === "danger" && styles.ctaDanger,
        disabled && styles.ctaDisabled,
      ]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
    >
      <Text style={styles.ctaText}>{label}</Text>
      {badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.surfaceRaised,
    borderRadius: tokens.radius.lg,
    padding: tokens.space.md,
  },
  statCell: { flex: 1 },
  statLabel: {
    fontSize: tokens.type.label.size,
    fontWeight: "600",
    color: theme.textMuted,
  },
  statValueRow: { flexDirection: "row", alignItems: "baseline", marginTop: 2 },
  statValue: {
    fontSize: tokens.type.stat.size,
    fontWeight: "700",
    color: theme.textStrong,
    letterSpacing: -0.5,
  },
  statGood: { color: theme.success },
  statBad: { color: theme.danger },
  statUnit: {
    marginLeft: 4,
    fontSize: tokens.type.body.size,
    fontWeight: "600",
    color: theme.textMuted,
  },
  statFootnote: {
    marginTop: tokens.space.xs,
    fontSize: tokens.type.caption.size,
    color: theme.textMuted,
  },
  chip: {
    paddingHorizontal: tokens.space.sm,
    paddingVertical: 3,
    borderRadius: tokens.radius.pill,
  },
  chipNeutral: { backgroundColor: theme.surfaceHigh },
  chipGood: { backgroundColor: theme.successSoft },
  chipBad: { backgroundColor: theme.dangerSoft },
  chipWarn: { backgroundColor: theme.warningSoft },
  chipText: { fontSize: tokens.type.caption.size, fontWeight: "700" },
  chipInkNeutral: { color: theme.textMuted },
  chipInkGood: { color: theme.success },
  chipInkBad: { color: theme.danger },
  chipInkWarn: { color: theme.warning },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: tokens.MIN_TOUCH_TARGET,
    gap: tokens.space.sm,
  },
  well: {
    width: 30,
    height: 30,
    borderRadius: tokens.radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  wellAccent: { backgroundColor: theme.accentSoft },
  wellGood: { backgroundColor: theme.successSoft },
  wellBad: { backgroundColor: theme.dangerSoft },
  wellWarn: { backgroundColor: theme.warningSoft },
  rowLabel: {
    flex: 1,
    fontSize: tokens.type.body.size,
    fontWeight: "600",
    color: theme.textStrong,
  },
  rowValue: { fontSize: tokens.type.body.size, color: theme.textMuted },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.space.sm,
    minHeight: tokens.MIN_TOUCH_TARGET + 8,
    borderRadius: tokens.radius.pill,
    backgroundColor: theme.accent,
  },
  ctaDanger: { backgroundColor: theme.danger },
  ctaDisabled: { opacity: 0.4 },
  ctaText: {
    fontSize: tokens.type.body.size + 1,
    fontWeight: "700",
    color: theme.onAccent,
  },
  badge: {
    minWidth: 28,
    height: 28,
    borderRadius: tokens.radius.pill,
    borderWidth: 2,
    borderColor: theme.onAccent,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  badgeText: {
    fontSize: tokens.type.caption.size,
    fontWeight: "700",
    color: theme.onAccent,
  },
});
