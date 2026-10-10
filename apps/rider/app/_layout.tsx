import { View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { OverlayProvider, c, restingStatusBarStyle, useNovaFonts } from "@nova/kit";

// The window behind every screen, in this run's theme. Without it the light
// ground from app.json shows for a moment when the app restarts into the night.
void SystemUI.setBackgroundColorAsync(c.surface);

export default function RootLayout() {
  // Nothing renders until the faces load: a screen that paints in the system
  // font and then jumps to Barlow a moment later looks broken, not fast.
  const fontsReady = useNovaFonts();
  if (!fontsReady) return <View style={{ flex: 1, backgroundColor: c.surface }} />;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: c.surface }}>
      <OverlayProvider>
        <StatusBar style={restingStatusBarStyle} />
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
