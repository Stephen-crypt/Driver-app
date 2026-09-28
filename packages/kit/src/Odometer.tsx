import { useEffect } from "react";
import { PixelRatio, StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { dur, ease } from "./anim";
import { tabular, type, type TypeVariant } from "./theme";
import { TONE, type Tone } from "./Txt";

/** Two turns of the wheel, so a digit can always arrive by rolling forward. */
const WHEEL = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

interface Props {
  /** Already formatted: "1,700", "07:30", "4". Digits roll, everything else stands still. */
  readonly value: string;
  readonly v?: TypeVariant;
  readonly tone?: Tone;
  readonly style?: StyleProp<TextStyle>;
  /** Hold the roll back, for a number that should land after something else. */
  readonly delay?: number;
  /** Off for a number that must never move - a PIN being typed, a clock. */
  readonly roll?: boolean;
  readonly accessibilityLabel?: string;
}

/**
 * Numbers that matter arrive the way they do on a departure board or a
 * vehicle's odometer: each digit turns to its value, left to right. It is Nova's
 * one signature movement, kept for figures a person acts on - a fare, an ETA,
 * earnings, the vest number that tells a passenger which moto is theirs.
 *
 * Columns are keyed from the right, so when 900 becomes 1,200 the hundreds stay
 * the hundreds and only the new column rolls in.
 */
export function Odometer({ value, v = "display", tone = "strong", style, delay = 0, roll = true, accessibilityLabel }: Props) {
  const base = StyleSheet.flatten([type[v], style]) as TextStyle;
  // The column height has to match the rendered line exactly, so the font is
  // scaled here, once, instead of by the platform per glyph.
  const scale = Math.min(PixelRatio.getFontScale(), 1.4);
  const fontSize = (base.fontSize ?? 16) * scale;
  const lineHeight = Math.round((base.lineHeight ?? (base.fontSize ?? 16) * 1.2) * scale);
  const text: TextStyle = {
    ...base,
    fontSize,
    lineHeight,
    height: lineHeight,
    color: base.color ?? TONE[tone],
    includeFontPadding: false,
    textAlignVertical: "center",
    ...tabular,
  };
  const chars = value.split("");
  let digitIndex = 0;

  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={accessibilityLabel ?? value}
      importantForAccessibility="yes"
    >
      {chars.map((ch, i) => {
        const fromRight = chars.length - i;
        if (ch >= "0" && ch <= "9") {
          const order = digitIndex++;
          return (
            <Digit
              key={`d${fromRight}`}
              digit={Number(ch)}
              lineHeight={lineHeight}
              text={text}
              delay={delay + order * dur.stagger}
              roll={roll}
            />
          );
        }
        return (
          <Text
            key={`s${fromRight}${ch}`}
            allowFontScaling={false}
            style={text}
            importantForAccessibility="no-hide-descendants"
          >
            {ch}
          </Text>
        );
      })}
    </View>
  );
}

function Digit({
  digit,
  lineHeight,
  text,
  delay,
  roll,
}: {
  digit: number;
  lineHeight: number;
  text: TextStyle;
  delay: number;
  roll: boolean;
}) {
  const reduce = useReducedMotion();
  const animate = roll && !reduce;
  // Mounted on the first turn and rolled to the same digit on the second: every
  // column visibly turns once, including zeros.
  const row = useSharedValue(animate ? digit : digit + 10);

  useEffect(() => {
    const target = digit + 10;
    if (!animate) {
      row.set(target);
      return;
    }
    row.set(withDelay(delay, withTiming(target, { duration: dur.roll, easing: ease.out })));
  }, [digit, animate]); // eslint-disable-line react-hooks/exhaustive-deps

  const strip = useAnimatedStyle(() => ({ transform: [{ translateY: -row.get() * lineHeight }] }));

  return (
    <View style={{ height: lineHeight, overflow: "hidden" }} importantForAccessibility="no-hide-descendants">
      <Animated.View style={strip}>
        {WHEEL.map((n, i) => (
          <Text key={i} allowFontScaling={false} style={text}>
            {n}
          </Text>
        ))}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start" },
});
