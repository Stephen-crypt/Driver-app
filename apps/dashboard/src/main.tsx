import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "leaflet/dist/leaflet.css";
import { theme } from "@nova/ui";
import "./styles.css";
import { App } from "./App";
import { UiProvider } from "./components/ui";

// The palette comes from the same tokens the apps use, so a colour change is
// one edit in packages/ui and all three surfaces follow.
const vars: Record<string, string> = {
  "--ground": theme.surface,
  "--card": theme.surfaceRaised,
  "--sunken": theme.surfaceHigh,
  "--hairline": theme.border,
  "--ink": theme.textStrong,
  "--ink-soft": theme.text,
  "--muted": theme.textMuted,
  "--accent": theme.accent,
  "--accent-soft": theme.accentSoft,
  "--accent-deep": theme.accentDeep,
  "--highlight": theme.highlight,
  "--highlight-soft": theme.highlightSoft,
  "--on-highlight": theme.onHighlight,
  "--good": theme.success,
  "--good-soft": theme.successSoft,
  "--bad": theme.danger,
  "--bad-soft": theme.dangerSoft,
  "--warn": theme.warning,
  "--warn-soft": theme.warningSoft,
};
for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <UiProvider>
        <App />
      </UiProvider>
    </BrowserRouter>
  </StrictMode>,
);
