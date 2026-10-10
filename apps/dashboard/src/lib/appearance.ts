import { useSyncExternalStore } from "react";
import { mapTheme, parseAppearance, resolveScheme, themeFor, type Appearance, type Scheme, type Theme } from "@nova/ui";

export type { Appearance, Scheme };

// The look, chosen per browser: "system" follows the computer and changes
// with it while the page is open; "light" and "dark" stay put. Unlike the
// phones, the dashboard switches on the spot - everything is a CSS variable.
const KEY = "nova.appearance";
const media = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null);

export function readAppearance(): Appearance {
  try {
    return parseAppearance(localStorage.getItem(KEY));
  } catch {
    return "system";
  }
}
export const systemScheme = (): Scheme => (media()?.matches ? "dark" : "light");
export const currentScheme = (): Scheme => resolveScheme(readAppearance(), systemScheme());

// The same tokens the apps use, as custom properties, so the three surfaces cannot drift apart.
const VARS: readonly [string, keyof Theme][] = [
  ["--ground", "surface"],
  ["--card", "surfaceRaised"],
  ["--sunken", "surfaceHigh"],
  ["--hairline", "border"],
  ["--ink", "textStrong"],
  ["--ink-soft", "text"],
  ["--muted", "textMuted"],
  ["--accent", "accent"],
  ["--accent-soft", "accentSoft"],
  ["--accent-deep", "accentDeep"],
  ["--on-accent", "onAccent"],
  ["--highlight", "highlight"],
  ["--highlight-soft", "highlightSoft"],
  ["--on-highlight", "onHighlight"],
  ["--good", "success"],
  ["--good-soft", "successSoft"],
  ["--bad", "danger"],
  ["--bad-soft", "dangerSoft"],
  ["--warn", "warning"],
  ["--warn-soft", "warningSoft"],
  ["--hero", "hero"],
  ["--hero-raised", "heroRaised"],
  ["--on-hero-muted", "onHeroMuted"],
  ["--tint-blue", "tintBlue"],
  ["--tint-yellow", "tintYellow"],
  ["--tint-green", "tintGreen"],
  ["--tint-amber", "tintAmber"],
];

export function applyScheme(s: Scheme): void {
  const t = themeFor(s);
  const root = document.documentElement;
  for (const [name, key] of VARS) root.style.setProperty(name, t[key]);
  root.style.setProperty("--map-ground", mapTheme(s).ground);
  root.style.colorScheme = s;
  root.dataset.theme = s;
}

const listeners = new Set<() => void>();
let applied: Scheme | null = null;
function refresh(): void {
  const s = currentScheme();
  if (s !== applied) {
    applied = s;
    applyScheme(s);
  }
  for (const l of listeners) l();
}
media()?.addEventListener("change", refresh);

export function setAppearance(a: Appearance): void {
  try {
    localStorage.setItem(KEY, a);
  } catch {
    // A private window may refuse; the choice still applies to this page.
  }
  refresh();
}

/** The scheme being drawn; re-renders when it changes. */
export function useScheme(): Scheme {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    currentScheme,
    () => "light" as Scheme,
  );
}

/** What the person chose; re-renders when it changes. */
export function useAppearance(): Appearance {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    readAppearance,
    () => "system" as Appearance,
  );
}

/** Called once, before the first render. */
export function startAppearance(): void {
  refresh();
}
