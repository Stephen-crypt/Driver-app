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
  /**
   * The header block that opens each main screen: midnight, the night the
   * yellow is the light in. Type on it is white; secondary type is mist.
   */
  readonly hero: string;
  readonly heroRaised: string;
  readonly onHero: string;
  readonly onHeroMuted: string;
  /** Tile grounds, one per kind of thing. */
  readonly tintBlue: string;
  readonly tintYellow: string;
  readonly tintGreen: string;
  readonly tintAmber: string;
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
  hero: palette.midnight,
  heroRaised: palette.midnightLift,
  onHero: palette.white,
  onHeroMuted: palette.midnightMist,
  tintBlue: palette.tintBlue,
  tintYellow: palette.tintYellow,
  tintGreen: palette.tintGreen,
  tintAmber: palette.tintAmber,
};

/**
 * Nova at night. The page is the midnight, deeper; cards a lighter navy; what
 * was midnight on a light page (buttons, links, the active tab) becomes mist
 * with navy type; the hero stays navy, one step brighter than the page. Yellow
 * keeps every job it has. Held to the same contrast bar as the light theme.
 */
export const darkTheme: Theme = {
  surface: palette.night,
  surfaceRaised: palette.nightRaised,
  surfaceHigh: palette.nightSunken,
  border: palette.nightHairline,
  text: "#C3C9D4",
  textStrong: palette.white,
  textMuted: "#9AA2B1",
  accent: palette.mist,
  accentSoft: palette.mistSoft,
  accentDeep: palette.mistDeep,
  onAccent: palette.midnight,
  highlight: palette.yellow,
  highlightSoft: palette.nightTintYellow,
  onHighlight: palette.midnight,
  success: palette.greenBright,
  successSoft: palette.nightTintGreen,
  danger: palette.redBright,
  dangerSoft: palette.nightTintRed,
  warning: palette.amberBright,
  warningSoft: palette.nightTintAmber,
  info: palette.infoBright,
  origin: palette.mist,
  destination: palette.greenBright,
  hero: palette.nightHero,
  heroRaised: palette.nightHeroLift,
  onHero: palette.white,
  onHeroMuted: palette.midnightMist,
  tintBlue: palette.nightTintBlue,
  tintYellow: palette.nightTintYellow,
  tintGreen: palette.nightTintGreen,
  tintAmber: palette.nightTintAmber,
};

/** The light theme, which `@nova/kit` and the dashboard start from; each picks at runtime. */
export const theme: Theme = lightTheme;
