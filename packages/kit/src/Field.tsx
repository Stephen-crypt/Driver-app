import { forwardRef, useState, type ReactNode } from "react";
import { Platform, StyleSheet, TextInput, View, type TextInputProps } from "react-native";
import Animated, { type CSSTransitionProperties } from "react-native-reanimated";
import { cssEase, dur } from "./anim";
import { c, font, radius, space, tabular } from "./theme";
import { Txt } from "./Txt";

interface Props extends TextInputProps {
  readonly label?: string;
  /** Condensed figures at display size - for a phone number or a code. */
  readonly big?: boolean;
  /** A fixed prefix inside the field, like the country code. */
  readonly prefix?: string;
  readonly hint?: ReactNode;
  /** On a white sheet rather than the grey page: the field needs a grey fill to be seen. */
  readonly onPaper?: boolean;
}

/**
 * A filled field with its label above it. The label stays visible while
 * typing - a placeholder that disappears on the first keystroke leaves a
 * half-filled form with no way to tell which box was which.
 */
export const Field = forwardRef<TextInput, Props>(function Field(
  { label, big, prefix, hint, onPaper, style, onFocus, onBlur, ...rest },
  ref,
) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.wrap}>
      {label ? (
        <Txt v="label" tone="muted" style={styles.label}>
          {label}
        </Txt>
      ) : null}
      {/* The ring eases in and out with focus instead of snapping on. */}
      <Animated.View style={[styles.box, big && styles.boxBig, onPaper && styles.boxOnPaper, focused && styles.focused, ringMotion]}>
        {prefix ? (
          <Txt v={big ? "title" : "bodyStrong"} tone="muted" style={big ? styles.prefixBig : null}>
            {prefix}
          </Txt>
        ) : null}
        <TextInput
          ref={ref}
          placeholderTextColor={c.textMuted}
          style={[styles.input, big && styles.inputBig, style]}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...rest}
        />
      </Animated.View>
      {hint ? (
        <Txt v="caption" tone="muted" style={styles.hint}>
          {hint}
        </Txt>
      ) : null}
    </View>
  );
});

// Reanimated's CSS transition props live outside StyleSheet: they are not part
// of React Native's own style types.
const ringMotion: CSSTransitionProperties = {
  transitionProperty: ["borderColor", "backgroundColor"],
  transitionDuration: dur.small,
  transitionTimingFunction: cssEase.out,
};

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { marginLeft: space.xs },
  box: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: 56,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: c.surfaceRaised,
    borderWidth: 2,
    borderColor: "transparent",
  },
  boxBig: { minHeight: 72 },
  boxOnPaper: { backgroundColor: c.surfaceHigh },
  focused: { borderColor: c.accent, backgroundColor: c.surfaceRaised },

  // minWidth 0: a text input will not shrink below its intrinsic width on the
  // web without it, and the overflow scrolled the whole screen sideways.
  // The box draws the focus ring (styles.focused); on the web the browser would
  // draw a second one inside it.
  input: {
    flex: 1,
    minWidth: 0,
    fontFamily: font.medium,
    fontSize: 17,
    color: c.textStrong,
    paddingVertical: space.sm,
    ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null),
  },
  inputBig: { fontFamily: font.num, fontSize: 34, letterSpacing: 1, ...tabular },
  prefixBig: { fontSize: 30 },
  hint: { marginLeft: space.xs },
});

/**
 * Several lines of free text: a report, a note to the office, what went wrong.
 * The same filled box and focus ring as Field, grown to fit a few sentences.
 */
export const TextArea = forwardRef<TextInput, TextInputProps & { readonly onPaper?: boolean; readonly minHeight?: number }>(
  function TextArea({ onPaper, minHeight = 120, style, onFocus, onBlur, ...rest }, ref) {
    const [focused, setFocused] = useState(false);
    return (
      <Animated.View style={[areaStyles.box, { minHeight }, onPaper && areaStyles.onPaper, focused && areaStyles.focused, ringMotion]}>
        <TextInput
          ref={ref}
          multiline
          placeholderTextColor={c.textMuted}
          textAlignVertical="top"
          style={[areaStyles.input, { minHeight: minHeight - space.md * 2 }, style]}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...rest}
        />
      </Animated.View>
    );
  },
);

const areaStyles = StyleSheet.create({
  box: {
    borderRadius: radius.lg,
    backgroundColor: c.surfaceRaised,
    borderWidth: 2,
    borderColor: "transparent",
    padding: space.md - 2,
  },
  onPaper: { backgroundColor: c.surfaceHigh },
  focused: { borderColor: c.accent, backgroundColor: c.surfaceRaised },
  input: {
    fontFamily: font.regular,
    fontSize: 16,
    lineHeight: 22,
    color: c.textStrong,
    padding: 0,
    ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null),
  },
});
