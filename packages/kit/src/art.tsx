import { useState } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import Animated from "react-native-reanimated";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { enter } from "./anim";
import { c, space } from "./theme";
import { Txt } from "./Txt";
import { Button, type IconName } from "./controls";

// ---------------------------------------------------------------------------
// Imigongo.
//
// Rwanda's Imigongo panels are geometric - zigzags, chevrons, diamonds -
// traditionally in black, white and red soil. Nova borrows the geometry, not
// the palette, and uses it in exactly three places: the welcome screens,
// receipts and empty states. It is texture, never a background behind text.
// ---------------------------------------------------------------------------

function zig(width: number, y: number, amp: number, step: number): string {
  let d = `M0 ${y + amp}`;
  let up = true;
  for (let x = step / 2; x <= width + step; x += step / 2) {
    d += ` L${x.toFixed(1)} ${up ? y : y + amp}`;
    up = !up;
  }
  return d;
}

/** A band of doubled zigzags over a row of diamonds, as wide as its container. */
export function ImigongoBand({
  colour = c.accent,
  opacity = 0.22,
  height = 26,
  style,
}: {
  readonly colour?: string;
  readonly opacity?: number;
  readonly height?: number;
  readonly style?: StyleProp<ViewStyle>;
}) {
  const [w, setW] = useState(0);
  const step = 18;
  const diamonds: string[] = [];
  for (let x = step / 2; x < w + step; x += step) {
    const cy = height - 5;
    diamonds.push(`M${x} ${cy - 4} L${x + 4} ${cy} L${x} ${cy + 4} L${x - 4} ${cy} Z`);
  }
  return (
    <View style={[{ height }, style]} onLayout={(e) => setW(e.nativeEvent.layout.width)} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {w > 0 ? (
        <Svg width={w} height={height}>
          <Path d={zig(w, 1, 7, step)} stroke={colour} strokeOpacity={opacity} strokeWidth={2} fill="none" strokeLinejoin="miter" />
          <Path d={zig(w, 6, 7, step)} stroke={colour} strokeOpacity={opacity * 0.7} strokeWidth={2} fill="none" strokeLinejoin="miter" />
          <Path d={diamonds.join(" ")} fill={colour} fillOpacity={opacity} />
        </Svg>
      ) : null}
    </View>
  );
}

/**
 * The torn edge of a receipt: small triangles hanging from the bottom of the
 * card, in the card's own colour, so the page shows through the gaps.
 */
export function ZigzagEdge({ colour = c.surfaceRaised, height = 9, step = 16 }: { readonly colour?: string; readonly height?: number; readonly step?: number }) {
  const [w, setW] = useState(0);
  let d = "";
  if (w > 0) {
    d = `M0 0 L${w} 0`;
    let x = w;
    let down = true;
    while (x > 0) {
      x -= step / 2;
      d += ` L${Math.max(0, x).toFixed(1)} ${down ? height : 0}`;
      down = !down;
    }
    d += " Z";
  }
  return (
    <View style={{ height }} onLayout={(e) => setW(e.nativeEvent.layout.width)} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {w > 0 ? (
        <Svg width={w} height={height}>
          <Path d={d} fill={colour} />
        </Svg>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Vehicles. A moto is a motorbike, not a bicycle.
// ---------------------------------------------------------------------------

export type VehicleKind = "moto" | "cab" | "cab_xl";

const VEHICLE: Record<VehicleKind, keyof typeof MaterialCommunityIcons.glyphMap> = {
  moto: "motorbike",
  cab: "car-side",
  cab_xl: "van-passenger",
};

export const VEHICLE_NAME: Record<VehicleKind, string> = { moto: "Moto", cab: "Cab", cab_xl: "Cab XL" };

export function VehicleGlyph({ kind, size = 24, colour = c.textStrong }: { readonly kind: string; readonly size?: number; readonly colour?: string }) {
  const k = (kind in VEHICLE ? kind : "moto") as VehicleKind;
  return <MaterialCommunityIcons name={VEHICLE[k]} size={size} color={colour} accessibilityElementsHidden />;
}

/**
 * The vehicle in a rounded well, the way it sits at the start of a row or card.
 * On a grey card the well is white, on a white one it is grey: it always needs
 * to be the other of the two to be seen.
 */
export function VehicleTile({
  kind,
  size = 48,
  on,
  onGrey,
}: {
  readonly kind: string;
  readonly size?: number;
  readonly on?: boolean;
  readonly onGrey?: boolean;
}) {
  return (
    <View
      style={[
        styles.tile,
        { width: size, height: size, borderRadius: Math.round(size * 0.3) },
        onGrey ? { backgroundColor: c.surfaceRaised } : null,
        on ? { backgroundColor: c.accentDeep } : null,
      ]}
    >
      <VehicleGlyph kind={kind} size={Math.round(size * 0.58)} colour={on ? c.onAccent : c.textStrong} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Hill scene: Kigali's hills under a sun that carries an icon. Every empty
// state uses it, with a different icon, so emptiness looks like one family.
// ---------------------------------------------------------------------------

export function HillScene({ icon, width = 200 }: { readonly icon: IconName; readonly width?: number }) {
  const h = width * 0.6;
  return (
    <View style={{ width, height: h }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={width} height={h} viewBox="0 0 200 120">
        {/* A yellow sun over midnight hills: the brand's two colours, and the
            one place the yellow is used as a picture. */}
        <Circle cx={100} cy={52} r={34} fill={c.highlight} />
        <Path d="M0 94 C 34 70, 74 76, 106 88 S 168 70, 200 82 V120 H0 Z" fill={c.accentSoft} />
        <Path d="M0 104 C 46 88, 92 102, 132 96 S 178 88, 200 98 V120 H0 Z" fill={c.surfaceHigh} />
        <Path d={zig(200, 108, 6, 14)} stroke={c.accent} strokeOpacity={0.2} strokeWidth={1.6} fill="none" />
        <Rect x={0} y={116} width={200} height={4} fill={c.surfaceHigh} />
      </Svg>
      <View style={[styles.sun, { top: h * (52 / 120) - 20, left: width / 2 - 20 }]}>
        <Ionicons name={icon} size={30} color={c.onHighlight} />
      </View>
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  compact,
}: {
  readonly icon: IconName;
  readonly title: string;
  readonly body?: string;
  readonly action?: { label: string; onPress: () => void; icon?: IconName };
  /** Inside a card rather than filling a screen. */
  readonly compact?: boolean;
}) {
  return (
    <Animated.View entering={enter(0)} style={[styles.empty, compact && styles.emptyCompact]}>
      <HillScene icon={icon} width={compact ? 150 : 200} />
      <View style={styles.emptyText}>
        <Txt v="heading" align="center">
          {title}
        </Txt>
        {body ? (
          <Txt v="body" tone="muted" align="center">
            {body}
          </Txt>
        ) : null}
      </View>
      {action ? <Button label={action.label} icon={action.icon} onPress={action.onPress} style={styles.emptyAction} /> : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  tile: { backgroundColor: c.surfaceHigh, alignItems: "center", justifyContent: "center" },
  sun: { position: "absolute", width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", gap: space.md, paddingVertical: space.xl, paddingHorizontal: space.md },
  emptyCompact: { paddingVertical: space.lg, gap: space.sm },
  emptyText: { gap: 6, maxWidth: 320 },
  emptyAction: { alignSelf: "stretch", marginTop: space.sm },
});

