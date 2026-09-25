import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  Easing,
  PanResponder,
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from "react-native";
import Svg, { Circle, Rect, Text as SvgText } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import { c, font, radius, space } from "./theme";
import { Txt } from "./Txt";
import { notify, tap, type IconName } from "./controls";

// ---------------------------------------------------------------------------
// Slide to confirm.
//
// Going online, arriving, and finishing a trip are all things a rider does with
// a phone in a mount or a pocket. A tap target fires by accident; a deliberate
// slide does not. It is the rider app's one physical gesture.
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
  const [width, setWidth] = useState(0);
  const x = useRef(new Animated.Value(0)).current;
  const max = Math.max(0, width - KNOB - TRACK_PAD * 2);
  const maxRef = useRef(max);
  maxRef.current = max;
  const firedRef = useRef(false);
  const onConfirmRef = useRef(onConfirm);
  onConfirmRef.current = onConfirm;

  const colour =
    tone === "good" ? c.success : tone === "bad" ? c.danger : tone === "dark" ? c.textStrong : c.accent;

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 4,
      onPanResponderGrant: () => {
        firedRef.current = false;
        tap();
      },
      onPanResponderMove: (_e, g) => {
        x.setValue(Math.max(0, Math.min(maxRef.current, g.dx)));
      },
      onPanResponderRelease: (_e, g) => {
        const done = g.dx >= maxRef.current * 0.86;
        if (done && !firedRef.current) {
          firedRef.current = true;
          notify("success");
          Animated.timing(x, { toValue: maxRef.current, duration: 90, useNativeDriver: true }).start(
            () => {
              onConfirmRef.current();
              Animated.timing(x, { toValue: 0, duration: 260, delay: 400, useNativeDriver: true }).start();
            },
          );
        } else {
          Animated.spring(x, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(x, { toValue: 0, useNativeDriver: true }).start();
      },
    }),
  ).current;

  const labelOpacity = x.interpolate({
    inputRange: [0, Math.max(1, max * 0.6)],
    outputRange: [1, 0],
    extrapolate: "clamp",
  });

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
      <Animated.View style={[styles.trackLabel, { opacity: labelOpacity }]}>
        <Txt v="bodyStrong" tone="inverse" style={styles.trackText}>
          {label}
        </Txt>
      </Animated.View>
      <Animated.View
        {...pan.panHandlers}
        style={[styles.knob, { transform: [{ translateX: x }] }]}
      >
        <Ionicons name={icon} size={24} color={colour} />
      </Animated.View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Countdown ring - the offer's fifteen seconds.
// ---------------------------------------------------------------------------

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
  const fraction = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;
  const urgent = remaining <= 5;
  const colour = urgent ? c.danger : c.accent;
  return (
    <View style={{ width: size, height: size }} accessibilityLabel={`${remaining} seconds left`}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={c.surfaceHigh} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={colour}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={circumference * (1 - fraction)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.ringCentre]}>
        <Txt v="display" tone={urgent ? "bad" : "strong"} tabularNums style={{ fontSize: size * 0.4, lineHeight: size * 0.44 }}>
          {remaining}
        </Txt>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Bars - a week of earnings. No axis, no gridlines: seven bars and the one
