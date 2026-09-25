import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme, tokens } from "@gera/ui";

interface Props {
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly title: string;
  readonly body: string;
}

/**
 * An icon in a tinted well rather than an illustration.
 *
 * This used to render a generated picture. A raster illustration carries its own
 * background colour, so it only sits cleanly on the exact card it was drawn
 * against - the moment the theme moved, the art was a dark rectangle on a white
 * card with a visible seam. An icon well takes its colours from the theme, so it
 * can never fall out of step with it again.
 */
export function EmptyState({ icon, title, body }: Props) {
  return (
    <View style={styles.root}>
      <View style={styles.well}>
        <Ionicons name={icon} size={28} color={theme.accent} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    borderRadius: tokens.radius.lg,
    backgroundColor: theme.surfaceRaised,
    padding: tokens.space.lg,
    alignItems: "center",
  },
  well: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: theme.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    marginTop: tokens.space.md,
    fontSize: tokens.type.title.size,
    fontWeight: "700",
    color: theme.textStrong,
    textAlign: "center",
  },
  body: {
    marginTop: tokens.space.xs,
    fontSize: tokens.type.body.size,
    lineHeight: tokens.type.body.leading,
    color: theme.textMuted,
    textAlign: "center",
  },
});
