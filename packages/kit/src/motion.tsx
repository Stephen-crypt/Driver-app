import { useEffect, useState, type ReactNode } from "react";
import { StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  Easing,
  FadeIn,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import Svg, { Circle } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import { dur, ease, spring } from "./anim";
import { c, font, radius, space } from "./theme";
import { Txt } from "./Txt";
import { Odometer } from "./Odometer";
import { Press } from "./Press";
import { notify, tap, type IconName } from "./controls";

// ---------------------------------------------------------------------------
// Slide to confirm.
//
// Going online, arriving, and finishing a trip are all things a rider does with
// a phone in a mount or a pocket. A tap target fires by accident; a deliberate
// slide does not. It is the rider app's one physical gesture, so it gets real
// physics: the knob follows the thumb on the UI thread, and a knob let go short
// of the end springs home carrying the thumb's speed.
// ---------------------------------------------------------------------------

const KNOB = 56;
const TRACK_PAD = 4;

export function SlideToConfirm({
  label,
  onConfirm,
  tone = "accent",
  icon = "arrow-forward",
  disabled,
}: {
  readonly label: string;
  readonly onConfirm: () => void;
  readonly tone?: "accent" | "good" | "bad" | "dark";
  readonly icon?: IconName;
  readonly disabled?: boolean;
}) {
  const reduce = useReducedMotion();
  const [width, setWidth] = useState(0);
  const max = useSharedValue(0);
  const x = useSharedValue(0);
  const busy = useSharedValue(0);
  const nudge = useSharedValue(0);

  const colour =
    tone === "good" ? c.success : tone === "bad" ? c.danger : tone === "dark" ? c.textStrong : c.accent;

  useEffect(() => {
    max.set(Math.max(0, width - KNOB - TRACK_PAD * 2));
  }, [width]); // eslint-disable-line react-hooks/exhaustive-deps

  // Every couple of seconds the arrow leans the way it wants to go.
  useEffect(() => {
    if (disabled || reduce) {
      nudge.set(0);
      return;
    }
    nudge.set(
      withRepeat(
        withSequence(
          withDelay(2200, withTiming(9, { duration: 220, easing: ease.out })),
          withTiming(0, { duration: 280, easing: ease.inOut }),
        ),
        -1,
      ),
    );
  }, [disabled, reduce]); // eslint-disable-line react-hooks/exhaustive-deps

  const confirmed = () => {
    notify("success");
    onConfirm();
    x.set(withDelay(450, withTiming(0, { duration: 280, easing: ease.out })));
    busy.set(0);
  };
  const touch = () => tap();

  const pan = Gesture.Pan()
    .enabled(!disabled)
    .activeOffsetX([-4, 4])
    .failOffsetY([-24, 24])
    .onBegin(() => {
      scheduleOnRN(touch);
    })
    .onUpdate((e) => {
      if (busy.get()) return;
      x.set(Math.max(0, Math.min(max.get(), e.translationX)));
    })
    .onEnd((e) => {
      if (busy.get()) return;
      const done = x.get() >= max.get() * 0.86 || (e.velocityX > 1400 && x.get() > max.get() * 0.45);
      if (done) {
        busy.set(1);
        x.set(withTiming(max.get(), { duration: 90, easing: ease.out }));
        scheduleOnRN(confirmed);
      } else {
        x.set(withSpring(0, { ...spring.drag, velocity: e.velocityX }));
      }
    });

  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));
  const arrow = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() > 1 ? 0 : nudge.get() }] }));
  const text = useAnimatedStyle(() => ({ opacity: 1 - Math.min(1, x.get() / Math.max(1, max.get() * 0.6)) }));
  // The part of the track the knob has crossed lightens, like a switch filling.
  const trail = useAnimatedStyle(() => ({ width: x.get() + KNOB + TRACK_PAD }));

  return (
    <View
      style={[styles.track, { backgroundColor: colour }, disabled && styles.disabled]}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityHint="Slide right to confirm"
      accessibilityActions={[{ name: "activate" }]}
      onAccessibilityAction={() => !disabled && onConfirm()}
      pointerEvents={disabled ? "none" : "auto"}
    >
      <Animated.View style={[styles.trail, trail]} pointerEvents="none" />
      <Animated.View style={[styles.trackLabel, text]} pointerEvents="none">
        <Txt v="bodyStrong" tone="inverse" style={styles.trackText}>
          {label}
        </Txt>
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.knob, knob]} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Animated.View style={arrow}>
            <Ionicons name={icon} size={24} color={colour} />
          </Animated.View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Countdown ring - the offer's fifteen seconds. The arc drains continuously
