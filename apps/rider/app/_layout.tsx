import { View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { OverlayProvider, c, useNovaFonts } from "@nova/kit";

export default function RootLayout() {
  // Nothing renders until the faces load: a screen that paints in the system
  // font and then jumps to Barlow a moment later looks broken, not fast.
  const fontsReady = useNovaFonts();
  if (!fontsReady) return <View style={{ flex: 1, backgroundColor: c.surface }} />;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: c.surface }}>
      <OverlayProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: c.surface },
            animation: "ios_from_right",
          }}
        >
          <Stack.Screen name="welcome" options={{ animation: "fade" }} />
          <Stack.Screen name="(tabs)" options={{ animation: "fade" }} />
          <Stack.Screen name="inspect/scan" options={{ animation: "fade" }} />
        </Stack>
      </OverlayProvider>
    </GestureHandlerRootView>
  );
}
