import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { ease } from "./anim";
import { c, space } from "./theme";
import { Txt } from "./Txt";
import { selection, type IconName } from "./controls";

/**
 * The shape of what expo-router's Tabs hands a custom tab bar, reduced to the
 * fields this one reads. Typed structurally so the kit does not import the
 * navigation library's internals.
 */
export interface TabBarProps {
  readonly state: { readonly index: number; readonly routes: readonly { readonly key: string; readonly name: string }[] };
  readonly descriptors: Record<string, { readonly options: { readonly title?: string } }>;
  readonly navigation: {
    emit: (e: { type: "tabPress"; target: string; canPreventDefault: true }) => { defaultPrevented: boolean };
    navigate: (name: string) => void;
  };
}

const LANE = 28;

/**
 * Icons are passed by route name rather than through each screen's options:
 * the bar is part of the app's frame, and keeping its icons in one table keeps
 * it consistent.
 *
 * The active tab is marked by a short bar above it - a lane marking, not a
 * pill. Switching tabs happens dozens of times a day, so the marker gliding to
 * the new tab is the only motion here: the icons and labels just change.
 */
export function TabBar({
  state,
  descriptors,
  navigation,
  icons,
}: TabBarProps & { readonly icons: Record<string, { on: IconName; off: IconName }> }) {
  const insets = useSafeAreaInsets();
  const [width, setWidth] = useState(0);
  const count = state.routes.length;
  const itemW = count > 0 ? width / count : 0;
  const x = useSharedValue(0);
  const placed = useSharedValue(0);

  useEffect(() => {
    if (itemW <= 0) return;
    const to = state.index * itemW + (itemW - LANE) / 2;
    if (placed.get() === 0) {
      x.set(to);
      placed.set(1);
    } else {
      x.set(withTiming(to, { duration: 240, easing: ease.inOut }));
    }
  }, [state.index, itemW]); // eslint-disable-line react-hooks/exhaustive-deps

  const lane = useAnimatedStyle(() => ({ opacity: placed.get(), transform: [{ translateX: x.get() }] }));

  return (
    <View
      style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space.sm) }]}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessibilityRole="tablist"
    >
      <Animated.View style={[styles.lane, lane]} pointerEvents="none" />
      {state.routes.map((route, i) => {
        const focused = state.index === i;
        const title = descriptors[route.key]?.options.title ?? route.name;
        const icon = icons[route.name] ?? { on: "ellipse", off: "ellipse-outline" };
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={title}
            onPress={() => {
              const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) {
                selection();
                navigation.navigate(route.name);
              }
            }}
            style={styles.item}
          >
            <Ionicons name={focused ? icon.on : icon.off} size={23} color={focused ? c.textStrong : c.textMuted} />
            <Txt v="caption" tone={focused ? "strong" : "muted"}>
              {title}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    backgroundColor: c.surfaceRaised,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.border,
  },
  item: { flex: 1, alignItems: "center", gap: 3, paddingTop: 10, minHeight: 56 },
  lane: { position: "absolute", top: 0, left: 0, width: LANE, height: 3, borderRadius: 2, backgroundColor: c.accent },
});
