import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { Button, IconButton, Screen, Txt, c, ease, notify, radius, space } from "@nova/kit";
import { goBack } from "../../src/lib/nav";

const FRAME = 250;
const CORNER = 34;

/** Reads a rider's QR from their phone, or a vehicle's sticker. */
export default function Scan() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const reduce = useReducedMotion();
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  // The camera reports the same code many times a second; act on the first.
  const handled = useRef(false);

  // A line sweeping the frame says "looking" without a word. It is slow and
  // eased at both ends, like a scanner head, and simply sits still with
  // reduced motion.
  const sweep = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    sweep.set(withRepeat(withTiming(1, { duration: 1800, easing: ease.inOut }), -1, true));
  }, [reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  const line = useAnimatedStyle(() => ({ transform: [{ translateY: 12 + sweep.get() * (FRAME - 24) }] }));

  if (!permission) return <View style={styles.dark} />;

  if (!permission.granted) {
    return (
      <Screen
        title="Camera needed"
        subtitle="Scanning uses the camera. Nothing is recorded; it only reads the code."
        onBack={() => goBack(router)}
        footer={
          <Button
            label={permission.canAskAgain ? "Allow the camera" : "Type the code instead"}
            onPress={permission.canAskAgain ? requestPermission : () => goBack(router)}
          />
        }
      >
        <Txt v="body" tone="muted">
          If you'd rather not, go back and type the vest number or plate.
        </Txt>
      </Screen>
    );
  }

  return (
    <View style={styles.dark}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={torch}
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={({ data }) => {
          if (handled.current || !data) return;
          handled.current = true;
          notify("success");
          router.replace({ pathname: "/inspect/check", params: { code: data } });
        }}
      />

      <View style={[styles.top, { paddingTop: insets.top + space.sm }]}>
        <View style={styles.round}>
          <IconButton icon="close" label="Cancel" tone="onDark" onPress={() => goBack(router)} size={44} />
        </View>
        <View style={styles.round}>
          <IconButton icon={torch ? "flashlight" : "flashlight-outline"} label={torch ? "Torch off" : "Torch on"} tone="onDark" onPress={() => setTorch((t) => !t)} size={44} />
        </View>
      </View>

      <View style={styles.center} pointerEvents="none">
        <View style={styles.frame}>
          <View style={[styles.corner, styles.tl]} />
          <View style={[styles.corner, styles.tr]} />
          <View style={[styles.corner, styles.bl]} />
          <View style={[styles.corner, styles.br]} />
          <Animated.View style={[styles.line, line]} />
        </View>
        <View style={styles.hint}>
          <Txt v="bodyStrong" tone="onHero" align="center">
            Point at the rider's QR or the vehicle sticker
          </Txt>
        </View>
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + space.lg }]}>
        <Button label="Type the code instead" variant="secondary" onPress={() => goBack(router)} />
      </View>
    </View>
  );
}

const edge = { position: "absolute" as const, width: CORNER, height: CORNER, borderColor: "#FFFFFF" };

const styles = StyleSheet.create({
  dark: { flex: 1, backgroundColor: "#000" },
  top: { position: "absolute", left: space.md, right: space.md, flexDirection: "row", justifyContent: "space-between" },
  round: { borderRadius: 22, backgroundColor: "rgba(0,0,0,0.42)" },
  center: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", gap: space.xl, padding: space.xl },
  frame: { width: FRAME, height: FRAME },
  corner: edge,
  tl: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: radius.lg },
  tr: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: radius.lg },
  bl: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: radius.lg },
  br: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: radius.lg },
  line: { position: "absolute", left: 14, right: 14, height: 2, borderRadius: 1, backgroundColor: c.accent, opacity: 0.9 },
  hint: { maxWidth: 300, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill, backgroundColor: "rgba(0,0,0,0.5)" },
  bottom: { position: "absolute", left: space.lg, right: space.lg, bottom: 0 },
});
