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

  it("the highlight tint reads with the same type as the highlight", () => {
    expect(contrastRatio(theme.onHighlight, theme.highlightSoft)).toBeGreaterThanOrEqual(AA);
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
describe("the dark theme, kept honest", () => {
  const cases: [keyof Theme, number][] = [
    ["text", AA],
    ["textStrong", AAA],
    ["textMuted", AA],
    ["accent", AA],
    ["success", AA],
    ["danger", AA],
    ["warning", AA],
  ];

  for (const [key, floor] of cases) {
    it(`${key} is legible on the dark surface`, () => {
      expect(contrastRatio(darkTheme[key], darkTheme.surface)).toBeGreaterThanOrEqual(floor);
    });
  }

  it("text on its accent is readable", () => {
    expect(contrastRatio(darkTheme.onAccent, darkTheme.accent)).toBeGreaterThanOrEqual(AA);
  });
});
