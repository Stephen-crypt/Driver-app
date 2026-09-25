/**
 * Every colour here was chosen against the contrast test, not by eye.
 *
 * The obvious iOS blue (#0A84FF) reads beautifully and fails WCAG AA as text on
 * white at 3.65:1 - so the accent is a deeper #0057E7, which is visually within
 * a hair of it and passes in both directions. Same story for muted grey: the
 * common #6B7280 measures 4.36 on the page ground and is out; #5E6676 is in.
 */
export const palette = {
  // Ground and card. The page is a shade off white so a white card has an edge
  // without needing a border to find it.
  ground: "#F2F3F7",
  card: "#FFFFFF",
  // A card nested inside a card - a vehicle row inside a sheet.
  sunken: "#EDEFF4",
  hairline: "#E2E5EC",

  ink: "#0B0D12",
  inkSoft: "#3C4250",
  inkMuted: "#5E6676",

  blue: "#0057E7",
  blueSoft: "#E6EDFD",

  white: "#FFFFFF",

  // Accents, used as small signals - a status chip, an icon - never as ground.
  green: "#0E7C4A",
  greenSoft: "#E3F4EB",
  red: "#C42419",
  redSoft: "#FBE9E8",
  amber: "#B45309",
  amberSoft: "#FDF1E3",

  // Kept for the dark theme below.
  night: "#0B0D12",
  nightRaised: "#171A21",
  nightSunken: "#22262F",
  nightHairline: "#2E333D",
  blueBright: "#4D94FF",
  greenBright: "#34D399",
  redBright: "#F87171",
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
