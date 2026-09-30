import { useCallback } from "react";
import { useFocusEffect } from "expo-router";
import { setStatusBarStyle } from "expo-status-bar";

// How many focused screens want light icons. A screen that opens on the
// midnight hero asks for them while it is in front; the dark default comes
// back only once nobody is asking, whatever order screens gain and lose focus.
let holds = 0;

/** White status-bar icons while this screen is in front: it opens on midnight. */
export function useLightStatusBar(): void {
  useFocusEffect(
    useCallback(() => {
      holds += 1;
      setStatusBarStyle("light", true);
      return () => {
        holds = Math.max(0, holds - 1);
        if (holds === 0) setStatusBarStyle("dark", true);
      };
    }, []),
  );
}

/** The same, as an element: for a screen that is only on midnight some of the time. */
export function LightStatusBar(): null {
  useLightStatusBar();
  return null;
}
