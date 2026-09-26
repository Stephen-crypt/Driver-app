import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Button, Divider, Field, Group, Row, Screen, Txt, space } from "@gera/kit";
import { myStaffRole } from "@gera/data";
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
  const [name, setName] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [recent, setRecent] = useState<Recent[]>([]);

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

  const today = recent.filter((r) => new Date(r.created_at).toDateString() === new Date().toDateString()).length;

  return (
    <Screen title={name ? `Muraho, ${name}` : "Inspections"} subtitle={`${today} ${today === 1 ? "inspection" : "inspections"} today`}>
      <View style={styles.stack}>
        <Button label="Scan a QR code" icon="qr-code" onPress={() => router.push("/inspect/scan")} />

        <View style={styles.manual}>
          <Field
            label="Or type a vest number or plate"
            value={code}
            onChangeText={setCode}
            autoCapitalize="characters"
            placeholder="e.g. 214 or RAD 123 B"
            onSubmitEditing={() => code.trim() && router.push({ pathname: "/inspect/check", params: { code: code.trim() } })}
          />
          <Button
            label="Look up"
            variant="secondary"
            disabled={code.trim().length < 1}
            onPress={() => router.push({ pathname: "/inspect/check", params: { code: code.trim() } })}
          />
        </View>

        {recent.length > 0 ? (
          <Group title="Your recent inspections">
            {recent.map((r, i) => (
              <View key={r.id}>
                {i > 0 ? <Divider inset={70} /> : null}
                <Row
                  title={r.rider_name ?? r.plate ?? "Vehicle"}
                  subtitle={`${new Date(r.created_at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}${r.plate && r.rider_name ? ` · ${r.plate}` : ""}${r.alcohol_result ? ` · alcohol ${r.alcohol_result}` : ""}`}
                  icon={r.result === "pass" ? "checkmark-circle" : r.result === "fail" ? "close-circle" : "alert-circle"}
                  iconTone={RESULT[r.result][1]}
                  value={RESULT[r.result][0]}
                />
              </View>
            ))}
          </Group>
        ) : null}

        <Button
          label="Sign out"
          variant="quiet"
          onPress={async () => {
            await supabase.auth.signOut();
            router.replace("/welcome");
          }}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  manual: { gap: space.sm },
});
