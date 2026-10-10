import { View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { OverlayProvider, c, restingStatusBarStyle, useNovaFonts } from "@nova/kit";

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
            // The iOS push on both platforms: one way of moving through Nova.
            animation: "ios_from_right",
          }}
        >
          {/* Search comes up from where you tapped "Where to?", and goes back down. */}
          <Stack.Screen name="destination" options={{ animation: "fade_from_bottom" }} />
          <Stack.Screen name="welcome" options={{ animation: "fade" }} />
          <Stack.Screen name="(tabs)" options={{ animation: "fade" }} />
        </Stack>
      </OverlayProvider>
    </GestureHandlerRootView>
  );
}
