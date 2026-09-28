import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { dur, ease } from "./anim";
import { c, radius } from "./theme";
import { Txt } from "./Txt";
import { selection, type IconName } from "./controls";

export interface SegmentOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly icon?: IconName;
  readonly disabled?: boolean;
  /** For a verdict - OK, Fail - the pill takes the verdict's colour. */
  readonly tone?: "good" | "bad" | "warn";
}

const TONE_BG = { good: c.success, bad: c.danger, warn: c.warning } as const;

/**
 * A choice of two to four, shown side by side. The white pill travels to the
 * chosen segment - movement across the control, so ease-in-out - and it is the
 * only thing that moves; the labels just change weight.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  compact,
}: {
  readonly options: readonly SegmentOption<T>[];
  readonly value: T | null;
  readonly onChange: (v: T) => void;
  /** Read by screen readers as the name of the whole control. */
  readonly label: string;
  readonly compact?: boolean;
}) {
  const frames = useRef<Record<string, { x: number; w: number }>>({});
  const [ready, setReady] = useState(false);
  const x = useSharedValue(0);
  const w = useSharedValue(0);
  const placed = useRef(false);
  const last = useRef<T | null>(value);
  const toneOf = (v: T | null) => {
    const t = options.find((o) => o.value === v)?.tone;
    return t ? TONE_BG[t] : c.surfaceRaised;
  };
  const from = useSharedValue<string>(toneOf(value));
  const to = useSharedValue<string>(toneOf(value));
  const mix = useSharedValue(1);

  const place = (v: T | null, animate: boolean) => {
    const f = v !== null ? frames.current[v] : undefined;
    if (!f) return;
    if (animate) {
      x.set(withTiming(f.x, { duration: 250, easing: ease.inOut }));
      w.set(withTiming(f.w, { duration: 250, easing: ease.inOut }));
    } else {
      x.set(f.x);
      w.set(f.w);
    }
  };

  // Keep the pill where the value is, however the value changed. Written in an
  // effect, never during render: a shared value set mid-render fires mid-commit.
  useEffect(() => {
    // The first answer appears in place; only a change of answer travels.
    if (placed.current) place(value, last.current !== null);
    last.current = value;
    from.set(to.get());
    to.set(toneOf(value));
    mix.set(0);
    mix.set(withTiming(1, { duration: 250, easing: ease.inOut }));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const onLayout = (v: T) => (e: LayoutChangeEvent) => {
    frames.current[v] = { x: e.nativeEvent.layout.x, w: e.nativeEvent.layout.width };
    if (Object.keys(frames.current).length === options.length && !placed.current) {
      placed.current = true;
      place(value, false);
      setReady(true);
    }
  };

  // Absolutely positioned with no children, so animating its width is cheap.
  const pill = useAnimatedStyle(() => ({
    width: w.get(),
    transform: [{ translateX: x.get() }],
    backgroundColor: interpolateColor(mix.get(), [0, 1], [from.get(), to.get()]),
  }));

  return (
    <View style={[styles.track, compact && styles.trackCompact]} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <Animated.View style={[styles.pill, { opacity: ready && value !== null ? 1 : 0 }, pill]} />
      {options.map((o) => {
        const on = o.value === value;
        const inverse = on && !!o.tone;
        return (
          <Pressable
            key={o.value}
            onLayout={onLayout(o.value)}
            disabled={o.disabled}
            onPress={() => {
              if (on) return;
              selection();
              onChange(o.value);
            }}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, disabled: o.disabled }}
            accessibilityLabel={o.label}
            style={[styles.item, compact && styles.itemCompact, o.disabled && styles.disabled]}
          >
            {o.icon ? <Ionicons name={o.icon} size={16} color={inverse ? c.onAccent : on ? c.textStrong : c.textMuted} /> : null}
            <Txt v="label" tone={inverse ? "inverse" : on ? "strong" : "muted"} style={on ? styles.onText : null} lines={1}>
              {o.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: "row",
    backgroundColor: c.surfaceHigh,
    borderRadius: radius.pill,
    padding: 3,
  },
  trackCompact: { alignSelf: "flex-start" },
  pill: {
    position: "absolute",
    top: 3,
    bottom: 3,
    left: 0,
    borderRadius: radius.pill,
    backgroundColor: c.surfaceRaised,
    shadowColor: "#0B0D12",
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  item: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
  },
  // Longhands, not flex: 0 - on the web that shorthand sets a zero basis and
  // the segment collapses to its minimum width, cutting the label off.
  itemCompact: { flexGrow: 0, flexShrink: 0, flexBasis: "auto", minHeight: 34, paddingHorizontal: 14, minWidth: 44 },
  onText: { fontFamily: "Barlow_600SemiBold" },
  disabled: { opacity: 0.35 },
});
