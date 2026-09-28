import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { goBack } from "../../src/lib/nav";
import {
  Banner,
  Button,
  ChoiceRow,
  Divider,
  Enter,
  Group,
  ImigongoBand,
  Odometer,
  Screen,
  SuccessMark,
  TextArea,
  Txt,
  c,
  money,
  notify,
  radius,
  space,
} from "@gera/kit";
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
      <Screen footer={<Button label="Done" onPress={() => goBack(router)} />} gap={space.lg}>
        <View key="head" style={styles.done}>
          <SuccessMark size={64} />
          <Txt v="title">Shift ended</Txt>
          <Txt v="body" tone="muted">
            {hours} on the road. Ride home safe.
          </Txt>
        </View>

        <View key="stats" style={styles.stats}>
          <View style={styles.statCard}>
            <Txt v="label" tone="muted">
              Trips
            </Txt>
            <Odometer value={String(summary.trips)} v="display" delay={200} />
          </View>
          <View style={styles.statCard}>
            <Txt v="label" tone="muted">
              You earned
            </Txt>
            <View style={styles.figure}>
              <Odometer value={money(summary.earnedRwf)} v="display" tone="good" delay={320} />
              <Txt v="label" tone="muted">
                RWF
              </Txt>
            </View>
          </View>
        </View>

        <View key="handin">
          <View style={styles.handIn}>
            <View style={styles.handHead}>
              <Ionicons name="cash" size={20} color={c.warning} />
              <Txt v="bodyStrong">Hand in at the depot</Txt>
            </View>
            <View style={styles.figure}>
              <Odometer value={money(summary.cashHeldRwf)} v="hero" delay={440} accessibilityLabel={`${money(summary.cashHeldRwf)} Rwandan francs`} />
              <Txt v="heading" tone="muted">
                RWF
              </Txt>
            </View>
            <Txt v="label" tone="muted">
              Everything you're carrying for the company, including earlier shifts you haven't handed in.
            </Txt>
            <ImigongoBand height={18} opacity={0.14} colour={c.warning} style={styles.band} />
          </View>
        </View>

        {condition === "needs_repair" ? (
          <Enter key="repair" i={3}>
            <Banner tone="warn" icon="construct">
              The fleet office has your repair report. Don't take this vehicle out again until it's checked.
            </Banner>
          </Enter>
        ) : null}
      </Screen>
    );
  }

  return (
    <Screen
      title="End your shift"
      subtitle={shift ? `On shift for ${duration(shift.startedAt)}` : undefined}
      onBack={() => goBack(router)}
      gap={space.lg}
      footer={
        <View style={styles.footer}>
          {error ? <Banner tone="bad" icon="alert-circle">{error}</Banner> : null}
          <Button label="End shift" icon="flag" variant="dark" onPress={end} loading={busy} disabled={!shift || needsNotes} />
        </View>
      }
    >
      <Group key="condition" title="How is the vehicle?">
        {VEHICLE_CONDITIONS.map((k, i) => (
          <View key={k.key}>
            {i > 0 ? <Divider inset={space.md + 26 + space.md} /> : null}
            <ChoiceRow
              kind="radio"
              on={condition === k.key}
              onPress={() => setCondition(k.key)}
              title={k.label}
              hint={k.hint}
              trailing={k.key === "needs_repair" ? <Ionicons name="construct" size={18} color={c.warning} /> : undefined}
            />
          </View>
        ))}
      </Group>

      <View key="notes" style={styles.notes}>
        <Txt v="label" tone="muted" style={styles.inputLabel}>
          {condition === "good" ? "Anything to hand over? (optional)" : "What's wrong?"}
        </Txt>
        <TextArea
          value={notes}
          onChangeText={setNotes}
          placeholder={condition === "good" ? "Low on fuel, left helmet at the depot…" : "Rear brake soft, left indicator out…"}
          minHeight={104}
          maxLength={500}
          accessibilityLabel={condition === "good" ? "Anything to hand over" : "What's wrong with the vehicle"}
        />
        {needsNotes ? (
          <Txt v="caption" tone="warn">
            Say what's wrong so the mechanic doesn't have to find it again.
          </Txt>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  footer: { gap: space.sm },
  done: { alignItems: "flex-start", gap: space.sm, paddingTop: space.xl },
  stats: { flexDirection: "row", gap: space.sm },
  statCard: { flex: 1, gap: 2, padding: space.md, borderRadius: radius.lg, backgroundColor: c.surfaceRaised },
  figure: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  handIn: {
    gap: space.xs,
    paddingTop: space.md,
    paddingHorizontal: space.md,
    borderRadius: radius.lg,
    backgroundColor: c.surfaceRaised,
    overflow: "hidden",
  },
  handHead: { flexDirection: "row", alignItems: "center", gap: space.sm },
  band: { marginTop: space.sm, marginHorizontal: -space.md },
  notes: { gap: space.sm },
  inputLabel: { marginLeft: space.xs },
});
