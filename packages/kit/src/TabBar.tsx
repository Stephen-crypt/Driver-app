import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { c, space } from "./theme";
import { Txt } from "./Txt";
import { tap, type IconName } from "./controls";

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

/**
 * Icons are passed by route name rather than through each screen's options:
 * the bar is part of the app's frame, and keeping its icons in one table keeps
 * it consistent.
 *
 * The active tab is marked by a short bar above it - a lane marking, not a
 * pill. It says "you are here" without adding a coloured shape to the frame.
 */
export function TabBar({
  state,
  descriptors,
  navigation,
  icons,
}: TabBarProps & { readonly icons: Record<string, { on: IconName; off: IconName }> }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space.sm) }]}>
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
                tap();
                navigation.navigate(route.name);
              }
            }}
            style={styles.item}
          >
            <View style={[styles.lane, focused && styles.laneOn]} />
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
  item: { flex: 1, alignItems: "center", gap: 3, paddingTop: 0, minHeight: 56 },
  lane: { width: 24, height: 3, borderRadius: 2, backgroundColor: "transparent", marginBottom: 7 },
  laneOn: { backgroundColor: c.accent },
});
