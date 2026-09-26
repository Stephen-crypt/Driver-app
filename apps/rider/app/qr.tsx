import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import QRCode from "react-native-qrcode-svg";
import { Screen, Txt, VestPatch, c, radius, space } from "@gera/kit";
import { getRiderProfile, myRiderQr } from "@gera/data";
import { supabase } from "../src/lib/supabase";
import { useSession } from "../src/lib/session";
import { goBack } from "../src/lib/nav";

/**
 * NOVA §31. The inspector scans this; it opens the rider's record on their
 * phone, not anything on this one. Turn the brightness up in the sun.
 */
export default function MyQr() {
  const router = useRouter();
  const { riderId } = useSession();
  const [code, setCode] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [vest, setVest] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!riderId) return;
    myRiderQr(supabase).then(setCode).catch(() => setError(true));
    getRiderProfile(supabase, riderId)
      .then((p) => {
        setName(p.firstName);
        setVest(p.vehicle?.vestNumber ?? null);
      })
      .catch(() => {});
  }, [riderId]);

  return (
    <Screen title="My QR code" onBack={() => goBack(router)}>
      <View style={styles.card}>
        {code ? (
          <View style={styles.qr} accessible accessibilityLabel="Your Gera rider QR code">
            <QRCode value={code} size={240} color={c.textStrong} backgroundColor="#ffffff" ecl="M" />
          </View>
        ) : error ? (
          <Txt v="body" tone="bad">
            Couldn't load your code. Check your connection.
          </Txt>
        ) : (
          <ActivityIndicator color={c.accent} style={styles.loading} />
        )}
        <View style={styles.who}>
          {vest ? <VestPatch value={vest} size="sm" /> : null}
          <Txt v="title">{name ?? " "}</Txt>
        </View>
      </View>
      <Txt v="body" tone="muted" align="center" style={styles.note}>
        Show this to a Gera inspector when they ask. It only works on their inspection app, and only shows them your Gera record.
      </Txt>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { alignItems: "center", backgroundColor: "#ffffff", borderRadius: radius.xl, padding: space.xl, gap: space.lg, marginTop: space.md },
  qr: { padding: space.sm, backgroundColor: "#ffffff" },
  loading: { height: 256 },
  who: { flexDirection: "row", alignItems: "center", gap: space.md },
  note: { marginTop: space.lg, paddingHorizontal: space.md },
});
