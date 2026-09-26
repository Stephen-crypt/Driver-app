import { forwardRef, useState, type ReactNode } from "react";
import { Platform, StyleSheet, TextInput, View, type TextInputProps } from "react-native";
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
      <View style={[styles.box, big && styles.boxBig, onPaper && styles.boxOnPaper, focused && styles.focused]}>
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
      </View>
      {hint ? (
        <Txt v="caption" tone="muted" style={styles.hint}>
          {hint}
        </Txt>
      ) : null}
    </View>
  );
});

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
  focused: { borderColor: c.accent },
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
