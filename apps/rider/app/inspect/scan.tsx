import { useRef } from "react";
import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Button, Screen, Txt, c, notify, radius, space } from "@gera/kit";
import { goBack } from "../../src/lib/nav";

/** Reads a rider's QR from their phone, or a vehicle's sticker. */
export default function Scan() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  // The camera reports the same code many times a second; act on the first.
  const handled = useRef(false);

  if (!permission) return <View style={styles.dark} />;

  if (!permission.granted) {
    return (
      <Screen
        title="Camera needed"
        subtitle="Scanning uses the camera. Nothing is recorded; it only reads the code."
        onBack={() => goBack(router)}
        footer={<Button label={permission.canAskAgain ? "Allow the camera" : "Type the code instead"} onPress={permission.canAskAgain ? requestPermission : () => goBack(router)} />}
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
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={({ data }) => {
          if (handled.current || !data) return;
          handled.current = true;
          notify("success");
          router.replace({ pathname: "/inspect/check", params: { code: data } });
        }}
      />
      <View style={styles.overlay} pointerEvents="box-none">
        <View style={styles.frame} />
        <Txt v="bodyStrong" tone="inverse" align="center">
          Point at the rider's QR or the vehicle sticker
        </Txt>
        <Button label="Cancel" variant="secondary" onPress={() => goBack(router)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dark: { flex: 1, backgroundColor: "#000" },
  overlay: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", gap: space.xl, padding: space.xl },
  frame: { width: 250, height: 250, borderRadius: radius.xl, borderWidth: 4, borderColor: c.onAccent },
});
