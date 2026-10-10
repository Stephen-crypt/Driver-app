import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import { ease } from "./anim";
import { c, font, radius, shadow, space, tabular } from "./theme";
import { Txt } from "./Txt";

/**
 * A one-time code as six boxes. One real input sits invisibly under them, so
 * the phone's keyboard, SMS autofill and paste all work as they would in a
 * plain field; the boxes just draw it. The box waiting for the next digit
 * carries a blinking caret.
 */
export function OtpBoxes({
  value,
  onChange,
  length = 6,
  autoFocus = true,
  error,
}: {
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly length?: number;
  readonly autoFocus?: boolean;
  /** Turns the boxes red; clear it as soon as they type again. */
  readonly error?: boolean;
}) {
  const input = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);

  return (
    <Pressable onPress={() => input.current?.focus()} accessibilityRole="none" style={styles.wrap}>
      <View style={styles.row} pointerEvents="none">
        {Array.from({ length }).map((_, i) => {
          const d = value[i];
          const active = focused && i === Math.min(value.length, length - 1) && value.length < length;
          return (
            <View
              key={i}
              style={[styles.box, d ? styles.boxFilled : null, active && styles.boxActive, error && styles.boxError]}
            >
              {d ? (
                <Txt v="display" tabularNums style={styles.digit}>
                  {d}
                </Txt>
              ) : active ? (
                <Caret />
              ) : null}
            </View>
          );
        })}
      </View>
      <TextInput
        ref={input}
        value={value}
        onChangeText={(v) => onChange(v.replace(/\D/g, "").slice(0, length))}
        keyboardType="number-pad"
        maxLength={length}
        autoFocus={autoFocus}
        textContentType="oneTimeCode"
        autoComplete={Platform.OS === "android" ? "sms-otp" : "one-time-code"}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        caretHidden
        style={styles.hidden}
        accessibilityLabel={`${length} digit code`}
      />
    </Pressable>
  );
}

function Caret() {
  const reduce = useReducedMotion();
  const o = useSharedValue(1);
  useEffect(() => {
    if (reduce) return;
    o.set(withRepeat(withSequence(withTiming(0, { duration: 420, easing: ease.inOut }), withTiming(1, { duration: 420, easing: ease.inOut })), -1));
  }, [reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  const a = useAnimatedStyle(() => ({ opacity: o.get() }));
  return <Animated.View style={[styles.caret, a]} />;
}

const styles = StyleSheet.create({
  wrap: { alignSelf: "stretch" },
  row: { flexDirection: "row", gap: space.sm, justifyContent: "space-between" },
  // White cards; the one waiting for a digit is lit yellow, a filled one is
  // drawn in midnight, like the digit in it.
  box: {
    flex: 1,
    maxWidth: 56,
    height: 64,
    borderRadius: radius.md + 2,
    backgroundColor: c.surfaceRaised,
    borderWidth: 2,
    borderColor: c.border,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.card,
  },
  boxFilled: { borderColor: c.accent },
  boxActive: { borderColor: c.highlight, ...shadow.glow },
  boxError: { borderColor: c.danger },
  digit: { fontFamily: font.numBold, fontSize: 30, lineHeight: 36, ...tabular },
  caret: { width: 2, height: 28, borderRadius: 1, backgroundColor: c.accent },
  hidden: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.011,
    color: "transparent",
    ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null),
  },
});
