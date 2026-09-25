import { useEffect, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { goBack } from "../../src/lib/nav";
import { Ionicons } from "@expo/vector-icons";
import { Banner, Button, Divider, Group, Screen, Stat, StatRow, Txt, c, money, notify, space, tap } from "@gera/kit";
import { VEHICLE_CONDITIONS, type VehicleCondition } from "@gera/core";
import { endShift, getOpenShift, type Shift, type ShiftSummary } from "@gera/data";
import { supabase } from "../../src/lib/supabase";
import { useSession } from "../../src/lib/session";
import * as loc from "../../src/lib/location";
import { duration } from "../../src/today/useNow";

/**
 * NOVA §25: at the end of a shift the system records the time, place, the
 * vehicle's condition and anything worth handing over. Then it tells the rider
 * the one number they need on the way to the depot: the cash to hand in.
 */
export default function EndShift() {
  const router = useRouter();
  const { riderId } = useSession();
  const [shift, setShift] = useState<Shift | null>(null);
  const [condition, setCondition] = useState<VehicleCondition>("good");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ShiftSummary | null>(null);

  useEffect(() => {
    if (!riderId) return;
    getOpenShift(supabase, riderId).then(setShift).catch(() => {});
  }, [riderId]);

  // A problem nobody describes is a problem the mechanic has to find again.
  const needsNotes = condition !== "good" && notes.trim().length < 3;

  const end = async () => {
    setBusy(true);
    setError(null);
    try {
      const at = await loc.getCurrent();
      setSummary(await endShift(supabase, condition, notes, at));
      notify("success");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not end the shift.");
    } finally {
      setBusy(false);
    }
  };

  if (summary) {
    const hours = duration(summary.startedAt, new Date(summary.endedAt).getTime());
    return (
      <Screen
        title="Shift ended"
        subtitle={`${hours} on the road. Ride home safe.`}
        footer={<Button label="Done" onPress={() => goBack(router)} />}
      >
        <View style={styles.stack}>
          <View style={styles.card}>
            <StatRow>
              <Stat label="Trips" value={String(summary.trips)} big />
              <Stat label="You earned" value={money(summary.earnedRwf)} unit="RWF" tone="good" big />
            </StatRow>
          </View>
          <View style={[styles.card, styles.handIn]}>
            <Txt v="label" tone="muted">
              Hand in at the depot
            </Txt>
            <View style={styles.row}>
              <Txt v="display" tabularNums>
                {money(summary.cashHeldRwf)}
              </Txt>
              <Txt v="heading" tone="muted">
                RWF
              </Txt>
            </View>
            <Txt v="label" tone="muted">
              Everything you're carrying for the company, including earlier shifts you haven't handed in.
            </Txt>
          </View>
          {condition === "needs_repair" ? (
            <Banner tone="warn" icon="construct">
              The fleet office has your repair report. Don't take this vehicle out again until it's checked.
            </Banner>
          ) : null}
        </View>
      </Screen>
    );
  }

  return (
    <Screen
      title="End your shift"
      subtitle={shift ? `On shift for ${duration(shift.startedAt)}` : undefined}
      onBack={() => goBack(router)}
      footer={
        <View style={styles.footer}>
          {error ? <Banner tone="bad" icon="alert-circle">{error}</Banner> : null}
          <Button label="End shift" icon="flag" variant="dark" onPress={end} loading={busy} disabled={!shift || needsNotes} />
        </View>
      }
    >
      <View style={styles.stack}>
        <Group title="How is the vehicle?">
          {VEHICLE_CONDITIONS.map((k, i) => {
            const on = condition === k.key;
            return (
              <View key={k.key}>
                {i > 0 ? <Divider inset={space.md + 28 + space.md} /> : null}
                <Pressable
                  onPress={() => {
                    tap();
                    setCondition(k.key);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  style={({ pressed }) => [styles.option, pressed && styles.pressed]}
                >
                  <View style={[styles.radio, on && styles.radioOn]}>
                    {on ? <View style={styles.radioDot} /> : null}
                  </View>
                  <View style={styles.flex}>
                    <Txt v="bodyStrong">{k.label}</Txt>
                    <Txt v="label" tone="muted">
                      {k.hint}
                    </Txt>
                  </View>
                  {k.key === "needs_repair" ? <Ionicons name="construct" size={18} color={c.warning} /> : null}
                </Pressable>
              </View>
            );
          })}
        </Group>

        <View>
          <Txt v="label" tone="muted" style={styles.inputLabel}>
            {condition === "good" ? "Anything to hand over? (optional)" : "What's wrong?"}
          </Txt>
          <TextInput
            style={styles.input}
            value={notes}
            onChangeText={setNotes}
            placeholder={condition === "good" ? "Low on fuel, left helmet at the depot…" : "Rear brake soft, left indicator out…"}
            placeholderTextColor={c.textMuted}
            multiline
          />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  stack: { gap: space.lg },
  footer: { gap: space.sm },
  card: { backgroundColor: c.surfaceRaised, borderRadius: 20, padding: space.md, gap: space.sm },
  handIn: { borderLeftWidth: 4, borderLeftColor: c.warning },
  row: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  option: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, minHeight: 64 },
  pressed: { backgroundColor: c.surfaceHigh },
  radio: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: c.border,
    alignItems: "center",
    justifyContent: "center",
  },
  radioOn: { borderColor: c.accent },
  radioDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: c.accent },
  inputLabel: { marginBottom: space.sm, marginLeft: space.xs },
  input: {
    minHeight: 96,
    borderRadius: 16,
    backgroundColor: c.surfaceRaised,
    padding: space.md,
    fontSize: 16,
    color: c.textStrong,
    textAlignVertical: "top",
  },
});
