import { describe, it, expect } from "vitest";
import { contrastRatio } from "../src/tokens";
import { lightTheme, darkTheme, theme, type Theme } from "../src/theme";

const AA = 4.5;
const AAA = 7;

describe("sunlight legibility", () => {
  it("body text on surface clears WCAG AA in light theme", () => {
    expect(contrastRatio(lightTheme.text, lightTheme.surface)).toBeGreaterThanOrEqual(AA);
  });

  it("body text on surface clears WCAG AA in dark theme", () => {
    expect(contrastRatio(darkTheme.text, darkTheme.surface)).toBeGreaterThanOrEqual(AA);
  });

  it("fare numerals clear AAA in light theme", () => {
    expect(contrastRatio(lightTheme.textStrong, lightTheme.surface)).toBeGreaterThanOrEqual(AAA);
  });

  it("text on the amber accent is readable", () => {
    expect(contrastRatio(lightTheme.onAccent, lightTheme.accent)).toBeGreaterThanOrEqual(AA);
  });

  it("muted text is still legible, never decorative grey", () => {
    expect(contrastRatio(lightTheme.textMuted, lightTheme.surface)).toBeGreaterThanOrEqual(AA);
  });
});

/**
 * Applied to whichever theme actually ships. The light-theme success and danger
 * measured 3.60 and 3.39 against the dark ground when the app went dark - a
 * "Completed" label nobody can read. These run against `theme` so the next
 * palette change cannot reintroduce that quietly.
 */
describe("the shipped theme", () => {
  const cases: [keyof Theme, number][] = [
    ["text", AA],
    ["textStrong", AAA],
    ["textMuted", AA],
    ["accent", AA],
    ["success", AA],
    ["danger", AA],
    ["origin", AA],
    ["destination", AA],
  ];

  for (const [key, floor] of cases) {
    it(`${key} is legible on the surface`, () => {
      expect(contrastRatio(theme[key], theme.surface)).toBeGreaterThanOrEqual(floor);
    });
  }

  it("is legible on a raised card too, not only the page ground", () => {
    for (const key of ["text", "textStrong", "accent", "success", "danger"] as const) {
      expect(contrastRatio(theme[key], theme.surfaceRaised)).toBeGreaterThanOrEqual(AA);
    }
  });

  it("text on the accent is readable", () => {
    expect(contrastRatio(theme.onAccent, theme.accent)).toBeGreaterThanOrEqual(AA);
  });

  it("the vest patch numeral clears AAA - it is read from a moving moto", () => {
    // A PIN or a vest number is read at arm's length, in sun, often on the
    // move. AA is the floor for body text; this is the one place held higher.
    expect(contrastRatio(theme.onHighlight, theme.highlight)).toBeGreaterThanOrEqual(7);
  });

  it("type on the deep accent ground is readable", () => {
    expect(contrastRatio(theme.onAccent, theme.accentDeep)).toBeGreaterThanOrEqual(7);
  });

  it("the highlight tint carries strong type, in either theme", () => {
    expect(contrastRatio(theme.textStrong, theme.highlightSoft)).toBeGreaterThanOrEqual(AA);
  });

  it("the highlight is never a text colour on the page", () => {
    // Yellow type on a light page cannot be made legible; the theme keeps it a
    // ground. If this ever passes, the yellow has been changed to something
    // that is no longer the brand's.
    expect(contrastRatio(theme.highlight, theme.surface)).toBeLessThan(AA);
  });

  it("stacks three distinct surface levels, so a card can sit inside a card", () => {
    const levels = new Set([theme.surface, theme.surfaceRaised, theme.surfaceHigh]);
    expect(levels.size).toBe(3);
  });

  // A status chip is a colour on its own tint. Both halves have to be legible,
  // and the tint is exactly where a palette quietly stops passing - it is light
  // enough to look decorative and dark enough to eat the text on it.
  it("every chip reads against its own tint", () => {
    const chips: [string, string][] = [
      [theme.accent, theme.accentSoft],
      [theme.success, theme.successSoft],
      [theme.danger, theme.dangerSoft],
      [theme.warning, theme.warningSoft],
    ];
    for (const [ink, tint] of chips) {
      expect(contrastRatio(ink, tint)).toBeGreaterThanOrEqual(AA);
    }
  });

  it("no tint is so pale it disappears into the card behind it", () => {
    for (const tint of [theme.accentSoft, theme.successSoft, theme.dangerSoft, theme.warningSoft]) {
      expect(contrastRatio(tint, theme.surfaceRaised)).toBeGreaterThan(1.02);
    }
  });
});

/**
 * The dark theme is not shipped, but a half-maintained one is worse than none:
 * the day somebody flips `theme` to it, every one of these has to already hold.
 */
