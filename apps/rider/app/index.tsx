import { View, Text, StyleSheet } from "react-native";
import { lightTheme, tokens } from "@gera/ui";

export default function Home() {
  return (
    <View style={styles.root}>
      <Text style={styles.title}>Gera</Text>
      <Text style={styles.sub}>Map and booking sheet arrive in Phase 2.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: lightTheme.surface,
    alignItems: "center",
    justifyContent: "center",
    padding: tokens.space.lg,
  },
  title: {
    fontSize: tokens.type.display.size,
    fontWeight: "700",
    color: lightTheme.textStrong,
  },
  sub: { fontSize: tokens.type.body.size, color: lightTheme.textMuted, marginTop: tokens.space.sm },
});
