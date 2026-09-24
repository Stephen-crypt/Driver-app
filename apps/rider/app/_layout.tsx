import { Stack } from "expo-router";
import { lightTheme } from "@gera/ui";

export default function RootLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: lightTheme.surface },
      }}
    />
  );
}
