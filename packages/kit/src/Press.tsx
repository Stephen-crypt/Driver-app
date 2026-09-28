import type { ReactNode } from "react";
import { Pressable, StyleSheet, type Insets, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { dur, ease } from "./anim";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface PressProps extends Omit<PressableProps, "style" | "children"> {
  readonly children: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
  /** How far it sinks under a finger. 0.97 for buttons, 0.99 for wide rows, 1 for none. */
  readonly scaleTo?: number;
  /** Background at rest and under a finger, for rows and keys. */
  readonly bg?: string;
  readonly pressedBg?: string;
  readonly hitSlop?: number | Insets;
}

/**
 * The one pressable. It answers the finger on press-in - the moment of
 * contact, not the release - with a short sink, and settles back slower than
 * it went down. Only transform, opacity and colour animate, on the UI thread.
 *
 * With reduced motion the sink becomes a slight dim: the feedback stays, the
 * movement goes.
 */
export function Press({
  children,
  style,
  scaleTo = 0.97,
  bg,
  pressedBg,
  onPressIn,
  onPressOut,
  disabled,
  ...rest
}: PressProps) {
  const reduce = useReducedMotion();
  const p = useSharedValue(0);
  // An animated style is applied after the static ones, so the dim-on-press
  // below would overwrite a caller's own opacity - a disabled row at 0.4 would
  // look ready to tap. Start from that opacity instead of from 1.
  const flat = StyleSheet.flatten(style) as ViewStyle | undefined;
  const restOpacity = typeof flat?.opacity === "number" ? flat.opacity : 1;

  const animated = useAnimatedStyle(() => {
    const out: Record<string, unknown> = {};
    if (reduce || scaleTo >= 1) out.opacity = restOpacity * (1 - p.get() * 0.18);
    else out.transform = [{ scale: 1 - p.get() * (1 - scaleTo) }];
    if (bg !== undefined && pressedBg !== undefined) {
      out.backgroundColor = interpolateColor(p.get(), [0, 1], [bg, pressedBg]);
    }
    return out;
  });

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={(e) => {
        p.set(withTiming(1, { duration: dur.press * 0.75, easing: ease.out }));
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        p.set(withTiming(0, { duration: dur.small, easing: ease.out }));
        onPressOut?.(e);
      }}
      // Movement of a few points while pressed is a thumb settling, not a cancel.
      pressRetentionOffset={{ top: 16, left: 16, right: 16, bottom: 16 }}
      style={[bg !== undefined ? { backgroundColor: bg } : null, style, animated]}
    >
      {children}
    </AnimatedPressable>
  );
}
