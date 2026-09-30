import { useEffect, useState, type ReactNode } from "react";
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ease } from "./anim";
import { c, radius, shadow, space } from "./theme";
import { Txt, type Tone } from "./Txt";
import { Press } from "./Press";
import { Odometer } from "./Odometer";
import { selection, type IconName } from "./controls";
import { Ionicons } from "@expo/vector-icons";

// ---------------------------------------------------------------------------
// The hero: the midnight block that opens every main screen.
//
// Urumuri means light. The screens open on the night - a solid midnight block
// holding who you are and the one thing the screen is for - and what sits
// below it is lit: white cards on a pale ground, with the yellow as the light
// itself. The block carries an Imigongo panel, the geometry Rwandan houses were
// painted with, faint enough to be felt rather than read.
// ---------------------------------------------------------------------------

export function Hero({
  children,
  style,
  overlap = 0,
  safeTop = true,
}: {
  readonly children: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
  /** Extra room at the bottom for a card that rides over the edge. */
  readonly overlap?: number;
  /** Pad for the status bar. Off when something above already did. */
  readonly safeTop?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.hero, { paddingTop: (safeTop ? insets.top : 0) + space.md, paddingBottom: space.lg + overlap }, style]}>
      <HeroPattern />
      {children}
    </View>
  );
}

/**
 * Nested diamonds, as on an Imigongo panel, drawn in the hero's own lighter
 * blue so they read as texture, not as a picture.
 */
export function HeroPattern() {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const { w, h } = box;
  const diamonds: string[] = [];
  if (w > 0) {
    const cx = w - 34;
    const cy = h * 0.42;
    for (let r = 26; r <= 170; r += 18) diamonds.push(`M${cx} ${cy - r} L${cx + r} ${cy} L${cx} ${cy + r} L${cx - r} ${cy} Z`);
  }
  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {w > 0 ? (
        <Svg width={w} height={h}>
          <Path d={diamonds.join(" ")} stroke={c.heroRaised} strokeWidth={7} fill="none" />
        </Svg>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Cards and section titles
// ---------------------------------------------------------------------------

/**
 * A white card on the ground. The shadow lives on an outer view and the
 * clipping on an inner one: iOS drops a shadow from anything that clips.
 */
export function Card({
  children,
  style,
  inner,
  onPress,
  accessibilityLabel,
  tone = "white",
}: {
  readonly children: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
  readonly inner?: StyleProp<ViewStyle>;
  readonly onPress?: () => void;
  readonly accessibilityLabel?: string;
  readonly tone?: "white" | "hero" | "yellow";
}) {
  const bg = tone === "hero" ? c.hero : tone === "yellow" ? c.highlight : c.surfaceRaised;
  const body = <View style={[styles.cardInner, { backgroundColor: bg }, inner]}>{children}</View>;
  if (!onPress) return <View style={[styles.card, tone === "yellow" && shadow.glow, style]}>{body}</View>;
  return (
    <Press
      onPress={onPress}
      scaleTo={0.985}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[styles.card, tone === "yellow" && shadow.glow, style]}
    >
      {body}
    </Press>
  );
}

export function SectionTitle({
  title,
  action,
  tone = "strong",
  style,
}: {
  readonly title: string;
  readonly action?: { label: string; onPress: () => void };
  readonly tone?: "strong" | "onHero";
  readonly style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.section, style]}>
      <Txt v="section" tone={tone} style={styles.flex} accessibilityLabel={title}>
        {title}
      </Txt>
      {action ? (
        <Press onPress={action.onPress} scaleTo={0.95} hitSlop={10} accessibilityRole="button">
          <Txt v="label" tone={tone === "onHero" ? "onHeroMuted" : "accent"} style={styles.sectionAction}>
            {action.label}
          </Txt>
        </Press>
      ) : null}
    </View>
  );
}

/**
 * One figure on its own tinted tile, with an icon that says what it counts:
 * earnings, trips, cash. A row of these reads at a glance from a bike.
 */
