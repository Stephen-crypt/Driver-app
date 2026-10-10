import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";
import { App } from "./App";
import { UiProvider } from "./components/ui";
import { startAppearance } from "./lib/appearance";

// The palette comes from the same tokens the apps use, in whichever look this
// browser has chosen; see lib/appearance.ts.
startAppearance();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <UiProvider>
        <App />
      </UiProvider>
    </BrowserRouter>
  </StrictMode>,
);
