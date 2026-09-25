import { StyleSheet, View } from "react-native";
import { c, font, tabular } from "./theme";
import { Txt } from "./Txt";

type Size = "sm" | "md" | "lg" | "xl";

const SIZE: Record<Size, { w: number; h: number; fs: number; r: number }> = {
  sm: { w: 34, h: 40, fs: 24, r: 8 },
  md: { w: 48, h: 58, fs: 36, r: 11 },
  lg: { w: 60, h: 74, fs: 48, r: 14 },
  xl: { w: 74, h: 92, fs: 62, r: 16 },
};

interface Props {
  /** One to three characters. Longer than that is not a patch, it is a label. */
  readonly value: string;
  readonly size?: Size;
  /** Wider patches for two- and three-digit numbers are sized automatically. */
  readonly label?: string;
}

/**
 * The numbered patch on the back of a Kigali moto rider's vest, and Gera's one
 * visual signature. It carries the numbers a person has to match against the
 * real world: the rider's vest number, and the PIN the passenger reads out.
 *
 * The pale band across the middle is the vest's reflective strip. It sits
 * behind the numeral, not over it - the number must stay the clearest thing.
 */
export function VestPatch({ value, size = "md", label }: Props) {
  const s = SIZE[size];
  const width = s.w + Math.max(0, value.length - 1) * s.fs * 0.5;
  return (
    <View
      style={[styles.patch, { width, height: s.h, borderRadius: s.r }]}
      accessible
      accessibilityLabel={label ?? value.split("").join(" ")}
    >
      <View style={[styles.strip, { top: s.h * 0.56, height: s.h * 0.14 }]} />
      <Txt
        tone="inverse"
        tabularNums
        style={[styles.numeral, { fontSize: s.fs, lineHeight: s.fs * 1.02 }]}
      >
        {value}
      </Txt>
    </View>
  );
}

/**
 * A PIN as a row of patches. Spaced so it can be read out one digit at a time,
 * which is how it is actually used: "four, eight, two, one".
 */
export function PinPatches({ pin, size = "lg" }: { readonly pin: string; readonly size?: Size }) {
  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={`Ride PIN ${pin.split("").join(" ")}`}
    >
      {pin.split("").map((d, i) => (
        <VestPatch key={i} value={d} size={size} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  patch: {
    backgroundColor: c.accentDeep,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  strip: {
    position: "absolute",
    left: 0,
    right: 0,
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  numeral: { fontFamily: font.numBold, ...tabular },
  row: { flexDirection: "row", gap: 8 },
});
