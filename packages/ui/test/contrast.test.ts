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

  it("stacks three distinct surface levels, so a card can sit inside a card", () => {
    const levels = new Set([theme.surface, theme.surfaceRaised, theme.surfaceHigh]);
    expect(levels.size).toBe(3);
  });
});
