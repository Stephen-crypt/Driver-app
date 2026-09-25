import { Stack } from "expo-router";
import { theme } from "@gera/ui";

export default function RootLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.surface },
      }}
    />
  );
}
