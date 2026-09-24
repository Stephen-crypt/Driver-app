import { View, Text, StyleSheet } from "react-native";
import { lightTheme, tokens } from "@gera/ui";

export default function PendingScreen() {
  return (
    <View style={styles.root}>
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
    flex: 1, backgroundColor: lightTheme.surface,
    alignItems: "center", justifyContent: "center", padding: tokens.space.lg,
  },
  title: {
    fontSize: tokens.type.title.size, fontWeight: "700",
    color: lightTheme.textStrong, textAlign: "center",
  },
  body: {
    fontSize: tokens.type.body.size, color: lightTheme.textMuted,
    textAlign: "center", marginTop: tokens.space.md, lineHeight: tokens.type.body.leading,
  },
});
