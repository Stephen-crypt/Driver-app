import { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Banner, Button, Group, Screen, SkeletonRows, SuccessMark, Txt, notify, space, useOverlay } from "@gera/kit";
import {
  addDays,
  cancelSchedule,
  changeSchedule,
  dateLabel,
  daysLabel,
  kigaliToday,
  listSchedules,
  timeSlots,
  type RecurringSchedule,
} from "@gera/data";
import { supabase } from "../src/lib/supabase";
import { useSession } from "../src/lib/session";
import { goBack } from "../src/lib/nav";
import { Pill, Times, Weekdays } from "../src/ride/When";

/**
 * NOVA §12: change a regular trip from now on - days, time, how long it runs -
 * or stop it. A ride the passenger has already moved by hand keeps its time.
 */
export default function ChangeRegular() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId } = useSession();
  const overlay = useOverlay();
  const [s, setS] = useState<RecurringSchedule | null>(null);
  const [days, setDays] = useState<number[]>([]);
  const [time, setTime] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    listSchedules(supabase, userId)
      .then((all) => {
        const found = all.find((x) => x.id === id) ?? null;
        setS(found);
        if (found) {
          setDays(found.days);
          setTime(found.timeOfDay);
          setEnd(found.endDate);
        }
      })
      .catch(() => setError("Couldn't load this regular trip."));
  }, [userId, id]);

  const today = kigaliToday();
  const slots = useMemo(() => timeSlots(addDays(today, 1)), [today]);
  // End dates to choose from: as booked, a little sooner, or longer.
  const ends = useMemo(() => {
    if (!s) return [];
    const opts = [addDays(today, 6), s.endDate, addDays(s.endDate, 14), addDays(s.endDate, 28)];
    return [...new Set(opts)].filter((d) => d >= today).sort();
  }, [s, today]);

  const changed = s && (time !== s.timeOfDay || end !== s.endDate || days.join() !== s.days.join());

  const save = async () => {
    if (!s || !time || !end) return;
    setBusy(true);
    setError(null);
    try {
      const r = await changeSchedule(supabase, s.id, { days, time, endDate: end });
      notify("success");
      const parts = [
        r.moved ? `${r.moved} ${r.moved === 1 ? "ride" : "rides"} moved to ${time}` : null,
        r.cancelled ? `${r.cancelled} cancelled` : null,
        r.added ? `${r.added} added` : null,
      ].filter(Boolean);
      setResult(parts.length ? `${parts.join(", ")}.` : "Saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the change.");
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    const ok = await overlay.confirm({
      title: "Stop this regular trip?",
      message: "Every ride still to come is cancelled. Rides already on their way are not affected.",
      confirmLabel: "Stop it",
      cancelLabel: "Keep it",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await cancelSchedule(supabase, id);
      overlay.toast({ message: "Regular trip stopped", tone: "good" });
      goBack(router);
    } catch {
      setError("Couldn't cancel it.");
    }
  };

  if (result) {
    return (
      <Screen footer={<Button label="Done" onPress={() => goBack(router)} />}>
        <View style={styles.done}>
          <SuccessMark size={64} />
          <Txt v="title">Regular trip changed</Txt>
          <Txt v="body" tone="muted">
            {result}
          </Txt>
          <Txt v="bodyStrong">
            {daysLabel(days)} at {time}, until {end ? dateLabel(end) : ""}.
          </Txt>
        </View>
      </Screen>
    );
  }

  if (!s) {
    return (
      <Screen onBack={() => goBack(router)}>
        {error ? <Banner tone="bad" icon="alert-circle">{error}</Banner> : <SkeletonRows count={3} />}
      </Screen>
    );
  }

  return (
    <Screen
      title="Change regular trip"
      subtitle={`${s.pickupLabel} to ${s.dropoffLabel}`}
      onBack={() => goBack(router)}
      footer={
        <View style={styles.footer}>
          {error ? (
            <Banner tone="bad" icon="alert-circle">
              {error}
            </Banner>
          ) : null}
          <Button label="Save changes" onPress={save} loading={busy} disabled={!changed || days.length === 0 || !time} />
        </View>
      }
    >
      <View style={styles.stack}>
        <Group title="Days">
          <View style={styles.pad}>
            <Weekdays days={days} onChange={setDays} />
          </View>
        </Group>
        <Group title="Time">
          <View style={styles.pad}>
            <Times slots={slots} time={time} onTime={setTime} />
          </View>
        </Group>
        <Group title="Runs until">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
            {ends.map((d) => (
              <Pill key={d} label={dateLabel(d)} on={end === d} onPress={() => setEnd(d)} wide />
            ))}
          </ScrollView>
        </Group>
        <Txt v="label" tone="muted">
          Changes apply to rides from now on. Rides you moved one by one keep their time, and rides already on their way aren't affected. The price stays {s.amountRwf.toLocaleString("en-US")} RWF a ride.
        </Txt>
        <Button label="Stop this regular trip" variant="danger" onPress={() => void stop()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg, paddingBottom: space.lg },
  footer: { gap: space.sm },
  pad: { padding: space.md },
  row: { gap: space.sm, padding: space.md },
  done: { gap: space.sm, paddingTop: space.xl },
});
