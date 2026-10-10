/**
 * The URUMURI brand colours, every one checked against the contrast test below
 * rather than taken on trust. The brand book's success green (#16A34A) measures
 * 3.07:1 as text on the page ground and its error red (#DC2626) exactly 4.50,
 * so the text versions here are the same hues one step deeper; the book's
 * brighter ones survive as tints and fills. The yellow never carries white type
 * (1.67:1): it is a ground, with midnight type on it (9.4:1).
 */
export const palette = {
  // Ground and card: the brand's light grey, so a white card has an edge
  // without needing a border to find it.
  ground: "#F5F7FA",
  card: "#FFFFFF",
  // A card nested inside a card - a vehicle row inside a sheet.
  sunken: "#EEF1F5",
  // Silver, the brand's border colour.
  hairline: "#E5E7EB",

  // Charcoal for headings, slate for body text.
  ink: "#1F2937",
  inkSoft: "#4B5563",
  inkMuted: "#5F6B7A",

  // Midnight blue, the primary brand colour: buttons, links, the route origin.
  midnight: "#0A2342",
  midnightDeep: "#061A33",
  // The brand book's 10% tint.
  midnightSoft: "#E7E9EC",

  // Urumuri yellow, the accent: the vest patch, the PIN, being online. A
  // hi-vis colour for the few things a person has to find at a glance.
  yellow: "#F4C20D",
  // The brand book's 20% tint.
  yellowSoft: "#FDF3CF",

  white: "#FFFFFF",

  // One step up from midnight: shapes, chips and fields that sit on a
  // midnight header without disappearing into it.
  midnightLift: "#16345C",
  // Secondary text on midnight (8.9:1).
  midnightMist: "#B4C0D3",

  // Tile grounds. Pale enough to carry charcoal type and a coloured drawing;
  // one per kind of thing, so a tile is recognised by colour before it is read.
  tintBlue: "#E8EEF8",
  tintYellow: "#FEF6D9",
  tintGreen: "#E4F5EA",
  tintAmber: "#FDEEDD",

  // Functional colours, as text and as tints. Never a background.
  green: "#15803D",
  greenSoft: "#DCFCE7",
  red: "#B91C1C",
  redSoft: "#FEE2E2",
  amber: "#B45309",
  amberSoft: "#FDF1E3",
  info: "#1D4ED8",

  // The night: the midnight, deeper, for the dark theme's page and cards.
  night: "#0A1220",
  nightRaised: "#131B2B",
  nightSunken: "#1C2537",
  nightHairline: "#2A3447",
  // The hero at night: one step brighter than the page, so the block keeps an edge.
  nightHero: "#142C4F",
  nightHeroLift: "#1F3E6B",
  // Mist: what midnight becomes on a dark page - buttons, links, the active tab.
  mist: "#C9D4E6",
  mistDeep: "#DCE4F0",
  mistSoft: "#1C2A44",
  // Signals lifted to read on the night.
  greenBright: "#4ADE80",
  redBright: "#F87171",
  amberBright: "#FBBF24",
  infoBright: "#93C5FD",
  // Dark tints: a trace of each colour on the night.
  nightTintBlue: "#162238",
  nightTintYellow: "#2A2410",
  nightTintGreen: "#12281F",
  nightTintAmber: "#2A2010",
  nightTintRed: "#341A1A",
} as const;

export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 } as const;

/** Generous corners. A 20pt card radius is what makes the reference feel calm. */
export const radius = { sm: 10, md: 14, lg: 20, xl: 28, pill: 999 } as const;

/**
 * Fares, ETAs and earnings are the most-read text in the product, so they get
 * display sizes with tight leading and a small grey label underneath rather
 * than a label in front.
 */
export const type = {
  display: { size: 34, weight: "700", leading: 40 },
  stat: { size: 28, weight: "700", leading: 32 },
  title: { size: 22, weight: "700", leading: 28 },
  body: { size: 16, weight: "400", leading: 22 },
  label: { size: 13, weight: "600", leading: 18 },
  caption: { size: 12, weight: "500", leading: 16 },
} as const;

/** Minimum one-thumb touch target, in points. */
export const MIN_TOUCH_TARGET = 48;

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export const tokens = { palette, space, radius, type, MIN_TOUCH_TARGET } as const;
