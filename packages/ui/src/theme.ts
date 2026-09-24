import { palette } from "./tokens";

export interface Theme {
  readonly surface: string;
  readonly surfaceRaised: string;
  readonly text: string;
  readonly textStrong: string;
  readonly textMuted: string;
  readonly accent: string;
  readonly onAccent: string;
  readonly success: string;
  readonly danger: string;
}

export const lightTheme: Theme = {
  surface: palette.paper,
  surfaceRaised: palette.white,
  text: palette.slate600,
  textStrong: palette.indigo900,
  textMuted: palette.slate600,
  accent: palette.amber500,
  onAccent: palette.indigo900,
  success: palette.success,
  danger: palette.danger,
};

export const darkTheme: Theme = {
  surface: palette.indigo900,
  surfaceRaised: palette.indigo800,
  text: palette.indigo300,
  textStrong: palette.white,
  textMuted: palette.indigo300,
  accent: palette.amber500,
  onAccent: palette.indigo900,
  success: palette.success,
  danger: palette.danger,
};
