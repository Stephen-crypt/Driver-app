import { View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { c, useGeraFonts } from "@gera/kit";

export default function RootLayout() {
  // Nothing renders until the faces load: a screen that paints in the system
  // font and then jumps to Barlow a moment later looks broken, not fast.
  const fontsReady = useGeraFonts();
  if (!fontsReady) return <View style={{ flex: 1, backgroundColor: c.surface }} />;

  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: c.surface },
          animation: "slide_from_right",
        }}
      />
    </>
  );
}
