import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { goBack } from "../../src/lib/nav";
import { Banner, Button, ChoiceRow, Divider, Group, Screen, Txt, VehicleTile, VestPatch, c, ease, notify, radius, space, useOverlay } from "@gera/kit";
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
  const overlay = useOverlay();
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
      overlay.toast({ message: "Shift started. Go online when you're ready.", tone: "good", icon: "shield-checkmark" });
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
      gap={space.lg}
      footer={
        <View style={styles.footer}>
          {error ? <Banner tone="bad" icon="alert-circle">{error}</Banner> : null}
          <Button
            label={all ? "Start shift" : `${SHIFT_CHECKS.length - done} ${SHIFT_CHECKS.length - done === 1 ? "check" : "checks"} to go`}
            icon={all ? "shield-checkmark" : undefined}
            onPress={start}
            disabled={!all}
            loading={busy}
          />
          <Button label="Something failed? Report it" variant="quiet" onPress={() => router.replace("/report")} compact />
        </View>
      }
    >
      {v ? (
        <View key="vehicle" style={styles.vehicle}>
          <VehicleTile kind={v.vehicleClass} size={52} onGrey />
          <View style={styles.flex}>
            <Txt v="figure">{v.plate}</Txt>
            <Txt v="label" tone="muted">
              {CLASS_NAME[v.vehicleClass] ?? "Vehicle"}, company vehicle
            </Txt>
          </View>
          {v.vestNumber ? <VestPatch value={v.vestNumber} size="md" /> : null}
        </View>
      ) : null}

      <View key="meter" style={styles.meter}>
        <View style={styles.meterHead}>
          <Txt v="label" tone="muted">
            Safety checks
          </Txt>
          <Txt v="label" tone={all ? "good" : "strong"} tabularNums>
            {done} of {SHIFT_CHECKS.length}
          </Txt>
        </View>
        <Meter value={done / SHIFT_CHECKS.length} done={all} />
      </View>

      <Group key="checks">
        {SHIFT_CHECKS.map((k, i) => (
          <View key={k.key}>
            {i > 0 ? <Divider inset={space.md + 30 + space.md} /> : null}
            <ChoiceRow
              kind="check"
              on={!!checked[k.key]}
              onPress={() => setChecked((prev) => ({ ...prev, [k.key]: !prev[k.key] }))}
              title={k.label}
              hint={k.hint}
            />
          </View>
        ))}
      </Group>
    </Screen>
  );
}

/** How much of the checklist is done, filling as boxes are ticked. */
function Meter({ value, done }: { readonly value: number; readonly done: boolean }) {
  const w = useSharedValue(0);
  const p = useSharedValue(value);
  useEffect(() => {
    p.set(withTiming(value, { duration: 320, easing: ease.out }));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const fill = useAnimatedStyle(() => ({ transform: [{ translateX: -(1 - p.get()) * w.get() }] }));
  return (
    <View style={styles.track} onLayout={(e) => w.set(e.nativeEvent.layout.width)} accessibilityElementsHidden>
      <Animated.View style={[StyleSheet.absoluteFill, styles.fill, { backgroundColor: done ? c.success : c.accent }, fill]} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  vehicle: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: c.surfaceRaised,
  },
  meter: { gap: space.sm },
  meterHead: { flexDirection: "row", justifyContent: "space-between" },
  track: { height: 6, borderRadius: 3, backgroundColor: c.surfaceHigh, overflow: "hidden" },
  fill: { borderRadius: 3 },
  footer: { gap: space.sm },
});