// rather than in one-second steps, and the number turns like a board.
// ---------------------------------------------------------------------------

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export function CountdownRing({
  total,
  remaining,
  size = 88,
  stroke = 7,
}: {
  readonly total: number;
  readonly remaining: number;
  readonly size?: number;
  readonly stroke?: number;
}) {
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const now = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;
  const next = total > 0 ? Math.max(0, Math.min(1, (remaining - 1) / total)) : 0;
  const f = useSharedValue(now);
  const urgent = remaining <= 5;
  const colour = urgent ? c.danger : c.accent;

  useEffect(() => {
    // Heading to the next second's value across this second: continuous.
    f.set(now);
    f.set(withTiming(next, { duration: 1000, easing: Easing.linear }));
  }, [remaining, total]); // eslint-disable-line react-hooks/exhaustive-deps

  const arc = useAnimatedProps(() => ({ strokeDashoffset: circumference * (1 - f.get()) }));

  return (
    <View style={{ width: size, height: size }} accessibilityLabel={`${remaining} seconds left`}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={c.surfaceHigh} strokeWidth={stroke} fill="none" />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={colour}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          animatedProps={arc}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.ringCentre]}>
        {/* A clock, so it does not roll: a digit turning every second would be
            mid-turn more often than readable, with fifteen seconds to decide. */}
        <Odometer
          value={String(Math.max(0, remaining))}
          v="display"
          tone={urgent ? "bad" : "strong"}
          roll={false}
          style={{ fontSize: size * 0.4, lineHeight: Math.round(size * 0.46) }}
        />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Bars - a week of earnings. No axis, no gridlines: seven bars and the one
// figure that matters (today) written on its bar. They grow from the baseline
// on arrival, left to right.
// ---------------------------------------------------------------------------

export function Bars({
  values,
  labels,
  highlight,
  height = 150,
  format = (n: number) => String(n),
}: {
  readonly values: readonly number[];
  readonly labels: readonly string[];
  readonly highlight: number;
  readonly height?: number;
  readonly format?: (n: number) => string;
}) {
  const max = Math.max(1, ...values);
  const top = 28;
  const chartH = Math.max(8, height - top);
  const hv = values[highlight];

  return (
    <View>
      <View style={[styles.bars, { height }]}>
        {values.map((v, i) => {
          const h = v > 0 ? Math.max(6, (v / max) * chartH) : 3;
          const on = i === highlight;
          return (
            <View key={i} style={styles.barCol}>
              {on && hv !== undefined && hv > 0 ? (
                <View style={[styles.barLabel, { bottom: h + 6 }]}>
                  <Odometer value={format(hv)} v="label" tone="strong" style={styles.barFigure} delay={i * 40 + 120} />
                </View>
              ) : null}
              <Bar height={h} index={i} colour={on ? c.accent : v > 0 ? c.accentSoft : c.surfaceHigh} />
            </View>
          );
        })}
      </View>
      <View style={styles.barLabels}>
        {labels.map((l, i) => (
          <Txt key={i} v="caption" tone={i === highlight ? "strong" : "muted"} align="center" style={styles.flex}>
            {l}
          </Txt>
        ))}
      </View>
    </View>
  );
}

function Bar({ height, index, colour }: { height: number; index: number; colour: string }) {
  const reduce = useReducedMotion();
  const s = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    if (reduce) return;
    s.set(withDelay(index * dur.stagger, withTiming(1, { duration: 520, easing: ease.out })));
  }, [reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  const a = useAnimatedStyle(() => ({ transform: [{ scaleY: s.get() }] }));
  return <Animated.View style={[styles.bar, { height, backgroundColor: colour, transformOrigin: "bottom" }, a]} />;
}

// ---------------------------------------------------------------------------
// Searching pulse - "finding you a rider". The only looping animation in the
// passenger app, because it is the only moment the app is waiting on the world.
// ---------------------------------------------------------------------------

export function Pulse({ size = 180, children }: { readonly size?: number; readonly children?: ReactNode }) {
  return (
    <View style={[styles.pulse, { width: size, height: size }]}>
      {[0, 1, 2].map((i) => (
        <Ring key={i} size={size} delay={i * 700} />
      ))}
      <View style={styles.pulseCore}>{children}</View>
    </View>
  );
}

function Ring({ size, delay }: { size: number; delay: number }) {
  const reduce = useReducedMotion();
  const v = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    v.set(withDelay(delay, withRepeat(withTiming(1, { duration: 2100, easing: ease.out }), -1, false)));
  }, [reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  const a = useAnimatedStyle(() => ({
    opacity: reduce ? 0.12 : 0.45 * (1 - v.get()),
    transform: [{ scale: reduce ? 0.7 : 0.25 + 0.75 * v.get() }],
  }));
  return <Animated.View style={[styles.pulseRing, { width: size, height: size, borderRadius: size / 2 }, a]} />;
}

