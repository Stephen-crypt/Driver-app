import { describe, it, expect } from "vitest";
import { contrastRatio } from "../src/tokens";
import { lightTheme, darkTheme } from "../src/theme";

describe("sunlight legibility", () => {
  it("body text on surface clears WCAG AA in light theme", () => {
    expect(contrastRatio(lightTheme.text, lightTheme.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it("body text on surface clears WCAG AA in dark theme", () => {
    expect(contrastRatio(darkTheme.text, darkTheme.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it("fare numerals clear AAA in light theme", () => {
    expect(contrastRatio(lightTheme.textStrong, lightTheme.surface)).toBeGreaterThanOrEqual(7);
  });

  it("text on the amber accent is readable", () => {
    expect(contrastRatio(lightTheme.onAccent, lightTheme.accent)).toBeGreaterThanOrEqual(4.5);
  });

  it("muted text is still legible, never decorative grey", () => {
    expect(contrastRatio(lightTheme.textMuted, lightTheme.surface)).toBeGreaterThanOrEqual(4.5);
  });
});
