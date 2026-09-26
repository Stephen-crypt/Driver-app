import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Button, Divider, Group, Row, Screen, Txt, c, money, space } from "@gera/kit";
import { statusFor } from "@gera/ui";
import {
  cancelSchedule,
  cancelTrip,
  daysLabel,
  isTripLive,
  listSchedules,
  listTrips,
  listUpcoming,
  skipOccurrence,
  whenLabel,
  type RecurringSchedule,
  type TripHistoryItem,
  type UpcomingRide,
} from "@gera/data";
import { supabase } from "../../src/lib/supabase";
import { useSession } from "../../src/lib/session";

function dayKey(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}

export default function Activity() {
  const router = useRouter();
  const { userId } = useSession();
  const [trips, setTrips] = useState<TripHistoryItem[] | null>(null);
  const [upcoming, setUpcoming] = useState<UpcomingRide[]>([]);
  const [schedules, setSchedules] = useState<RecurringSchedule[]>([]);
  const [reload, setReload] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      let active = true;
      Promise.all([
        // Booked-ahead rides that have not happened are "upcoming", not history.
        listTrips(supabase, "passenger_id", userId, 60).then((t) => t.filter((x) => x.state !== "scheduled")),
        listUpcoming(supabase, userId),
        listSchedules(supabase, userId),
      ])
        .then(([t, u, s]) => {
          if (!active) return;
          setTrips(t);
          setUpcoming(u);
          setSchedules(s);
        })
        .catch(() => active && setTrips([]));
      return () => {
        active = false;
      };
    }, [userId, reload]),
  );

  const refresh = () => setReload((n) => n + 1);

  // NOVA §12: one day can be skipped or cancelled without touching the rest.
  const manage = (r: UpcomingRide) =>
    Alert.alert(`${whenLabel(r.scheduledFor)}`, `To ${r.dropoffLabel}`, [
      { text: "Keep it", style: "cancel" },
      ...(r.scheduleId
        ? [{ text: "Skip this day", onPress: () => void skipOccurrence(supabase, r.id).then(refresh).catch(() => {}) }]
        : []),
      {
        text: r.scheduleId ? "Cancel this ride" : "Cancel ride",
        style: "destructive" as const,
        onPress: () => void cancelTrip(supabase, r.id, "passenger").then(refresh).catch(() => {}),
      },
    ]);

  const stopSchedule = (s: RecurringSchedule) =>
    Alert.alert("Cancel this schedule?", `${daysLabel(s.days)} at ${s.timeOfDay} to ${s.dropoffLabel}. Every ride still to come is cancelled.`, [
      { text: "Keep it", style: "cancel" },
      {
        text: "Cancel schedule",
        style: "destructive",
        onPress: () => void cancelSchedule(supabase, s.id).then(refresh).catch(() => {}),
      },
    ]);

  // NOVA §53, §54: what people come back to a past trip for.
  const aboutTrip = (t: TripHistoryItem) => {
    const report = (kind: "lost_property" | "complaint") =>
      router.push({ pathname: "/report", params: { trip: t.id, to: t.dropoffLabel, kind } });
    Alert.alert(`To ${t.dropoffLabel}`, new Date(t.createdAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }), [
      { text: "I left something behind", onPress: () => report("lost_property") },
      { text: "Report a problem", onPress: () => report("complaint") },
      { text: "Close", style: "cancel" },
    ]);
  };

  const completed = (trips ?? []).filter((t) => t.state === "completed");
  const spent = completed.reduce((s, t) => s + (t.fareRwf ?? 0), 0);

  const groups: { day: string; items: TripHistoryItem[] }[] = [];
  for (const t of trips ?? []) {
    const k = dayKey(t.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.day === k) last.items.push(t);
    else groups.push({ day: k, items: [t] });
  }

  return (
    <Screen title="Activity">
      {trips === null ? (
        <ActivityIndicator color={c.accent} />
      ) : trips.length === 0 && upcoming.length === 0 && schedules.length === 0 ? (
        <View style={styles.empty}>
          <Txt v="heading">No trips yet</Txt>
          <Txt v="body" tone="muted">
            Your rides will show up here, with what you paid and who took you.
          </Txt>
          <Button label="Book a ride" onPress={() => router.push("/")} />
        </View>
      ) : (
        <View style={styles.stack}>
          {schedules.length > 0 ? (
            <Group title="Regular trips">
              {schedules.map((s, i) => (
                <View key={s.id}>
                  {i > 0 ? <Divider inset={70} /> : null}
                  <Row
                    title={`${daysLabel(s.days)} at ${s.timeOfDay}`}
                    subtitle={`To ${s.dropoffLabel} · until ${new Date(`${s.endDate}T12:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short" })} · ${money(s.amountRwf)} RWF`}
                    icon="repeat"
                    trailing={
                      <Pressable onPress={() => stopSchedule(s)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Cancel schedule">
                        <Txt v="label" tone="bad">
                          Cancel
                        </Txt>
                      </Pressable>
                    }
                  />
                </View>
              ))}
            </Group>
          ) : null}

          {upcoming.length > 0 ? (
            <Group title="Upcoming">
              {upcoming.map((r, i) => (
                <View key={r.id}>
                  {i > 0 ? <Divider inset={70} /> : null}
                  <Row
                    title={whenLabel(r.scheduledFor)}
                    subtitle={`To ${r.dropoffLabel}${r.scheduleId ? " · regular" : ""}`}
                    icon={r.scheduleId ? "repeat" : "calendar"}
                    value={r.fareRwf !== null ? money(r.fareRwf) : undefined}
                    onPress={() => manage(r)}
                  />
                </View>
              ))}
            </Group>
          ) : null}

          {trips.length > 0 ? (
          <View style={styles.summary}>
            <View style={styles.cell}>
              <Txt v="display" tabularNums>
                {completed.length}
              </Txt>
              <Txt v="label" tone="muted">
                {completed.length === 1 ? "trip taken" : "trips taken"}
              </Txt>
            </View>
            <View style={styles.cell}>
              <Txt v="display" tabularNums>
                {money(spent)}
              </Txt>
              <Txt v="label" tone="muted">
                RWF spent
              </Txt>
            </View>
          </View>
          ) : null}

          {groups.map((g) => (
            <Group key={g.day} title={g.day}>
              {g.items.map((t, i) => {
                const s = statusFor(t.state);
                const done = t.state === "completed";
                const going = isTripLive(t.state);
                return (
                  <View key={t.id}>
                    {i > 0 ? <Divider inset={70} /> : null}
                    <Row
                      title={t.dropoffLabel}
                      subtitle={`From ${t.pickupLabel} · ${new Date(t.createdAt).toLocaleTimeString(undefined, {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}${done ? "" : ` · ${s.label}`}`}
                      icon={going ? "navigate" : done ? "checkmark" : "close"}
                      iconTone={going ? "accent" : done ? "good" : "neutral"}
                      value={done && t.fareRwf !== null ? money(t.fareRwf) : undefined}
                      onPress={
                        going
                          ? () => router.push({ pathname: "/ride", params: { trip: t.id } })
                          : () => aboutTrip(t)
                      }
                    />
                  </View>
                );
              })}
            </Group>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  empty: { gap: space.md, paddingVertical: space.xl },
  summary: { flexDirection: "row", gap: space.md },
  cell: { flex: 1, backgroundColor: c.surfaceRaised, borderRadius: 20, padding: space.md },
});