// ---------------------------------------------------------------------------
// Keypad - big keys, because it is used with gloves on, on a moto, at a kerb.
// ---------------------------------------------------------------------------

export function Keypad({
  onDigit,
  onDelete,
}: {
  readonly onDigit: (d: string) => void;
  readonly onDelete: () => void;
}) {
  const { width } = useWindowDimensions();
  const keyH = Math.min(62, Math.max(52, width / 7));
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];
  return (
    <View style={styles.keypad}>
      {keys.map((k, i) =>
        k === "" ? (
          <View key={i} style={[styles.key, { height: keyH }, styles.keyBlank]} />
        ) : (
          <Press
            key={i}
            onPressIn={() => tap()}
            onPress={() => (k === "del" ? onDelete() : onDigit(k))}
            scaleTo={0.94}
            bg={c.surfaceHigh}
            pressedBg={c.border}
            style={[styles.key, { height: keyH }]}
            accessibilityRole="button"
            accessibilityLabel={k === "del" ? "Delete" : k}
          >
            {k === "del" ? (
              <Ionicons name="backspace-outline" size={26} color={c.textStrong} />
            ) : (
              <Txt v="display" style={styles.keyText}>
                {k}
              </Txt>
            )}
          </Press>
        ),
      )}
    </View>
  );
}

/** Four boxes that fill as digits are typed; shakes when the PIN is wrong. */
export function PinBoxes({ value, length = 4, shakeKey }: { readonly value: string; readonly length?: number; readonly shakeKey: number }) {
  const shake = useSharedValue(0);
  useEffect(() => {
    if (shakeKey === 0) return;
    shake.set(
      withSequence(
        withTiming(10, { duration: 45 }),
        withTiming(-10, { duration: 70 }),
        withTiming(7, { duration: 60 }),
        withTiming(-5, { duration: 55 }),
        withTiming(0, { duration: 70, easing: ease.out }),
      ),
    );
  }, [shakeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const a = useAnimatedStyle(() => ({ transform: [{ translateX: shake.get() }] }));

  return (
    <Animated.View style={[styles.boxes, a]}>
      {Array.from({ length }).map((_, i) => {
        const d = value[i];
        const active = i === value.length;
        return (
          <View key={i} style={[styles.box, d ? styles.boxFilled : null, active && styles.boxActive]}>
            {d ? (
              <Animated.View key={`${i}${d}`} entering={FadeIn.duration(dur.press).easing(ease.out)}>
                <Txt v="hero" tone="inverse" tabularNums style={styles.boxText}>
                  {d}
                </Txt>
              </Animated.View>
            ) : null}
          </View>
        );
      })}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  track: {
    height: KNOB + TRACK_PAD * 2,
    borderRadius: radius.pill,
    padding: TRACK_PAD,
    justifyContent: "center",
    overflow: "hidden",
  },
  disabled: { opacity: 0.4 },
  trail: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  trackLabel: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingLeft: KNOB,
  },
  trackText: { fontSize: 17 },
  knob: {
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    backgroundColor: c.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  ringCentre: { alignItems: "center", justifyContent: "center" },
  bars: { flexDirection: "row", alignItems: "flex-end", gap: 10 },
  barCol: { flex: 1, alignItems: "center", justifyContent: "flex-end", height: "100%" },
  bar: { width: "100%", borderRadius: 8 },
  barLabel: { position: "absolute", alignItems: "center" },
  barFigure: { fontSize: 15, lineHeight: 18, fontFamily: font.num },
  barLabels: { flexDirection: "row", gap: 10, marginTop: 6 },
  pulse: { alignItems: "center", justifyContent: "center" },
  pulseRing: { position: "absolute", backgroundColor: c.accent },
  pulseCore: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: c.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  keypad: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: space.sm },
  key: {
    width: "31.5%",
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  keyBlank: { backgroundColor: "transparent" },
  keyText: { fontSize: 34, lineHeight: 38 },
  boxes: { flexDirection: "row", gap: 10, justifyContent: "center" },
  box: {
    width: 62,
    height: 76,
    borderRadius: 14,
    backgroundColor: c.surfaceHigh,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "transparent",
  },
  boxFilled: { backgroundColor: c.accentDeep },
  boxActive: { borderColor: c.accent },
  boxText: { fontSize: 46, lineHeight: 50 },
});
