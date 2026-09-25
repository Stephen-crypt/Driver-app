import { useFonts } from "expo-font";
import { StyleSheet } from "react-native";
import { Barlow_400Regular } from "@expo-google-fonts/barlow/400Regular";
import { Barlow_500Medium } from "@expo-google-fonts/barlow/500Medium";
import { Barlow_600SemiBold } from "@expo-google-fonts/barlow/600SemiBold";
import { Barlow_700Bold } from "@expo-google-fonts/barlow/700Bold";
import { BarlowCondensed_500Medium } from "@expo-google-fonts/barlow-condensed/500Medium";
import { BarlowCondensed_600SemiBold } from "@expo-google-fonts/barlow-condensed/600SemiBold";
import { BarlowCondensed_700Bold } from "@expo-google-fonts/barlow-condensed/700Bold";
import { theme, tokens } from "@gera/ui";

export { theme, tokens };
export const c = theme;
export const space = tokens.space;
export const radius = tokens.radius;

/**
 * Barlow, and Barlow Condensed for numbers.
 *
 * Barlow is drawn from highway signage: plates, route numbers, kilometre
 * markers. A transport product that reads like the road it runs on is the
 * point. The condensed cut carries every number that matters - a fare, a PIN,
 * a vest, a countdown - because condensed numerals are what vests and plates
 * are stencilled in, and they fit a big figure into a narrow phone.
 *
 * Only the seven weights used are loaded. Importing the package root would pull
 * all thirty-six files into the bundle.
 */
export const font = {
  regular: "Barlow_400Regular",
  medium: "Barlow_500Medium",
  semibold: "Barlow_600SemiBold",
  bold: "Barlow_700Bold",
  numMedium: "BarlowCondensed_500Medium",
  num: "BarlowCondensed_600SemiBold",
  numBold: "BarlowCondensed_700Bold",
} as const;

/** True once the faces are ready, or failed - a font error must not block the app. */
export function useGeraFonts(): boolean {
  const [loaded, error] = useFonts({
    Barlow_400Regular,
    Barlow_500Medium,
    Barlow_600SemiBold,
    Barlow_700Bold,
    BarlowCondensed_500Medium,
    BarlowCondensed_600SemiBold,
    BarlowCondensed_700Bold,
  });
  return loaded || error !== null;
}

/**
 * The scale. Numbers get their own steps because they are read differently:
 * at a glance, from further away, often while moving.
 */
export const type = StyleSheet.create({
  /** A fare or a PIN, the single most important figure on a screen. */
  hero: { fontFamily: font.numBold, fontSize: 64, lineHeight: 66, letterSpacing: -0.5 },
  /** A headline figure: this week's earnings, a countdown. */
  display: { fontFamily: font.numBold, fontSize: 46, lineHeight: 48, letterSpacing: -0.3 },
  /** Screen titles. Condensed, so a Kinyarwanda title still fits one line. */
  title: { fontFamily: font.num, fontSize: 32, lineHeight: 36 },
  /** A figure inside a row or a stat. */
  figure: { fontFamily: font.num, fontSize: 26, lineHeight: 30 },
  heading: { fontFamily: font.semibold, fontSize: 18, lineHeight: 24 },
  body: { fontFamily: font.regular, fontSize: 16, lineHeight: 22 },
  bodyStrong: { fontFamily: font.semibold, fontSize: 16, lineHeight: 22 },
  label: { fontFamily: font.medium, fontSize: 14, lineHeight: 19 },
  caption: { fontFamily: font.medium, fontSize: 12.5, lineHeight: 17 },
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