// figure that matters (today) written on its bar.
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
  const [width, setWidth] = useState(0);
  const max = Math.max(1, ...values);
  const gap = 10;
  const barW = values.length > 0 ? (width - gap * (values.length - 1)) / values.length : 0;
  const top = 26;
  const chartH = height - top;

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 ? (
        <Svg width={width} height={height + 22}>
          {values.map((v, i) => {
            const h = v > 0 ? Math.max(6, (v / max) * chartH) : 3;
            const xPos = i * (barW + gap);
            const on = i === highlight;
            return (
              <Rect
                key={`b${i}`}
                x={xPos}
                y={top + chartH - h}
                width={barW}
                height={h}
                rx={Math.min(8, barW / 3)}
                fill={on ? c.accent : v > 0 ? c.accentSoft : c.surfaceHigh}
              />
            );
          })}
          {values[highlight] !== undefined && values[highlight]! > 0 ? (
            <SvgText
              x={highlight * (barW + gap) + barW / 2}
              y={top + chartH - Math.max(6, (values[highlight]! / max) * chartH) - 8}
              fontSize={15}
              fontFamily={font.num}
              fill={c.textStrong}
              textAnchor="middle"
            >
              {format(values[highlight]!)}
            </SvgText>
          ) : null}
          {labels.map((l, i) => (
            <SvgText
              key={`l${i}`}
              x={i * (barW + gap) + barW / 2}
              y={height + 17}
              fontSize={12.5}
              fontFamily={i === highlight ? font.semibold : font.medium}
              fill={i === highlight ? c.textStrong : c.textMuted}
              textAnchor="middle"
            >
              {l}
            </SvgText>
          ))}
        </Svg>
      ) : (
        <View style={{ height: height + 22 }} />
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Searching pulse - "finding you a rider". The only looping animation in the
// passenger app, because it is the only moment the app is waiting on the world.
// ---------------------------------------------------------------------------

export function Pulse({ size = 180, children }: { readonly size?: number; readonly children?: ReactNode }) {
  const rings = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];

  useEffect(() => {
    const loops = rings.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 700),
          Animated.timing(v, { toValue: 1, duration: 2100, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={[styles.pulse, { width: size, height: size }]}>
      {rings.map((v, i) => (
        <Animated.View
          key={i}
          style={[
            styles.pulseRing,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
              transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }) }],
            },
          ]}
        />
      ))}
      <View style={styles.pulseCore}>{children}</View>
    </View>
  );
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
          <KeyButton key={i} k={k} height={keyH} onPress={() => (k === "del" ? onDelete() : onDigit(k))} />
        ),
      )}
    </View>
  );
}

function KeyButton({ k, height, onPress }: { k: string; height: number; onPress: () => void }) {
  const [down, setDown] = useState(false);
  return (
    <View
      style={[styles.key, { height }, down && styles.keyDown]}
      onStartShouldSetResponder={() => true}
      onResponderGrant={() => {
        setDown(true);
        tap();
      }}
      onResponderRelease={() => {
        setDown(false);
        onPress();
      }}
      onResponderTerminate={() => setDown(false)}
      accessible
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
    </View>
  );
}

/** Four boxes that fill as digits are typed; shakes when the PIN is wrong. */
export function PinBoxes({ value, length = 4, shakeKey }: { readonly value: string; readonly length?: number; readonly shakeKey: number }) {
  const shake = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (shakeKey === 0) return;
    Animated.sequence(
      [10, -10, 7, -7, 3, 0].map((toValue) =>
        Animated.timing(shake, { toValue, duration: 50, useNativeDriver: true }),
      ),
    ).start();
  }, [shakeKey, shake]);

  return (
    <Animated.View style={[styles.boxes, { transform: [{ translateX: shake }] }]}>
      {Array.from({ length }).map((_, i) => {
        const d = value[i];
        const active = i === value.length;
        return (
          <View key={i} style={[styles.box, d ? styles.boxFilled : null, active && styles.boxActive]}>
            <Txt v="hero" tone={d ? "inverse" : "muted"} tabularNums style={styles.boxText}>
              {d ?? ""}
            </Txt>
          </View>
        );
      })}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: KNOB + TRACK_PAD * 2,
    borderRadius: radius.pill,
    padding: TRACK_PAD,
    justifyContent: "center",
  },
  disabled: { opacity: 0.4 },
  trackLabel: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", paddingLeft: KNOB },
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
    backgroundColor: c.surfaceHigh,
    alignItems: "center",
    justifyContent: "center",
  },
  keyBlank: { backgroundColor: "transparent" },
  keyDown: { backgroundColor: c.border },
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
