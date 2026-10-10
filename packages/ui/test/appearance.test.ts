import { describe, it, expect } from "vitest";
import { parseAppearance, resolveScheme, themeFor } from "../src/appearance";
import { darkTheme, lightTheme } from "../src/theme";

describe("parseAppearance", () => {
  it("accepts the three choices, trimmed and in any case", () => {
    expect(parseAppearance("dark")).toBe("dark");
    expect(parseAppearance(" Light\n")).toBe("light");
    expect(parseAppearance("SYSTEM")).toBe("system");
  });
  it("treats anything else as following the system", () => {
    for (const raw of ["purple", "", null, undefined, "0", "true"]) expect(parseAppearance(raw)).toBe("system");
  });
});

describe("resolveScheme", () => {
  it("a saved choice wins over the phone", () => {
    expect(resolveScheme("dark", "light")).toBe("dark");
    expect(resolveScheme("light", "dark")).toBe("light");
  });
  it("system follows the phone, and light when the phone says nothing", () => {
    expect(resolveScheme("system", "dark")).toBe("dark");
    expect(resolveScheme("system", "light")).toBe("light");
    expect(resolveScheme("system", null)).toBe("light");
    expect(resolveScheme("system", "unspecified")).toBe("light");
  });
});

describe("themeFor", () => {
  it("hands back the matching palette", () => {
    expect(themeFor("light")).toBe(lightTheme);
    expect(themeFor("dark")).toBe(darkTheme);
  });
});
