import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { fadeIn, swapIn } from "./anim";
import { c, font, radius, shadow, space, tokens } from "./theme";
import { Txt, type Tone } from "./Txt";
import { Press } from "./Press";
import { Odometer } from "./Odometer";

export type IconName = keyof typeof Ionicons.glyphMap;

// Haptics are a courtesy, never a dependency: a device without a motor, or a
// web preview, must not throw out of a button press. One per action, in the
// same frame as the visual change, and never the only feedback.
export function tap(style: "light" | "medium" | "heavy" = "light") {
  const map = {
    light: Haptics.ImpactFeedbackStyle.Light,
    medium: Haptics.ImpactFeedbackStyle.Medium,
    heavy: Haptics.ImpactFeedbackStyle.Heavy,
  };
  Haptics.impactAsync(map[style]).catch(() => {});
}

/** A value ticking past a step: a segment, a chip, a checkbox. */
export function selection() {
  Haptics.selectionAsync().catch(() => {});
}

export function notify(kind: "success" | "warning" | "error") {
  const map = {
    success: Haptics.NotificationFeedbackType.Success,
    warning: Haptics.NotificationFeedbackType.Warning,
    error: Haptics.NotificationFeedbackType.Error,
  };
  Haptics.notificationAsync(map[kind]).catch(() => {});
}

// ---------------------------------------------------------------------------

type ButtonVariant = "primary" | "highlight" | "secondary" | "quiet" | "danger" | "dangerSolid" | "dark";

interface ButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly variant?: ButtonVariant;
  readonly icon?: IconName;
  readonly loading?: boolean;
  readonly disabled?: boolean;
  /**
   * A trailing figure: a price on the Book button. Digits roll when it changes,
   * so choosing a different vehicle visibly changes what you are agreeing to.
   */
  readonly trailing?: string;
  readonly compact?: boolean;
  readonly style?: StyleProp<ViewStyle>;
}

const BUTTON: Record<ButtonVariant, { bg: string; fg: Tone; spinner: string }> = {
  primary: { bg: c.accent, fg: "inverse", spinner: c.onAccent },
  // The brand's yellow, for the one button on a screen that is the whole
  // point of it: booking, accepting an offer.
  highlight: { bg: c.highlight, fg: "onHighlight", spinner: c.onHighlight },
  dark: { bg: c.textStrong, fg: "inverse", spinner: c.onAccent },
  secondary: { bg: c.surfaceHigh, fg: "strong", spinner: c.textStrong },
  quiet: { bg: "transparent", fg: "accent", spinner: c.accent },
  danger: { bg: c.dangerSoft, fg: "bad", spinner: c.danger },
  dangerSolid: { bg: c.danger, fg: "inverse", spinner: c.onAccent },
};

export function Button({
  label,
  onPress,
  variant = "primary",
  icon,
  loading,
  disabled,
  trailing,
  compact,
  style,
}: ButtonProps) {
  const b = BUTTON[variant];
  const glow = variant === "highlight" && !disabled && !loading;
  const off = disabled || loading;
  const strong = variant === "primary" || variant === "highlight" || variant === "dark" || variant === "dangerSolid";
  return (
    <Press
      onPress={() => {
        if (strong) tap("medium");
        onPress();
      }}
      disabled={off}
      scaleTo={variant === "quiet" ? 1 : 0.97}
      accessibilityRole="button"
      accessibilityLabel={trailing ? `${label}, ${trailing}` : label}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      style={[
        styles.button,
        compact && styles.buttonCompact,
        { backgroundColor: b.bg },
        trailing ? styles.buttonSplit : null,
        glow && shadow.glow,
        off && !loading && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <Animated.View entering={fadeIn} style={styles.spinner}>
          <ActivityIndicator color={b.spinner} />
        </Animated.View>
      ) : (
        <>
          <View style={styles.buttonMain}>
            {icon ? <Ionicons name={icon} size={19} color={toneColour(b.fg)} /> : null}
            <Txt v="bodyStrong" tone={b.fg} style={compact ? null : styles.buttonText}>
              {label}
            </Txt>
          </View>
          {trailing ? <Odometer value={trailing} v="figure" tone={b.fg} style={styles.trailing} /> : null}
        </>
      )}
    </Press>
  );
}

