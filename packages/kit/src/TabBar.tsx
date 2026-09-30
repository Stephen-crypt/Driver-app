import { Pressable, StyleSheet, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { c, font, shadow, space } from "./theme";
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

/**
 * Icons are passed by route name rather than through each screen's options:
 * the bar is part of the app's frame, and keeping its icons in one table keeps
 * it consistent.
 *
 * The tab you are on is a midnight pill carrying its name and a yellow icon -
 * the one lit thing in the bar. The others are icons alone; their names are
 * still read out by a screen reader.
 */
export function TabBar({
  state,
  descriptors,
  navigation,
  icons,
}: TabBarProps & { readonly icons: Record<string, { on: IconName; off: IconName }> }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space.sm) + 4 }]} accessibilityRole="tablist">
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
            <View style={[styles.pill, focused && styles.pillOn]}>
              <Ionicons name={focused ? icon.on : icon.off} size={22} color={focused ? c.highlight : c.textMuted} />
              {focused ? (
                <Animated.View entering={FadeIn.duration(180)}>
                  <Txt v="label" tone="onHero" style={styles.label} lines={1}>
                    {title}
                  </Txt>
                </Animated.View>
              ) : null}
            </View>
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
    paddingTop: 10,
    paddingHorizontal: space.sm,
    ...shadow.paper,
    shadowOpacity: 0.06,
  },
  item: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 48 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 46,
    minWidth: 46,
    paddingHorizontal: 12,
    borderRadius: 23,
    justifyContent: "center",
  },
  pillOn: { backgroundColor: c.hero, paddingHorizontal: 18 },
  label: { fontFamily: font.semibold },
});
