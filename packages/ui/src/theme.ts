import { palette } from "./tokens";

export interface Theme {
  /** The page ground. Slightly off white, so a white card has an edge. */
  readonly surface: string;
  /** A card sitting on the ground. */
  readonly surfaceRaised: string;
  /** A card nested inside another card. */
  readonly surfaceHigh: string;
  /** Hairlines between rows. Never load-bearing on its own. */
  readonly border: string;
  readonly text: string;
  readonly textStrong: string;
  readonly textMuted: string;
  readonly accent: string;
  /** A tint of the accent, for chips and icon wells. */
  readonly accentSoft: string;
  readonly onAccent: string;
  readonly success: string;
  readonly successSoft: string;
  readonly danger: string;
  readonly dangerSoft: string;
  readonly warning: string;
  readonly warningSoft: string;
  /** The pickup end of a route. */
  readonly origin: string;
  /** The drop-off end of a route. */
  readonly destination: string;
}

/**
 * The shipped look: light, quiet, one blue.
 *
 * The indigo-and-amber pair it replaces asked the eye to treat two colours as
 * brand at once, which made every screen louder than the task on it. Booking a
 * moto is errand software - the money and the map should carry the only weight,
 * and everything else should get out of the way.
 *
 * Accent colours survive as small signals only: a green status chip, a red
 * cancel, an amber warning. None of them is ever a background.
 */
export const lightTheme: Theme = {
  surface: palette.ground,
  surfaceRaised: palette.card,
  surfaceHigh: palette.sunken,
  border: palette.hairline,
  text: palette.inkSoft,
  textStrong: palette.ink,
  textMuted: palette.inkMuted,
  accent: palette.blue,
  accentSoft: palette.blueSoft,
  onAccent: palette.white,
  success: palette.green,
  successSoft: palette.greenSoft,
  danger: palette.red,
  dangerSoft: palette.redSoft,
  warning: palette.amber,
  warningSoft: palette.amberSoft,
  origin: palette.blue,
  destination: palette.green,
};

/**
 * Kept working, and kept honest by the same contrast test - a rider on a night
 * shift may want it, and a half-maintained dark theme is worse than none.
 * Not shipped: `theme` below is what the apps import.
 */
export const darkTheme: Theme = {
  surface: palette.night,
  surfaceRaised: palette.nightRaised,
  surfaceHigh: palette.nightSunken,
  border: palette.nightHairline,
  text: "#C3C9D4",
  textStrong: palette.white,
  textMuted: "#9AA2B1",
  accent: palette.blueBright,
  accentSoft: "#17233A",
  onAccent: palette.night,
  success: palette.greenBright,
  successSoft: "#12281F",
  danger: palette.redBright,
  dangerSoft: "#2B1614",
  warning: "#FBBF24",
  warningSoft: "#2A2010",
  origin: palette.blueBright,
  destination: palette.greenBright,
};

/**
 * What the apps import. Switching the product's look is this one line - every
 * screen reads colour from here and nothing hard-codes a hex.
 */
export const theme: Theme = lightTheme;