function toneColour(t: Tone): string {
  switch (t) {
    case "inverse":
      return c.onAccent;
    case "accent":
      return c.accent;
    case "bad":
      return c.danger;
    default:
      return c.textStrong;
  }
}

/** A round icon button that floats over the map. */
export function FloatButton({
  icon,
  onPress,
  label,
  tone = "default",
  style,
}: {
  readonly icon: IconName;
  readonly onPress: () => void;
  readonly label: string;
  readonly tone?: "default" | "bad" | "accent";
  readonly style?: StyleProp<ViewStyle>;
}) {
  return (
    <Press
      onPress={() => {
        tap();
        onPress();
      }}
      scaleTo={0.92}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={[styles.float, tone === "bad" && styles.floatBad, style]}
    >
      <Ionicons name={icon} size={22} color={tone === "bad" ? c.danger : tone === "accent" ? c.accent : c.textStrong} />
    </Press>
  );
}

/** A quiet round icon button for headers and rows: back, close, more. */
export function IconButton({
  icon,
  onPress,
  label,
  tone = "default",
  size = 40,
}: {
  readonly icon: IconName;
  readonly onPress: () => void;
  readonly label: string;
  readonly tone?: "default" | "accent" | "bad" | "onDark";
  readonly size?: number;
}) {
  const colour = tone === "accent" ? c.accent : tone === "bad" ? c.danger : tone === "onDark" ? c.onAccent : c.textStrong;
  return (
    <Press
      onPress={onPress}
      scaleTo={0.9}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.iconButton, { width: size, height: size, borderRadius: size / 2 }]}
    >
      <Ionicons name={icon} size={Math.round(size * 0.58)} color={colour} />
    </Press>
  );
}

// ---------------------------------------------------------------------------

export type ChipTone = "neutral" | "accent" | "good" | "bad" | "warn";

const CHIP: Record<ChipTone, { bg: string; fg: Tone; icon: string }> = {
  neutral: { bg: c.surfaceHigh, fg: "muted", icon: c.textMuted },
  accent: { bg: c.accentSoft, fg: "accent", icon: c.accent },
  good: { bg: c.successSoft, fg: "good", icon: c.success },
  bad: { bg: c.dangerSoft, fg: "bad", icon: c.danger },
  warn: { bg: c.warningSoft, fg: "warn", icon: c.warning },
};

export function Chip({
  label,
  tone = "neutral",
  icon,
  dot,
  onPress,
  selected,
}: {
  readonly label: string;
  readonly tone?: ChipTone;
  readonly icon?: IconName;
  /** A solid dot - "live" states, where the colour is the message. */
  readonly dot?: boolean;
  /** A chip that is also a choice: a saved place, a filter. */
  readonly onPress?: () => void;
  readonly selected?: boolean;
}) {
  const t = CHIP[tone];
  const inner = (
    <>
      {dot ? <View style={[styles.dot, { backgroundColor: t.icon }]} /> : null}
      {icon ? <Ionicons name={icon} size={13} color={selected ? c.onAccent : t.icon} /> : null}
      <Txt v="caption" tone={selected ? "inverse" : t.fg}>
        {label}
      </Txt>
    </>
  );
  if (!onPress) return <View style={[styles.chip, { backgroundColor: t.bg }]}>{inner}</View>;
  return (
    <Press
      onPress={() => {
        selection();
        onPress();
      }}
      scaleTo={0.95}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      accessibilityLabel={label}
      style={[styles.chip, styles.chipTap, { backgroundColor: selected ? c.textStrong : t.bg }]}
    >
      {inner}
    </Press>
  );
}

// ---------------------------------------------------------------------------

