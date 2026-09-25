import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { goBack } from "../../src/lib/nav";
import { Ionicons } from "@expo/vector-icons";
import { Banner, Button, Divider, Group, Screen, Txt, VestPatch, c, notify, space, tap } from "@gera/kit";
import { SHIFT_CHECKS } from "@gera/core";
import { getRiderProfile, startShift, type RiderProfile } from "@gera/data";
import { supabase } from "../../src/lib/supabase";
import { useSession } from "../../src/lib/session";
import * as loc from "../../src/lib/location";

const CLASS_NAME: Record<string, string> = { moto: "Moto", cab: "Cab", cab_xl: "Cab XL" };

/**
 * NOVA §25. Each check is ticked on its own. There is deliberately no "tick
 * all": a checklist with a shortcut is a checklist nobody reads, and the one
 * morning the brakes are soft is the morning it mattered.
 */
export default function StartShift() {
  const router = useRouter();
  const { riderId } = useSession();
  const [profile, setProfile] = useState<RiderProfile | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!riderId) return;
    getRiderProfile(supabase, riderId).then(setProfile).catch(() => {});
  }, [riderId]);

  const done = SHIFT_CHECKS.filter((k) => checked[k.key]).length;
  const all = done === SHIFT_CHECKS.length;

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const at = await loc.getCurrent();
      await startShift(supabase, checked, at);
      notify("success");
      goBack(router);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the shift.");
    } finally {
      setBusy(false);
    }
  };

  const v = profile?.vehicle;

  return (
    <Screen
      title="Before you ride"
      subtitle="Check each one. If something fails, report it instead of riding."
      onBack={() => goBack(router)}
      footer={
        <View style={styles.footer}>
          {error ? <Banner tone="bad" icon="alert-circle">{error}</Banner> : null}
          <Button
            label={all ? "Start shift" : `${SHIFT_CHECKS.length - done} checks to go`}
            icon={all ? "shield-checkmark" : undefined}
            onPress={start}
            disabled={!all}
            loading={busy}
          />
          <Button label="Something failed — report it" variant="quiet" onPress={() => router.replace("/report")} compact />
        </View>
      }
    >
      {v ? (
        <View style={styles.vehicle}>
          {v.vestNumber ? <VestPatch value={v.vestNumber} size="lg" /> : null}
          <View>
            <Txt v="figure">{v.plate}</Txt>
            <Txt v="label" tone="muted">
              {CLASS_NAME[v.vehicleClass] ?? "Vehicle"} · company vehicle
            </Txt>
          </View>
        </View>
      ) : null}

      <Group>
        {SHIFT_CHECKS.map((k, i) => {
          const on = !!checked[k.key];
          return (
            <View key={k.key}>
              {i > 0 ? <Divider inset={space.md + 32 + space.md} /> : null}
              <Pressable
                onPress={() => {
                  tap();
                  setChecked((prev) => ({ ...prev, [k.key]: !prev[k.key] }));
                }}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                style={({ pressed }) => [styles.check, pressed && styles.pressed]}
              >
                <View style={[styles.box, on && styles.boxOn]}>
                  {on ? <Ionicons name="checkmark" size={20} color={c.onAccent} /> : null}
                </View>
                <View style={styles.flex}>
                  <Txt v="bodyStrong">{k.label}</Txt>
                  <Txt v="label" tone="muted">
                    {k.hint}
                  </Txt>
                </View>
              </Pressable>
            </View>
          );
        })}
      </Group>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  vehicle: { flexDirection: "row", alignItems: "center", gap: space.md, marginBottom: space.lg },
  check: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, minHeight: 68 },
  pressed: { backgroundColor: c.surfaceHigh },
  box: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: c.border,
    alignItems: "center",
    justifyContent: "center",
  },
  boxOn: { backgroundColor: c.success, borderColor: c.success },
  footer: { gap: space.sm },
});
