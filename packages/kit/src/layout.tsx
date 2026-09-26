import type { ReactNode } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { c, radius, shadow, space, tokens } from "./theme";
import { Txt, type Tone } from "./Txt";
import { tap, type IconName } from "./controls";

// ---------------------------------------------------------------------------
// Rows. Lists are rows on one surface separated by hairlines - not a card per
// item. A wall of identical cards makes every item look equally important.
// ---------------------------------------------------------------------------

type WellTone = "accent" | "good" | "bad" | "warn" | "neutral";

const WELL: Record<WellTone, { bg: string; fg: string }> = {
  accent: { bg: c.accentSoft, fg: c.accent },
  good: { bg: c.successSoft, fg: c.success },
  bad: { bg: c.dangerSoft, fg: c.danger },
  warn: { bg: c.warningSoft, fg: c.warning },
  neutral: { bg: c.surfaceHigh, fg: c.textMuted },
};

interface RowProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly icon?: IconName;
  readonly iconTone?: WellTone;
  readonly value?: string;
  readonly valueTone?: Tone;
  readonly onPress?: () => void;
  readonly trailing?: ReactNode;
  readonly leading?: ReactNode;
  /** Show the whole subtitle - for advice that must be read, not skimmed. */
  readonly full?: boolean;
}

export function Row({
  title,
  subtitle,
  icon,
  iconTone = "accent",
  value,
  valueTone = "strong",
  onPress,
  trailing,
  leading,
  full,
}: RowProps) {
  const body = (
    <>
      {leading ??
        (icon ? (
          <View style={[styles.well, { backgroundColor: WELL[iconTone].bg }]}>
            <Ionicons name={icon} size={18} color={WELL[iconTone].fg} />
          </View>
        ) : null)}
      <View style={styles.rowText}>
        <Txt v="bodyStrong" lines={full ? undefined : 1}>
          {title}
        </Txt>
        {subtitle ? (
          <Txt v="label" tone="muted" lines={full ? undefined : 2}>
            {subtitle}
          </Txt>
        ) : null}
      </View>
      {value ? (
        <Txt v="figure" tone={valueTone} tabularNums style={styles.rowValue}>
          {value}
        </Txt>
      ) : null}
      {trailing}
      {onPress && !trailing ? (
        <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
      ) : null}
    </>
  );

  if (!onPress) return <View style={styles.row}>{body}</View>;
  return (
    <Pressable
      onPress={() => {
        tap();
        onPress();
      }}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      {body}
    </Pressable>
  );
}

export function Divider({ inset = 0 }: { readonly inset?: number }) {
  return <View style={[styles.divider, { marginLeft: inset }]} />;
}

/** A titled group of rows on one white surface. */
export function Group({
  title,
  children,
  style,
}: {
  readonly title?: string;
  readonly children: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={style}>
      {title ? (
        <Txt v="label" tone="muted" style={styles.groupTitle}>
          {title}
        </Txt>
      ) : null}
      <View style={styles.group}>{children}</View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export function Stat({
  label,
  value,
  unit,
  tone = "strong",
  big,
}: {
  readonly label: string;
  readonly value: string;
  readonly unit?: string;
  readonly tone?: Tone;
  readonly big?: boolean;
}) {
  return (
    <View style={styles.stat}>
      <View style={styles.statFigure}>
        <Txt v={big ? "display" : "figure"} tone={tone} tabularNums>
          {value}
        </Txt>
        {unit ? (
          <Txt v="label" tone="muted" style={styles.statUnit}>
            {unit}
          </Txt>
        ) : null}
      </View>
      <Txt v="label" tone="muted">
        {label}
      </Txt>
    </View>
  );
}

export function StatRow({ children }: { readonly children: ReactNode }) {
  return <View style={styles.statRow}>{children}</View>;
}

// ---------------------------------------------------------------------------
// Paper: the sheet that sits on the map. One per screen.
// ---------------------------------------------------------------------------

export function Paper({
  children,
  style,
  padBottom = true,
}: {
  readonly children: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
  /** Off when a tab bar sits under the sheet and already clears the gesture bar. */
  readonly padBottom?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.paper,
        { paddingBottom: (padBottom ? insets.bottom : 0) + space.md },
        style,
      ]}
    >
      <View style={styles.grabber} />
      {children}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Screen: a scrolling page with a large condensed title.
// ---------------------------------------------------------------------------

export function Screen({
  title,
  subtitle,
  right,
  children,
  onBack,
  scroll = true,
  footer,
}: {
  readonly title?: string;
  readonly subtitle?: string;
  readonly right?: ReactNode;
  readonly children: ReactNode;
  readonly onBack?: () => void;
  readonly scroll?: boolean;
  /** Pinned below the scroll area - where the one primary action goes. */
  readonly footer?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const header = (
    <View style={styles.header}>
      {onBack ? (
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={12}
          style={styles.back}
        >
          <Ionicons name="arrow-back" size={24} color={c.textStrong} />
        </Pressable>
      ) : null}
      {title ? (
        <View style={styles.headerRow}>
          <View style={styles.flex}>
            <Txt v="title">{title}</Txt>
            {subtitle ? (
              <Txt v="body" tone="muted">
                {subtitle}
              </Txt>
            ) : null}
          </View>
          {right}
        </View>
      ) : null}
    </View>
  );

  const content = scroll ? (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[styles.content, { paddingBottom: footer ? space.lg : insets.bottom + space.xl }]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {header}
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, styles.content]}>
      {header}
      {children}
    </View>
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {content}
      {footer ? (
        <View style={[styles.footer, { paddingBottom: insets.bottom + space.md }]}>{footer}</View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    minHeight: tokens.MIN_TOUCH_TARGET + 12,
    paddingVertical: space.sm + 2,
    paddingHorizontal: space.md,
  },
  rowPressed: { backgroundColor: c.surfaceHigh },
  rowText: { flex: 1, gap: 1 },
  rowValue: { fontSize: 22, lineHeight: 26 },
  well: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: c.border },
  group: {
    backgroundColor: c.surfaceRaised,
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  groupTitle: { marginBottom: space.sm, marginLeft: space.xs },
  stat: { flex: 1, gap: 2 },
  statFigure: { flexDirection: "row", alignItems: "baseline", gap: 4 },
  statUnit: { marginBottom: 2 },
  statRow: { flexDirection: "row", gap: space.md },
  paper: {
    backgroundColor: c.surfaceRaised,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    ...shadow.paper,
  },
  grabber: {
    alignSelf: "center",
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: c.border,
    marginBottom: space.md,
  },
  screen: { flex: 1, backgroundColor: c.surface },
  content: { paddingHorizontal: space.lg },
  header: { paddingTop: space.md, paddingBottom: space.lg, gap: space.sm },
  headerRow: { flexDirection: "row", alignItems: "flex-end", gap: space.md },
  back: { width: 40, height: 40, justifyContent: "center", marginLeft: -4 },
  footer: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    backgroundColor: c.surface,
  },
});