export function StatTile({
  icon,
  label,
  value,
  ground,
  ink,
  tone = "strong",
  roll,
}: {
  readonly icon: IconName;
  readonly label: string;
  readonly value: string;
  readonly ground: string;
  readonly ink: string;
  readonly tone?: Tone;
  readonly roll?: boolean;
}) {
  return (
    <View style={[styles.stat, { backgroundColor: ground }]} accessible accessibilityLabel={`${label}: ${value}`}>
      <View style={styles.statIcon}>
        <Ionicons name={icon} size={16} color={ink} />
      </View>
      {roll ? (
        <Odometer value={value} v="figure" tone={tone} />
      ) : (
        <Txt v="figure" tone={tone} tabularNums>
          {value}
        </Txt>
      )}
      <Txt v="caption" tone="default" lines={2}>
        {label}
      </Txt>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Vehicle pictures. Drawn, not glyphs: the passenger picks a vehicle by what it
// looks like, and the rider sees the one they will be riding.
// ---------------------------------------------------------------------------

const ART = {
  moto: require("../assets/vehicles/moto.png"),
  cab: require("../assets/vehicles/cab.png"),
} as const;

export function VehicleArt({ kind, size = 72, style }: { readonly kind: string; readonly size?: number; readonly style?: StyleProp<ViewStyle> }) {
  const xl = kind === "cab_xl";
  const src = kind === "moto" ? ART.moto : ART.cab;
  return (
    <View style={[{ width: size, height: size }, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Image source={src} style={{ width: size, height: size }} resizeMode="contain" accessibilityIgnoresInvertColors />
      {xl ? (
        <View style={styles.xl}>
          <Txt v="caption" tone="inverse" style={styles.xlText}>
            XL
          </Txt>
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Mood rating: five faces instead of five stars. A face is answered faster
// than a number, and nobody has to decide what three stars means.
// ---------------------------------------------------------------------------

export const MOODS = ["Awful", "Poor", "Okay", "Good", "Great"] as const;

/** Mouth curvature per mood, from a deep frown to a wide smile. */
const MOUTH = [-7, -3.5, 0, 4, 7.5];

function Face({ mood, on, size }: { mood: number; on: boolean; size: number }) {
  const bend = MOUTH[mood] ?? 0;
  const ink = on ? c.onHighlight : c.textMuted;
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Circle cx={24} cy={24} r={21} fill={on ? c.highlight : c.surfaceHigh} stroke={on ? c.onHighlight : c.border} strokeWidth={on ? 2 : 1.5} />
      <Circle cx={17} cy={20} r={2.6} fill={ink} />
      <Circle cx={31} cy={20} r={2.6} fill={ink} />
      <Path d={`M15 ${31 - bend / 2} Q24 ${31 + bend} 33 ${31 - bend / 2}`} stroke={ink} strokeWidth={2.6} strokeLinecap="round" fill="none" />
    </Svg>
  );
}

function MoodButton({ mood, on, onPress }: { mood: number; on: boolean; onPress: () => void }) {
  const s = useSharedValue(1);
  useEffect(() => {
    if (!on) return;
    s.set(withSequence(withTiming(1.18, { duration: 120, easing: ease.out }), withTiming(1, { duration: 220, easing: ease.out })));
  }, [on]); // eslint-disable-line react-hooks/exhaustive-deps
  const a = useAnimatedStyle(() => ({ transform: [{ scale: s.get() }] }));
  return (
    <Press
      onPress={onPress}
      scaleTo={0.92}
      hitSlop={4}
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      accessibilityLabel={MOODS[mood]}
      style={styles.mood}
    >
      <Animated.View style={a}>
        <Face mood={mood} on={on} size={50} />
      </Animated.View>
      <Txt v="caption" tone={on ? "strong" : "muted"} align="center">
        {MOODS[mood]}
      </Txt>
    </Press>
  );
}

/** value is 1-5, 0 for not yet answered. */
export function MoodRating({ value, onChange }: { readonly value: number; readonly onChange: (v: number) => void }) {
  return (
    <View style={styles.moods} accessibilityRole="radiogroup" accessibilityLabel="How was your trip?">
      {MOODS.map((_, i) => (
        <MoodButton
          key={i}
          mood={i}
          on={value === i + 1}
          onPress={() => {
            selection();
            onChange(i + 1);
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  hero: {
    backgroundColor: c.hero,
    paddingHorizontal: space.lg,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    overflow: "hidden",
  },
  card: { borderRadius: radius.lg, ...shadow.card },
  cardInner: { borderRadius: radius.lg, overflow: "hidden" },
  section: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: 2 },
  sectionAction: { fontWeight: "600" },
  xl: {
    position: "absolute",
    right: 0,
    bottom: 2,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
    backgroundColor: c.accent,
  },
  xlText: { fontSize: 11, lineHeight: 14, fontWeight: "700" },
  stat: { flex: 1, gap: 2, padding: space.md, paddingTop: space.sm + 4, borderRadius: radius.lg },
  statIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    marginBottom: space.xs,
    backgroundColor: c.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  moods: { flexDirection: "row", justifyContent: "space-between" },
  mood: { alignItems: "center", gap: 6, minWidth: 56 },
});
