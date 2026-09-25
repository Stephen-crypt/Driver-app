import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { c, radius, space, tokens } from "./theme";
import { Txt, type Tone } from "./Txt";

export type IconName = keyof typeof Ionicons.glyphMap;

// Haptics are a courtesy, never a dependency: a device without a motor, or a
// web preview, must not throw out of a button press.
export function tap(style: "light" | "medium" | "heavy" = "light") {
  const map = {
    light: Haptics.ImpactFeedbackStyle.Light,
    medium: Haptics.ImpactFeedbackStyle.Medium,
    heavy: Haptics.ImpactFeedbackStyle.Heavy,
  };
  Haptics.impactAsync(map[style]).catch(() => {});
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

type ButtonVariant = "primary" | "secondary" | "quiet" | "danger" | "dark";

interface ButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly variant?: ButtonVariant;
  readonly icon?: IconName;
  readonly loading?: boolean;
  readonly disabled?: boolean;
  /** A trailing figure: "Book · 1,700 RWF" puts the price here. */
  readonly trailing?: string;
  readonly compact?: boolean;
  readonly style?: StyleProp<ViewStyle>;
}

const BUTTON: Record<ButtonVariant, { bg: string; fg: Tone; spinner: string }> = {
  primary: { bg: c.accent, fg: "inverse", spinner: c.onAccent },
  dark: { bg: c.textStrong, fg: "inverse", spinner: c.onAccent },
  secondary: { bg: c.surfaceHigh, fg: "strong", spinner: c.textStrong },
  quiet: { bg: "transparent", fg: "accent", spinner: c.accent },
  danger: { bg: c.dangerSoft, fg: "bad", spinner: c.danger },
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
  const off = disabled || loading;
  return (
    <Pressable
      onPress={() => {
        tap(variant === "primary" || variant === "dark" ? "medium" : "light");
        onPress();
      }}
      disabled={off}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        { backgroundColor: b.bg },
        trailing ? styles.buttonSplit : null,
        pressed && !off && styles.pressed,
        off && !loading && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={b.spinner} />
      ) : (
        <>
          <View style={styles.buttonMain}>
            {icon ? <Ionicons name={icon} size={19} color={toneColour(b.fg)} /> : null}
            <Txt v="bodyStrong" tone={b.fg} style={compact ? null : styles.buttonText}>
              {label}
            </Txt>
          </View>
          {trailing ? (
            <Txt v="figure" tone={b.fg} tabularNums style={styles.trailing}>
              {trailing}
            </Txt>
          ) : null}
        </>
      )}
    </Pressable>
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
  readonly tone?: "default" | "bad";
  readonly style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={() => {
        tap();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.float, pressed && styles.pressed, style]}
    >
      <Ionicons name={icon} size={22} color={tone === "bad" ? c.danger : c.textStrong} />
    </Pressable>
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
}: {
  readonly label: string;
  readonly tone?: ChipTone;
  readonly icon?: IconName;
  /** A solid dot - "live" states, where the colour is the message. */
  readonly dot?: boolean;
}) {
  const t = CHIP[tone];
  return (
    <View style={[styles.chip, { backgroundColor: t.bg }]}>
      {dot ? <View style={[styles.dot, { backgroundColor: t.icon }]} /> : null}
      {icon ? <Ionicons name={icon} size={13} color={t.icon} /> : null}
      <Txt v="caption" tone={t.fg}>
        {label}
      </Txt>
    </View>
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
    <View style={[styles.banner, { backgroundColor: t.bg }]}>
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
    </View>
  );
}

export function Avatar({ name, size = 44 }: { readonly name: string; readonly size?: number }) {
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Txt v="bodyStrong" tone="accent" style={{ fontSize: size * 0.4, lineHeight: size * 0.5 }}>
        {(name.trim().charAt(0) || "?").toUpperCase()}
      </Txt>
    </View>
  );
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
  buttonCompact: { minHeight: tokens.MIN_TOUCH_TARGET, paddingHorizontal: space.md },
  buttonSplit: { justifyContent: "space-between" },
  buttonMain: { flexDirection: "row", alignItems: "center", gap: space.sm },
  buttonText: { fontSize: 17 },
  trailing: { fontSize: 22, lineHeight: 26 },
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.92 },
  disabled: { opacity: 0.4 },
  float: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: c.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0B0D12",
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
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
});