export function Banner({
  tone,
  icon,
  children,
  action,
}: {
  readonly tone: "warn" | "bad" | "good" | "accent";
  readonly icon: IconName;
  readonly children: ReactNode;
  readonly action?: { label: string; onPress: () => void };
}) {
  const t = CHIP[tone];
  return (
    <Animated.View entering={swapIn} style={[styles.banner, { backgroundColor: t.bg }]} accessibilityRole={tone === "bad" ? "alert" : undefined}>
      <Ionicons name={icon} size={18} color={t.icon} style={styles.bannerIcon} />
      <View style={styles.flex}>
        <Txt v="label" tone={t.fg}>
          {children}
        </Txt>
      </View>
      {action ? (
        <Pressable onPress={action.onPress} accessibilityRole="button" hitSlop={10}>
          <Txt v="label" tone={t.fg} style={styles.bannerAction}>
            {action.label}
          </Txt>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

export function Avatar({ name, size = 44, tone = "accent" }: { readonly name: string; readonly size?: number; readonly tone?: "accent" | "dark" | "highlight" }) {
  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2 },
        tone === "dark" && { backgroundColor: c.accentDeep },
        tone === "highlight" && { backgroundColor: c.highlight },
      ]}
      accessibilityElementsHidden
    >
      <Txt
        v="bodyStrong"
        tone={tone === "dark" ? "inverse" : tone === "highlight" ? "onHighlight" : "accent"}
        style={{ fontSize: size * 0.42, lineHeight: size * 0.52, fontFamily: font.numBold }}
      >
        {(name.trim().charAt(0) || "?").toUpperCase()}
      </Txt>
    </View>
  );
}

/**
 * A round action with its name under it: call, share, navigate. A row of these
 * reads as "things I can do on this trip" without a single sentence of copy,
 * and a round well is easy to hit with a thumb on a moving bike.
 */
export function QuickAction({
  icon,
  label,
  onPress,
  tone,
  disabled,
  badge,
}: {
  readonly icon: IconName;
  readonly label: string;
  readonly onPress: () => void;
  readonly tone?: "bad" | "accent";
  readonly disabled?: boolean;
  /** Something new behind this action: an unread message. */
  readonly badge?: boolean;
}) {
  const fg = tone === "bad" ? c.danger : tone === "accent" ? c.onAccent : c.textStrong;
  return (
    <Press
      onPress={() => {
        tap();
        onPress();
      }}
      disabled={disabled}
      scaleTo={0.94}
      style={[styles.quick, disabled && styles.disabled]}
      accessibilityRole="button"
      accessibilityLabel={badge ? `${label}, new` : label}
      accessibilityState={{ disabled: !!disabled }}
    >
      <View style={[styles.quickWell, tone === "bad" && styles.quickWellBad, tone === "accent" && styles.quickWellAccent]}>
        <Ionicons name={icon} size={22} color={fg} />
        {badge ? <View style={styles.quickBadge} /> : null}
      </View>
      <Txt v="caption" tone={tone === "bad" ? "bad" : "muted"} align="center" lines={1}>
        {label}
      </Txt>
    </Press>
  );
}

/** Quick actions spread across the sheet. */
export function QuickActions({ children }: { readonly children: ReactNode }) {
  return <View style={styles.quickRow}>{children}</View>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  button: {
    minHeight: tokens.MIN_TOUCH_TARGET + 8,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },
  buttonCompact: { minHeight: tokens.MIN_TOUCH_TARGET - 4, paddingHorizontal: space.md },
  buttonSplit: { justifyContent: "space-between" },
  buttonMain: { flexDirection: "row", alignItems: "center", gap: space.sm },
  buttonText: { fontFamily: font.bold, fontSize: 16, lineHeight: 22, letterSpacing: 0.1 },
  spinner: { height: 24, justifyContent: "center" },
  trailing: { fontSize: 22, lineHeight: 26 },
  disabled: { opacity: 0.4 },
  float: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: c.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.float,
  },
  floatBad: { backgroundColor: c.surfaceRaised },
  iconButton: { alignItems: "center", justifyContent: "center" },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  chipTap: { paddingHorizontal: 12, paddingVertical: 8 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  banner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
  },
  bannerIcon: { marginTop: 1 },
  bannerAction: { textDecorationLine: "underline" },
  avatar: { backgroundColor: c.accentSoft, alignItems: "center", justifyContent: "center" },
  quickRow: { flexDirection: "row", justifyContent: "space-around", paddingTop: space.xs },
  quick: { alignItems: "center", gap: 6, minWidth: 72, maxWidth: 96 },
  quickWell: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: c.surfaceHigh,
    alignItems: "center",
    justifyContent: "center",
  },
  quickWellBad: { backgroundColor: c.dangerSoft },
  quickWellAccent: { backgroundColor: c.accent },
  quickBadge: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 13,
    height: 13,
    borderRadius: 7,
    backgroundColor: c.highlight,
    borderWidth: 2,
    borderColor: c.surfaceRaised,
  },
});
