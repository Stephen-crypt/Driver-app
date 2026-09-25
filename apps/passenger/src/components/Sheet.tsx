import type { ReactNode } from "react";
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { theme, tokens, sheetHeightFor, sheetTitleFor } from "@gera/ui";

interface Props {
  readonly state: string;
  readonly children: ReactNode;
}

/**
 * Spec 5.1: one map, one sheet. The sheet's height and title are a pure
 * function of the trip state, so the UI cannot drift out of agreement with
 * the server - there is no second copy of "what is happening" to go stale.
 */
export function Sheet({ state, children }: Props) {
  const { height } = useWindowDimensions();
  return (
    <View style={[styles.sheet, { height: height * sheetHeightFor(state) }]}>
      <View style={styles.grabber} />
      <Text style={styles.title}>{sheetTitleFor(state)}</Text>
      {/* Scrolls: the accepted sheet carries a route, a fare, a rider card and
          an action row, and on a short screen the actions were being clipped
          off the bottom with no way to reach them. */}
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.surfaceRaised,
    borderTopLeftRadius: tokens.radius.lg,
    borderTopRightRadius: tokens.radius.lg,
    paddingHorizontal: tokens.space.lg,
    paddingTop: tokens.space.sm,
    paddingBottom: tokens.space.xl,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
    elevation: 12,
  },
  grabber: {
    alignSelf: "center",
    width: 44,
    height: 5,
    borderRadius: tokens.radius.pill,
    backgroundColor: theme.textMuted,
    opacity: 0.35,
    marginBottom: tokens.space.md,
  },
  title: {
    fontSize: tokens.type.title.size,
    fontWeight: "700",
    color: theme.textStrong,
    marginBottom: tokens.space.md,
  },
  body: { flex: 1 },
  bodyContent: { flexGrow: 1, paddingBottom: tokens.space.md },
});
