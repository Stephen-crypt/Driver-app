import { darkTheme, lightTheme, type Theme } from "./theme";

/** What a person chose: follow the device, or one theme whatever the device says. */
export type Appearance = "system" | "light" | "dark";
/** What is actually drawn. */
export type Scheme = "light" | "dark";

/** A stored value, however it was stored. Anything unrecognised means "follow the device". */
export function parseAppearance(raw: string | null | undefined): Appearance {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "light" || v === "dark" ? v : "system";
}

/** The device's answer only matters when the choice is "system"; "dark" is the one value that darkens. */
export function resolveScheme(choice: Appearance, system: string | null | undefined): Scheme {
  if (choice === "light" || choice === "dark") return choice;
  return system === "dark" ? "dark" : "light";
}

export const themeFor = (scheme: Scheme): Theme => (scheme === "dark" ? darkTheme : lightTheme);
