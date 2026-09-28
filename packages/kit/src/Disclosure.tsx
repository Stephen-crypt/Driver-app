import { useEffect, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { dur, ease } from "./anim";
import { c, space } from "./theme";
import { Txt } from "./Txt";
import { Press } from "./Press";
import { selection } from "./controls";

/**
 * A question that opens to its answer. The answer's height eases open and shut
 * - measured, so it is never clipped - and the plus turns into a cross, so the
 * control says what pressing it again will do.
 */
export function Disclosure({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [h, setH] = useState(0);
  const t = useSharedValue(0);

  useEffect(() => {
    t.set(reduce ? (open ? 1 : 0) : withTiming(open ? 1 : 0, { duration: open ? dur.enter : dur.small, easing: ease.inOut }));
  }, [open, reduce]); // eslint-disable-line react-hooks/exhaustive-deps

  const body = useAnimatedStyle(() => ({ height: t.get() * h, opacity: t.get() }));
  const icon = useAnimatedStyle(() => ({ transform: [{ rotate: `${t.get() * 45}deg` }] }));

  return (
    <View>
      <Press
        onPress={() => {
          selection();
          setOpen((o) => !o);
        }}
        scaleTo={1}
        bg={c.surfaceRaised}
        pressedBg={c.surfaceHigh}
        style={styles.head}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={title}
      >
        <Txt v="bodyStrong" style={styles.flex}>
          {title}
        </Txt>
        <Animated.View style={icon}>
          <Ionicons name="add" size={22} color={c.textMuted} />
        </Animated.View>
      </Press>
      <Animated.View style={[styles.clip, body]} accessibilityElementsHidden={!open} importantForAccessibility={open ? "auto" : "no-hide-descendants"}>
        <View style={styles.inner} onLayout={(e) => setH(e.nativeEvent.layout.height)}>
          {typeof children === "string" ? (
            <Txt v="body" tone="muted">
              {children}
            </Txt>
          ) : (
            children
          )}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  head: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, minHeight: 56 },
  clip: { overflow: "hidden" },
  inner: { position: "absolute", top: 0, left: 0, right: 0, paddingHorizontal: space.md, paddingBottom: space.md },
});
