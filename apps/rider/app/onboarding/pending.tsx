import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme, tokens } from "@gera/ui";

export default function PendingScreen() {
  return (
    <View style={styles.root}>
      {/* A rider lands here and then waits, possibly for hours. A screen of two
          grey paragraphs reads as a dead end; the mark gives it a state. */}
      <View style={styles.well}>
        <Ionicons name="hourglass-outline" size={32} color={theme.accent} />
      </View>
      <Text style={styles.title}>We're checking your documents</Text>
      <Text style={styles.body}>
        This usually takes a few hours. We'll text you the moment you're approved,
        and you can start taking trips straight away.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1, backgroundColor: theme.surface,
    alignItems: "center", justifyContent: "center", padding: tokens.space.lg,
  },
  well: {
    width: 76, height: 76, borderRadius: 38,
    backgroundColor: theme.accentSoft,
    alignItems: "center", justifyContent: "center",
    marginBottom: tokens.space.lg,
  },
  title: {
    fontSize: tokens.type.title.size, fontWeight: "700",
    color: theme.textStrong, textAlign: "center",
  },
  body: {
    fontSize: tokens.type.body.size, color: theme.textMuted,
    textAlign: "center", marginTop: tokens.space.md, lineHeight: tokens.type.body.leading,
  },
});
