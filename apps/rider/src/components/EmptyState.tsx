import { Image, StyleSheet, Text, View } from "react-native";
import { theme, tokens } from "@gera/ui";

interface Props {
  readonly title: string;
  readonly body: string;
}

/**
 * The picture is the point: an empty list with only grey text on it reads as a
 * broken screen, and the one thing a rider seeing "no drivers nearby" needs is
 * the sense that nothing is wrong with the app.
 *
 * The illustration's own ground is #161C34, within a hair of surfaceRaised, so
 * it sits on a card with no visible seam.
 */
export function EmptyState({ title, body }: Props) {
  return (
    <View style={styles.root}>
      <Image
        source={require("../../assets/empty-state.jpg")}
        style={styles.art}
        resizeMode="cover"
        accessible={false}
      />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    borderRadius: tokens.radius.lg,
    backgroundColor: theme.surfaceRaised,
    overflow: "hidden",
    paddingBottom: tokens.space.lg,
  },
  art: { width: "100%", aspectRatio: 16 / 9 },
  title: {
    marginTop: tokens.space.md,
    marginHorizontal: tokens.space.lg,
    fontSize: tokens.type.title.size,
    fontWeight: "700",
    color: theme.textStrong,
  },
  body: {
    marginTop: tokens.space.xs,
    marginHorizontal: tokens.space.lg,
    fontSize: tokens.type.body.size,
    lineHeight: tokens.type.body.leading,
    color: theme.textMuted,
  },
});
