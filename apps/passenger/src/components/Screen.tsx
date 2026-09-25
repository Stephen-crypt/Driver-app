import type { ReactNode } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme, tokens } from "@gera/ui";

interface Props {
  readonly children: ReactNode;
  /** Scrolls by default; pass false for a screen that owns its own layout. */
  readonly scroll?: boolean;
  /** Screens with their own edge-to-edge art handle the top inset themselves. */
  readonly edgeToEdgeTop?: boolean;
}

/**
 * Every screen's ground, with the status bar and gesture bar accounted for.
 *
 * Without this the first element of each screen sat underneath the status bar -
 * the search field, the "How you pay" title and the account header were all
 * partly behind the clock. Android's status bar is not a fixed height across
 * devices, so it has to come from the inset rather than a guessed padding.
 */
export function Screen({ children, scroll = true, edgeToEdgeTop = false }: Props) {
  const insets = useSafeAreaInsets();

  const pad = {
    paddingTop: edgeToEdgeTop ? 0 : insets.top + tokens.space.sm,
    // The gesture bar overlaps the last row otherwise; the extra space is what
    // stops a primary button sitting under it.
    paddingBottom: insets.bottom + tokens.space.lg,
  };

  if (!scroll) {
    return <View style={[styles.root, pad]}>{children}</View>;
  }

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, pad]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.surface },
  content: { flexGrow: 1, paddingHorizontal: tokens.space.lg },
});
