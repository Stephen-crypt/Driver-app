import type { ReactNode } from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";
import { c, tabular, type, type TypeVariant } from "./theme";

export type Tone = "strong" | "default" | "muted" | "accent" | "good" | "bad" | "warn" | "inverse" | "onHighlight";

/** The colour of each tone, for anything that draws text itself (icons, odometers). */
export const TONE: Record<Tone, string> = {
  strong: c.textStrong,
  default: c.text,
  muted: c.textMuted,
  accent: c.accent,
  good: c.success,
  bad: c.danger,
  warn: c.warning,
  inverse: c.onAccent,
  onHighlight: c.onHighlight,
};

interface Props {
  readonly children: ReactNode;
  readonly v?: TypeVariant;
  readonly tone?: Tone;
  readonly align?: "left" | "center" | "right";
  /** Keeps a ticking number from shuffling sideways. */
  readonly tabularNums?: boolean;
  readonly lines?: number;
  readonly style?: StyleProp<TextStyle>;
  readonly accessibilityLabel?: string;
}

/**
 * The one text component. Every string in both apps goes through it, so the
 * type scale is a choice made once rather than a font size typed per screen.
 */
export function Txt({
  children,
  v = "body",
  tone = "strong",
  align,
  tabularNums,
  lines,
  style,
  accessibilityLabel,
}: Props) {
  return (
    <Text
      style={[type[v], { color: TONE[tone] }, align ? { textAlign: align } : null, tabularNums ? tabular : null, style]}
      numberOfLines={lines}
      accessibilityLabel={accessibilityLabel}
      maxFontSizeMultiplier={1.4}
    >
      {children}
    </Text>
  );
}
