import { useEffect, useState } from "react";
import { StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { dur, ease } from "./anim";
import { c, radius, space } from "./theme";
import { Txt } from "./Txt";

// ---------------------------------------------------------------------------
// Skeleton: the shape of what is loading, breathing slowly. A spinner says
// "wait"; a skeleton says "this is what is coming", so the screen does not jump
// when it arrives.
// ---------------------------------------------------------------------------

export function Skeleton({
  width = "100%",
  height = 14,
  r = 7,
  style,
}: {
  readonly width?: DimensionValue;
  readonly height?: number;
  readonly r?: number;
  readonly style?: StyleProp<ViewStyle>;
}) {
  const reduce = useReducedMotion();
  const o = useSharedValue(0.55);
  useEffect(() => {
    if (reduce) return;
    o.set(withRepeat(withTiming(1, { duration: 900, easing: ease.inOut }), -1, true));
  }, [reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  const a = useAnimatedStyle(() => ({ opacity: o.get() }));
  return <Animated.View style={[{ width, height, borderRadius: r, backgroundColor: c.surfaceHigh }, a, style]} />;
}

/** Rows as they will look: an icon well and two lines of text. */
export function SkeletonRows({ count = 3 }: { readonly count?: number }) {
  return (
    <View style={styles.group} accessibilityLabel="Loading" accessibilityRole="progressbar">
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={styles.skRow}>
          <Skeleton width={38} height={38} r={12} />
          <View style={styles.skText}>
            <Skeleton width="62%" height={14} />
            <Skeleton width="38%" height={11} />
          </View>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Success mark: the circle arrives, then the tick is drawn across it. Used for
// the few moments that are genuinely finished - a trip completed, a report
// sent, a shift ended - so it never becomes wallpaper.
// ---------------------------------------------------------------------------

export function SuccessMark({ size = 76, tone = "good" }: { readonly size?: number; readonly tone?: "good" | "accent" }) {
  const reduce = useReducedMotion();
  const bg = tone === "good" ? c.success : c.accent;
  const s = useSharedValue(reduce ? 1 : 0);
  const wipe = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    if (reduce) return;
    s.set(withTiming(1, { duration: dur.enter, easing: ease.out }));
    wipe.set(withDelay(160, withTiming(1, { duration: 340, easing: ease.inOut })));
  }, [reduce]); // eslint-disable-line react-hooks/exhaustive-deps

  const disc = useAnimatedStyle(() => ({ opacity: s.get(), transform: [{ scale: 0.85 + 0.15 * s.get() }] }));
  // A cover the colour of the disc slides off the tick, left to right: the tick
  // is "drawn" with nothing but a transform, which every platform does well.
  const cover = useAnimatedStyle(() => ({ transform: [{ translateX: wipe.get() * size }] }));

  return (
    <Animated.View
      style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, overflow: "hidden" }, disc]}
      accessibilityElementsHidden
    >
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Path d="M28 52 L44 67 L74 36" stroke={c.onAccent} strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </Svg>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: bg }, cover]} />
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Live dot: something is happening now - online, on a trip, a live alert.
// ---------------------------------------------------------------------------

export function LiveDot({
  tone = "good",
  size = 8,
  onDark,
}: {
  readonly tone?: "good" | "accent" | "bad";
  readonly size?: number;
  /** On a blue or black ground the brand greens go muddy; a lighter one reads. */
  readonly onDark?: boolean;
}) {
  const reduce = useReducedMotion();
  const colour = onDark && tone === "good" ? "#4ADE80" : tone === "good" ? c.success : tone === "bad" ? c.danger : c.accent;
  const p = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    p.set(withRepeat(withSequence(withTiming(1, { duration: 1400, easing: ease.out }), withTiming(0, { duration: 0 })), -1));
  }, [reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  const halo = useAnimatedStyle(() => ({ opacity: 0.45 * (1 - p.get()), transform: [{ scale: 1 + p.get() * 1.6 }] }));
  return (
    <View style={{ width: size, height: size }} accessibilityElementsHidden>
      <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: size / 2, backgroundColor: colour }, halo]} />
      <View style={[StyleSheet.absoluteFill, { borderRadius: size / 2, backgroundColor: colour }]} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Step track: where a trip is, as a row of segments. Finished segments are
// solid, the current one fills, the rest wait. The label under it names the
// current step only - the others are not news.
// ---------------------------------------------------------------------------

export function StepTrack({
  steps,
  current,
  tone = "accent",
}: {
  readonly steps: readonly string[];
  /** Index of the step under way. steps.length means all done. */
  readonly current: number;
  readonly tone?: "accent" | "good";
}) {
  const colour = tone === "good" ? c.success : c.accent;
  return (
    <View style={styles.track} accessibilityRole="progressbar" accessibilityLabel={steps[Math.min(current, steps.length - 1)] ?? ""} accessibilityValue={{ min: 0, max: steps.length, now: current }}>
      {steps.map((s, i) => (
        <Segment key={s} fill={i < current ? 1 : i === current ? 0.5 : 0} colour={colour} live={i === current} />
      ))}
    </View>
  );
}

function Segment({ fill, colour, live }: { fill: number; colour: string; live: boolean }) {
  const reduce = useReducedMotion();
  const [w, setW] = useState(0);
  const f = useSharedValue(0);
  const pulse = useSharedValue(1);
  useEffect(() => {
    f.set(reduce ? fill : withTiming(fill, { duration: 480, easing: ease.inOut }));
  }, [fill, reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!live || reduce) {
      pulse.set(1);
      return;
    }
    pulse.set(withRepeat(withTiming(0.55, { duration: 900, easing: ease.inOut }), -1, true));
  }, [live, reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  // Hidden outright when empty: a fill parked at -width still leaves a sliver of
  // its rounded end showing at the segment's start.
  const a = useAnimatedStyle(() => ({ opacity: f.get() <= 0.001 ? 0 : pulse.get(), transform: [{ translateX: -(1 - f.get()) * w }] }));
  return (
    <View style={styles.segment} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colour, borderRadius: 2 }, a]} />
    </View>
  );
}

/** The step track with its current label, as it sits in a trip card. */
export function TripProgress({ steps, current, note }: { readonly steps: readonly string[]; readonly current: number; readonly note?: string }) {
  return (
    <View style={styles.progress}>
      <StepTrack steps={steps} current={current} />
      <View style={styles.progressText}>
        <Txt v="label" tone="accent">
          {steps[Math.min(current, steps.length - 1)]}
        </Txt>
        {note ? (
          <Txt v="label" tone="muted">
            {note}
          </Txt>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { backgroundColor: c.surfaceRaised, borderRadius: radius.lg, paddingVertical: space.xs },
  skRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.md, paddingVertical: 12 },
  skText: { flex: 1, gap: 8 },
  track: { flexDirection: "row", gap: 4 },
  segment: { flex: 1, height: 4, borderRadius: 2, backgroundColor: c.surfaceHigh, overflow: "hidden" },
  progress: { gap: space.sm },
  progressText: { flexDirection: "row", justifyContent: "space-between", gap: space.sm },
});
