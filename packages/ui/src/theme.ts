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
  /** The working colour: buttons, links, the active tab. */
  readonly accent: string;
  /** A tint of the accent, for chips and icon wells. */
  readonly accentSoft: string;
  /** The accent as a ground: a dark card, a map marker. */
  readonly accentDeep: string;
  readonly onAccent: string;
  /**
   * The brand's yellow: the vest patch, the PIN, being online, the button that
   * takes an offer. Hi-vis, so it is kept for what must be found at a glance.
   */
  readonly highlight: string;
  readonly highlightSoft: string;
  /** Type on the highlight. Midnight, never white. */
  readonly onHighlight: string;
  readonly success: string;
  readonly successSoft: string;
  readonly danger: string;
  readonly dangerSoft: string;
  readonly warning: string;
  readonly warningSoft: string;
  readonly info: string;
  /** The pickup end of a route. */
  readonly origin: string;
  /** The drop-off end of a route. */
  readonly destination: string;
}

/**
 * The shipped look, from the URUMURI brand book: a light ground, midnight blue
 * as the working colour, and the yellow held back for the handful of things a
 * passenger or rider has to spot from a distance - a vest number, a PIN, the
 * fact that they are online.
 *
 * Green, red and amber survive as small signals only: a status chip, a cancel,
 * a warning. None of them is ever a background.
 */
export const lightTheme: Theme = {
  surface: palette.ground,
  surfaceRaised: palette.card,
  surfaceHigh: palette.sunken,
  border: palette.hairline,
  text: palette.inkSoft,
  textStrong: palette.ink,
  textMuted: palette.inkMuted,
  accent: palette.midnight,
  accentSoft: palette.midnightSoft,
  accentDeep: palette.midnightDeep,
  onAccent: palette.white,
  highlight: palette.yellow,
  highlightSoft: palette.yellowSoft,
  onHighlight: palette.midnight,
  success: palette.green,
  successSoft: palette.greenSoft,
  danger: palette.red,
  dangerSoft: palette.redSoft,
  warning: palette.amber,
  warningSoft: palette.amberSoft,
  info: palette.info,
  origin: palette.midnight,
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
  accent: palette.yellowBright,
  accentSoft: "#2A2410",
  accentDeep: "#B48E00",
  onAccent: palette.night,
  highlight: palette.yellowBright,
  highlightSoft: "#2A2410",
  onHighlight: palette.night,
  success: palette.greenBright,
  successSoft: "#12281F",
  danger: palette.redBright,
  dangerSoft: "#2B1614",
  warning: "#FBBF24",
  warningSoft: "#2A2010",
  info: "#93C5FD",
  origin: palette.yellowBright,
  destination: palette.greenBright,
};

/**
 * What the apps import. Switching the product's look is this one line - every
 * screen reads colour from here and nothing hard-codes a hex.
 */
export const theme: Theme = lightTheme;