describe("the hero and the tiles", () => {
  it("white type on the midnight hero clears AAA", () => {
    expect(contrastRatio(theme.onHero, theme.hero)).toBeGreaterThanOrEqual(AAA);
  });

  it("mist, the hero's secondary type, still clears AA", () => {
    expect(contrastRatio(theme.onHeroMuted, theme.hero)).toBeGreaterThanOrEqual(AA);
  });

  it("the yellow as type is only ever on midnight, where it clears AAA", () => {
    expect(contrastRatio(theme.highlight, theme.hero)).toBeGreaterThanOrEqual(AAA);
  });

  it("white type on the hero's lifted chips and tracks is readable", () => {
    expect(contrastRatio(theme.onHero, theme.heroRaised)).toBeGreaterThanOrEqual(AA);
  });

  it("the lifted blue is visible as a shape on the hero", () => {
    expect(contrastRatio(theme.heroRaised, theme.hero)).toBeGreaterThan(1.1);
  });

  for (const tint of ["tintBlue", "tintYellow", "tintGreen", "tintAmber"] as const) {
    it(`${tint} carries headings and body text`, () => {
      expect(contrastRatio(theme.textStrong, theme[tint])).toBeGreaterThanOrEqual(AAA);
      expect(contrastRatio(theme.text, theme[tint])).toBeGreaterThanOrEqual(AA);
    });
  }
});

describe("the dark theme", () => {
  const t = darkTheme;
  const cases: [keyof Theme, number][] = [
    ["text", AA], ["textStrong", AAA], ["textMuted", AA], ["accent", AA],
    ["success", AA], ["danger", AA], ["warning", AA], ["info", AA], ["origin", AA], ["destination", AA],
  ];
  for (const [key, floor] of cases) {
    it(`${key} is legible on the night page`, () => {
      expect(contrastRatio(t[key], t.surface)).toBeGreaterThanOrEqual(floor);
    });
  }
  it("and on a card", () => {
    for (const key of ["text", "textStrong", "accent", "success", "danger"] as const) {
      expect(contrastRatio(t[key], t.surfaceRaised)).toBeGreaterThanOrEqual(AA);
    }
  });
  it("navy type on the mist accent, and on its deep ground", () => {
    expect(contrastRatio(t.onAccent, t.accent)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio(t.onAccent, t.accentDeep)).toBeGreaterThanOrEqual(AAA);
  });
  it("the yellow keeps midnight type at AAA", () => {
    expect(contrastRatio(t.onHighlight, t.highlight)).toBeGreaterThanOrEqual(AAA);
  });
  it("white on the hero clears AAA, and the hero has an edge against the page", () => {
    expect(contrastRatio(t.onHero, t.hero)).toBeGreaterThanOrEqual(AAA);
    expect(contrastRatio(t.onHeroMuted, t.hero)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio(t.hero, t.surface)).toBeGreaterThanOrEqual(1.3);
  });
  it("every chip reads against its own tint, and no tint vanishes into the card", () => {
    for (const [ink, tint] of [[t.accent, t.accentSoft], [t.success, t.successSoft], [t.danger, t.dangerSoft], [t.warning, t.warningSoft]] as const) {
      expect(contrastRatio(ink, tint)).toBeGreaterThanOrEqual(AA);
      expect(contrastRatio(tint, t.surfaceRaised)).toBeGreaterThan(1.02);
    }
  });
  it("strong type reads on the highlight tint and on every tile", () => {
    for (const ground of [t.highlightSoft, t.tintBlue, t.tintYellow, t.tintGreen, t.tintAmber]) {
      expect(contrastRatio(t.textStrong, ground)).toBeGreaterThanOrEqual(AA);
    }
  });
  it("stacks three distinct surface levels", () => {
    expect(new Set([t.surface, t.surfaceRaised, t.surfaceHigh]).size).toBe(3);
  });
});

describe("the light theme is untouched by dark mode", () => {
  it("keeps the brand values", () => {
    expect(lightTheme).toMatchObject({
      surface: "#F5F7FA", surfaceRaised: "#FFFFFF", surfaceHigh: "#EEF1F5", border: "#E5E7EB",
      text: "#4B5563", textStrong: "#1F2937", textMuted: "#5F6B7A",
      accent: "#0A2342", accentSoft: "#E7E9EC", accentDeep: "#061A33", onAccent: "#FFFFFF",
      highlight: "#F4C20D", highlightSoft: "#FDF3CF", onHighlight: "#0A2342",
      success: "#15803D", danger: "#B91C1C", warning: "#B45309", info: "#1D4ED8",
      hero: "#0A2342", heroRaised: "#16345C", onHero: "#FFFFFF", onHeroMuted: "#B4C0D3",
      tintBlue: "#E8EEF8", tintYellow: "#FEF6D9", tintGreen: "#E4F5EA", tintAmber: "#FDEEDD",
    });
    expect(theme).toBe(lightTheme);
  });
});
