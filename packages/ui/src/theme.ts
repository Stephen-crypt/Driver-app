import { palette } from "./tokens";

export interface Theme {
  /** The page ground. */
  readonly surface: string;
  /** A card sitting on the ground. */
  readonly surfaceRaised: string;
  /** A card nested inside another card - a vehicle row inside the sheet. */
  readonly surfaceHigh: string;
  /** Hairlines and card outlines. Never load-bearing on its own. */
  readonly border: string;
  readonly text: string;
  readonly textStrong: string;
  readonly textMuted: string;
  readonly accent: string;
  readonly onAccent: string;
  readonly success: string;
  readonly danger: string;
  /** The pickup end of a route. */
  readonly origin: string;
  /** The drop-off end of a route. */
  readonly destination: string;
}

export const lightTheme: Theme = {
  surface: palette.paper,
  surfaceRaised: palette.white,
  surfaceHigh: palette.paper,
  border: palette.indigo300,
  text: palette.slate600,
  textStrong: palette.indigo900,
  textMuted: palette.slate600,
  accent: palette.amber500,
  onAccent: palette.indigo900,
  success: palette.success,
  danger: palette.danger,
  origin: palette.amber500,
  destination: palette.success,
};

/**
 * The shipped look.
 *
 * Dark, because the two moments this product is used are a rider on a street at
 * night and a driver with the app open for a twelve-hour shift - a white screen
 * is hostile in the first and burns battery through the second. The three
 * surface levels are what let a card sit inside a card without a border doing
 * all the work.
 *
 * The accent stays amber rather than the neon green the reference design uses.
 * Amber is the moto vest: in Kigali it already means "this is a ride", and it
 * is the one colour on the street the product is named after. Green on black is
 * what every fintech looks like.
 */
export const darkTheme: Theme = {
  surface: palette.indigo900,
  surfaceRaised: palette.indigo800,
  surfaceHigh: palette.indigo700,
  border: palette.indigo500,
  text: palette.indigo300,
  textStrong: palette.white,
  textMuted: palette.indigo300,
  accent: palette.amber500,
  onAccent: palette.indigo900,
  success: palette.successBright,
  danger: palette.dangerBright,
  origin: palette.amber500,
  destination: palette.successBright,
};

/**
 * What the apps import. Switching the product's look is this one line - every
 * screen reads colour from here and nothing hard-codes a hex.
 */
export const theme: Theme = darkTheme;
