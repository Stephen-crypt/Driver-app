import { useEffect, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { dur, ease } from "./anim";
import { c, space } from "./theme";
import { Txt } from "./Txt";
import { Press } from "./Press";
import { selection, type IconName } from "./controls";

function useOn(on: boolean): SharedValue<number> {
  const reduce = useReducedMotion();
  const t = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    t.set(reduce ? (on ? 1 : 0) : withTiming(on ? 1 : 0, { duration: dur.small, easing: ease.out }));
  }, [on, reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  return t;
}

/**
 * A tick box that fills when ticked. The box dips as it fills - the small
 * press a real box gives under a pen - and the tick grows in from most of its
 * size, never from nothing.
 */
export function CheckMark({ on, tone = "good", size = 30 }: { readonly on: boolean; readonly tone?: "good" | "accent"; readonly size?: number }) {
  const reduce = useReducedMotion();
  const t = useOn(on);
  const pop = useSharedValue(1);
  const colour = tone === "good" ? c.success : c.accent;
  useEffect(() => {
    if (!on || reduce) return;
    pop.set(withSequence(withTiming(0.86, { duration: 90, easing: ease.out }), withTiming(1, { duration: 220, easing: ease.out })));
  }, [on, reduce]); // eslint-disable-line react-hooks/exhaustive-deps

  const box = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(t.get(), [0, 1], [c.surfaceRaised, colour]),
    borderColor: interpolateColor(t.get(), [0, 1], [c.border, colour]),
    transform: [{ scale: pop.get() }],
  }));
  const tick = useAnimatedStyle(() => ({ opacity: t.get(), transform: [{ scale: 0.6 + 0.4 * t.get() }] }));
  return (
    <Animated.View style={[styles.box, { width: size, height: size, borderRadius: Math.round(size / 3) }, box]}>
      <Animated.View style={tick}>
        <Ionicons name="checkmark" size={Math.round(size * 0.66)} color={c.onAccent} />
      </Animated.View>
    </Animated.View>
  );
}

/** One of several: the ring takes the accent and the dot grows into it. */
export function RadioMark({ on, size = 26 }: { readonly on: boolean; readonly size?: number }) {
  const t = useOn(on);
  const ring = useAnimatedStyle(() => ({ borderColor: interpolateColor(t.get(), [0, 1], [c.border, c.accent]) }));
  const dot = useAnimatedStyle(() => ({ opacity: t.get(), transform: [{ scale: 0.4 + 0.6 * t.get() }] }));
  const d = Math.round(size * 0.5);
  return (
    <Animated.View style={[styles.ring, { width: size, height: size, borderRadius: size / 2 }, ring]}>
      <Animated.View style={[{ width: d, height: d, borderRadius: d / 2, backgroundColor: c.accent }, dot]} />
    </Animated.View>
  );
}

function IconWell({ icon, on }: { icon: IconName; on: boolean }) {
  const t = useOn(on);
  const well = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(t.get(), [0, 1], [c.surfaceHigh, c.accent]) }));
  return (
    <Animated.View style={[styles.well, well]}>
      <Ionicons name={icon} size={18} color={on ? c.onAccent : c.textMuted} />
    </Animated.View>
  );
}

/**
 * A row that is a choice: a check in a checklist, or one option of several.
 * With an icon it becomes the larger kind - an icon well that takes the
 * accent, a soft wash behind the row, and the mark at the end.
 */
export function ChoiceRow({
  kind,
  on,
  onPress,
  title,
  hint,
  icon,
  trailing,
  disabled,
}: {
  readonly kind: "check" | "radio";
  readonly on: boolean;
  readonly onPress: () => void;
  readonly title: string;
  readonly hint?: string;
  readonly icon?: IconName;
  /** Drawn before the mark: a warning icon, a count. */
  readonly trailing?: ReactNode;
  readonly disabled?: boolean;
}) {
  const t = useOn(on && !!icon);
  const wash = useAnimatedStyle(() => ({ opacity: t.get() }));
  const mark = kind === "check" ? <CheckMark on={on} size={icon ? 24 : 30} /> : <RadioMark on={on} size={icon ? 22 : 26} />;
  return (
    <Press
      onPress={() => {
        selection();
        onPress();
      }}
      disabled={disabled}
      scaleTo={1}
      bg={c.surfaceRaised}
      pressedBg={c.surfaceHigh}
      style={[styles.row, disabled && styles.disabled]}
      accessibilityRole={kind === "check" ? "checkbox" : "radio"}
      accessibilityState={kind === "check" ? { checked: on, disabled: !!disabled } : { selected: on, disabled: !!disabled }}
      accessibilityLabel={hint ? `${title}. ${hint}` : title}
    >
      {icon ? <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.wash, wash]} /> : null}
      {icon ? <IconWell icon={icon} on={on} /> : mark}
      <View style={styles.text}>
        <Txt v="bodyStrong">{title}</Txt>
        {hint ? (
          <Txt v="label" tone="muted">
            {hint}
          </Txt>
        ) : null}
      </View>
      {trailing}
      {icon ? mark : null}
    </Press>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 2, alignItems: "center", justifyContent: "center" },
  ring: { borderWidth: 2, alignItems: "center", justifyContent: "center" },
  well: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, minHeight: 68 },
  wash: { backgroundColor: c.accentSoft },
  text: { flex: 1, minWidth: 0, gap: 1 },
  disabled: { opacity: 0.4 },
});
