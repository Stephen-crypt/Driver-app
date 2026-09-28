import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import {
  Divider,
  EmptyState,
  Group,
  Row,
  Screen,
  SkeletonRows,
  Stat,
  StatRow,
  c,
  money,
  radius,
  space,
  useOverlay,
} from "@gera/kit";
import { statusFor } from "@gera/ui";
import {
  cancelTrip,
  daysLabel,
  isTripLive,
  listSchedules,
  listTrips,
  listUpcoming,
  skipOccurrence,
  tripTime,
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

const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

export default function Activity() {
  const router = useRouter();
  const overlay = useOverlay();
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

  // NOVA §12: one day can be moved, skipped or cancelled without touching the rest.
  const manage = (r: UpcomingRide) =>
    overlay.actions({
      title: whenLabel(r.scheduledFor),
      message: `To ${r.dropoffLabel}${r.riderName ? `. ${r.riderName} is planned to take you.` : ""}`,
      options: [
        {
          label: "Change the time",
          hint: "Same day, same price",
          icon: "time",
          onPress: () =>
            router.push({
              pathname: "/change-ride",
              params: { trip: r.id, at: r.scheduledFor, to: r.dropoffLabel, ...(r.scheduleId ? { regular: "1" } : {}) },
            }),
        },
        ...(r.scheduleId
          ? [
              {
                label: "Skip this day",
                hint: "The rest of your regular trip carries on",
                icon: "play-skip-forward" as const,
                onPress: () =>
                  void skipOccurrence(supabase, r.id)
                    .then(() => {
                      overlay.toast({ message: "Skipped. The rest of your rides are unchanged.", tone: "good" });
                      refresh();
                    })
                    .catch(() => overlay.toast({ message: "Couldn't skip that ride. Try again.", tone: "bad" })),
              },
            ]
          : []),
        {
          label: r.scheduleId ? "Cancel this ride" : "Cancel ride",
          icon: "close-circle",
          tone: "danger",
          onPress: () =>
            void cancelTrip(supabase, r.id, "passenger")
              .then(() => {
                overlay.toast({ message: "Ride cancelled. You haven't been charged.", tone: "good" });
                refresh();
              })
              .catch(() => overlay.toast({ message: "Couldn't cancel that ride. Try again.", tone: "bad" })),
        },
      ],
      cancelLabel: "Keep it",
    });

  const completed = (trips ?? []).filter((t) => t.state === "completed");
  const spent = completed.reduce((s, t) => s + (t.fareRwf ?? 0), 0);

  const groups: { day: string; items: TripHistoryItem[] }[] = [];
  for (const t of trips ?? []) {
    const k = dayKey(tripTime(t));
    const last = groups[groups.length - 1];
    if (last && last.day === k) last.items.push(t);
    else groups.push({ day: k, items: [t] });
  }

  const nothing = trips !== null && trips.length === 0 && upcoming.length === 0 && schedules.length === 0;

  return (
    <Screen title="Activity">
      {trips === null ? (
        <SkeletonRows count={5} />
      ) : nothing ? (
        <EmptyState
          icon="navigate"
          title="No trips yet"
          body="Your rides will show up here, with what you paid and who took you."
          action={{ label: "Book a ride", onPress: () => router.push("/") }}
        />
      ) : (
        <View style={styles.stack}>
          {schedules.length > 0 ? (
            <Group title="Regular trips">
              {schedules.map((s, i) => (
                <View key={s.id}>
                  {i > 0 ? <Divider inset={70} /> : null}
                  <Row
                    title={`${daysLabel(s.days)} at ${s.timeOfDay}`}
                    subtitle={`To ${s.dropoffLabel}, until ${new Date(`${s.endDate}T12:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`}
                    icon="repeat"
                    value={money(s.amountRwf)}
                    valueNote="each ride"
                    onPress={() => router.push({ pathname: "/change-regular", params: { id: s.id } })}
                  />
                </View>
              ))}
            </Group>
          ) : null}

          {upcoming.length > 0 ? (
            <Group title="Coming up">
              {upcoming.map((r, i) => (
                <View key={r.id}>
                  {i > 0 ? <Divider inset={70} /> : null}
                  <Row
                    title={whenLabel(r.scheduledFor)}
                    subtitle={
                      r.riderName
                        ? `To ${r.dropoffLabel}\n${r.riderName} planned${r.moved ? ", time changed by you" : ""}`
                        : `To ${r.dropoffLabel}${r.moved ? "\nTime changed by you" : ""}`
                    }
                    icon={r.scheduleId ? "repeat" : "calendar"}
                    value={r.fareRwf !== null ? money(r.fareRwf) : undefined}
                    valueNote={r.fareRwf !== null ? "RWF" : undefined}
                    onPress={() => manage(r)}
                  />
                </View>
              ))}
            </Group>
          ) : null}

          {completed.length > 0 ? (
            <View style={styles.summary}>
              <StatRow>
                <Stat label={completed.length === 1 ? "trip taken" : "trips taken"} value={String(completed.length)} roll />
                <Stat label="RWF spent" value={money(spent)} roll />
              </StatRow>
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
                      subtitle={done ? `From ${t.pickupLabel}` : `${s.label}\nFrom ${t.pickupLabel}`}
                      icon={going ? "navigate" : done ? "checkmark" : "close"}
                      iconTone={going ? "accent" : done ? "good" : "neutral"}
                      value={done && t.fareRwf !== null ? money(t.fareRwf) : undefined}
                      valueNote={time(tripTime(t))}
                      onPress={() =>
                        going
                          ? router.push({ pathname: "/ride", params: { trip: t.id } })
                          : router.push({ pathname: "/trip/[id]", params: { id: t.id } })
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
  summary: { backgroundColor: c.surfaceRaised, borderRadius: radius.lg, padding: space.md },
});
