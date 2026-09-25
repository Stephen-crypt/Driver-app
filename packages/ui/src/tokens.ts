export const palette = {
  // Indigo night — the brand ground.
  indigo900: "#0B1022",
  indigo800: "#141B34",
  indigo700: "#1E2745",
  indigo500: "#3A4770",
  indigo300: "#8A94B8",

  // Amber — moto vest, high-visibility, the single accent.
  amber600: "#B26A00",
  amber500: "#F5A524",
  amber300: "#FFC96B",

  white: "#FFFFFF",
  paper: "#F7F8FB",
  slate600: "#4A5268",
  slate900: "#111523",

  success: "#0E7C4A",
  danger: "#C0342B",

  // Dark-theme variants. The light-theme green and red are too dark against an
  // indigo ground - measured at 3.60 and 3.39 against #0B1022, both under the
  // 4.5 floor. A "completed" label nobody can read is worse than no label.
  successBright: "#34D399",
  dangerBright: "#F87171",
} as const;

export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 } as const;

export const radius = { sm: 8, md: 14, lg: 22, pill: 999 } as const;

/** Fares and ETAs are the most-read text in the product; they get display sizes. */
export const type = {
  display: { size: 44, weight: "700", leading: 48 },
  title: { size: 24, weight: "700", leading: 30 },
  body: { size: 16, weight: "400", leading: 24 },
  label: { size: 13, weight: "600", leading: 18 },
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
