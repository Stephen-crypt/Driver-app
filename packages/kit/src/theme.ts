import { useFonts } from "expo-font";
import { StyleSheet } from "react-native";
import { Inter_400Regular } from "@expo-google-fonts/inter/400Regular";
import { Inter_500Medium } from "@expo-google-fonts/inter/500Medium";
import { Inter_600SemiBold } from "@expo-google-fonts/inter/600SemiBold";
import { Montserrat_600SemiBold } from "@expo-google-fonts/montserrat/600SemiBold";
import { Montserrat_700Bold } from "@expo-google-fonts/montserrat/700Bold";
import { Montserrat_800ExtraBold } from "@expo-google-fonts/montserrat/800ExtraBold";
import { theme, tokens } from "@nova/ui";

export { theme, tokens };
export const c = theme;
export const space = tokens.space;
export const radius = tokens.radius;

/**
 * The URUMURI typefaces: Montserrat for headlines and every figure that
 * matters, Inter for everything a person reads at length.
 *
 * Montserrat's heavy cuts carry the fares, PINs, vest numbers and countdowns,
 * with tabular figures so a ticking number never shuffles sideways. Inter is
 * the interface: rows, labels, body copy. Only the six weights used are
 * loaded; importing a package root would pull every file into the bundle.
 *
 * The keys keep their old names (num, numBold) so the figures across both
 * apps did not have to be re-pointed one by one.
 */
export const font = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Montserrat_700Bold",
  numMedium: "Montserrat_600SemiBold",
  num: "Montserrat_700Bold",
  numBold: "Montserrat_800ExtraBold",
} as const;

/** True once the faces are ready, or failed - a font error must not block the app. */
export function useNovaFonts(): boolean {
  const [loaded, error] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Montserrat_600SemiBold,
    Montserrat_700Bold,
    Montserrat_800ExtraBold,
  });
  return loaded || error !== null;
}

/**
 * The scale, from the brand book's type ramp brought down to a phone: the
 * book's H1 at 48 is a poster size, so screen titles sit at the H3 step and the
 * hero figure takes the display step. Numbers get their own steps because they
 * are read differently: at a glance, from further away, often while moving.
 */
export const type = StyleSheet.create({
  /** A fare or a PIN, the single most important figure on a screen. */
  hero: { fontFamily: font.numBold, fontSize: 56, lineHeight: 60, letterSpacing: -1.5 },
  /** A headline figure: this week's earnings, a countdown. */
  display: { fontFamily: font.numBold, fontSize: 40, lineHeight: 44, letterSpacing: -1 },
  /** Screen titles. */
  title: { fontFamily: font.num, fontSize: 28, lineHeight: 34, letterSpacing: -0.6 },
  /** Sheet and card titles, one step down from a screen title. */
  h2: { fontFamily: font.num, fontSize: 22, lineHeight: 28, letterSpacing: -0.4 },
  /** A figure inside a row or a stat. */
  figure: { fontFamily: font.num, fontSize: 22, lineHeight: 28, letterSpacing: -0.3 },
  heading: { fontFamily: font.numMedium, fontSize: 18, lineHeight: 24 },
  body: { fontFamily: font.regular, fontSize: 16, lineHeight: 24 },
  bodyStrong: { fontFamily: font.semibold, fontSize: 16, lineHeight: 24 },
  label: { fontFamily: font.medium, fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: font.medium, fontSize: 12, lineHeight: 18 },
});

export type TypeVariant = keyof typeof type;

/** Numbers that tick must not jitter sideways as their digits change. */
export const tabular = { fontVariant: ["tabular-nums" as const] };

export const shadow = {
  paper: {
    shadowColor: "#0B0D12",
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -6 },
    elevation: 14,
  },
  float: {
    shadowColor: "#0B0D12",
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
} as const;

export const money = (rwf: number): string => Math.round(rwf).toLocaleString("en-US");

/** What sits behind a modal sheet. */
export const scrim = "rgba(11,13,18,0.48)";
