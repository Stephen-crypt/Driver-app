import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  Button,
  Divider,
  EmptyState,
  Field,
  Group,
  Odometer,
  Press,
  Row,
  Screen,
  SkeletonRows,
  Txt,
  c,
  radius,
  shadow,
  space,
  useOverlay,
} from "@nova/kit";
import { myStaffRole } from "@nova/data";
import { supabase } from "../../src/lib/supabase";

interface Recent {
  id: string;
  created_at: string;
  inspector_name: string | null;
  rider_name: string | null;
  plate: string | null;
  result: "pass" | "advisory" | "fail";
  alcohol_result: string | null;
}

const RESULT = { pass: ["Passed", "good"], advisory: ["Advisory", "warn"], fail: ["Failed", "bad"] } as const;

/** NOVA §30: an inspector's day is scan, check, record, next. */
export default function InspectHome() {
  const router = useRouter();
  const overlay = useOverlay();
  const [name, setName] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [recent, setRecent] = useState<Recent[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        const staff = await myStaffRole(supabase);
        if (!active) return;
        if (!staff) return router.replace("/welcome");
        setName(staff.name);
        const { data } = await supabase.rpc("staff_inspections", { p_limit: 30 });
        if (active) setRecent(((data ?? []) as Recent[]).filter((r) => r.inspector_name === staff.name).slice(0, 8));
      })();
      return () => {
        active = false;
      };
    }, [router]),
  );

  const today = (recent ?? []).filter((r) => new Date(r.created_at).toDateString() === new Date().toDateString()).length;
  const lookUp = () => code.trim() && router.push({ pathname: "/inspect/check", params: { code: code.trim() } });

  const signOut = async () => {
    const ok = await overlay.confirm({ title: "Sign out?", confirmLabel: "Sign out", cancelLabel: "Stay", tone: "danger" });
    if (!ok) return;
    await supabase.auth.signOut();
    router.replace("/welcome");
  };

  return (
    <Screen title={name ? `Muraho, ${name}` : "Inspections"} gap={space.lg}>
      <View key="today" style={styles.today}>
        <Odometer value={String(today)} v="display" />
        <Txt v="label" tone="muted">
          {today === 1 ? "inspection" : "inspections"} today
        </Txt>
      </View>

      <Press key="scan" onPress={() => router.push("/inspect/scan")} style={styles.scan} accessibilityRole="button" accessibilityLabel="Scan a QR code">
        <View style={styles.scanIcon}>
          <Ionicons name="scan" size={30} color={c.onAccent} />
        </View>
        <View style={styles.flex}>
          <Txt v="h2" tone="inverse">
            Scan a QR code
          </Txt>
          <Txt v="label" tone="inverse" style={styles.soft}>
            The rider's phone or the vehicle sticker
          </Txt>
        </View>
        <Ionicons name="chevron-forward" size={22} color={c.onAccent} />
      </Press>

      <View key="manual" style={styles.manual}>
        <Field
          label="Or type a vest number or plate"
          value={code}
          onChangeText={setCode}
          autoCapitalize="characters"
          placeholder="214 or RAD 123 B"
          returnKeyType="search"
          onSubmitEditing={lookUp}
        />
        <Button label="Look up" variant="secondary" disabled={code.trim().length < 1} onPress={lookUp} />
      </View>

      <Group key="recent" title="Your recent inspections">
        {recent === null ? (
          <SkeletonRows count={2} />
        ) : recent.length === 0 ? (
          <EmptyState compact icon="clipboard" title="None yet" body="Inspections you record show here." />
        ) : (
          recent.map((r, i) => (
            <View key={r.id}>
              {i > 0 ? <Divider inset={space.md + 38 + space.md} /> : null}
              <Row
                title={r.rider_name ?? r.plate ?? "Vehicle"}
                subtitle={[
                  new Date(r.created_at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
                  r.plate && r.rider_name ? r.plate : null,
                  r.alcohol_result ? `alcohol ${r.alcohol_result}` : null,
                ]
                  .filter(Boolean)
                  .join(", ")}
                icon={r.result === "pass" ? "checkmark-circle" : r.result === "fail" ? "close-circle" : "alert-circle"}
                iconTone={RESULT[r.result][1]}
                value={RESULT[r.result][0]}
                valueTone={RESULT[r.result][1]}
              />
            </View>
          ))
        )}
      </Group>

      <Button key="out" label="Sign out" variant="quiet" onPress={() => void signOut()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  today: { flexDirection: "row", alignItems: "baseline", gap: space.sm },
  scan: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: c.accentDeep,
    ...shadow.float,
  },
  scanIcon: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.14)",
    alignItems: "center",
    justifyContent: "center",
  },
  soft: { opacity: 0.8 },
  manual: { gap: space.sm },
});
