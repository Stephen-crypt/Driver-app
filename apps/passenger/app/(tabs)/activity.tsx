import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import {
  Button,
  Divider,
  EmptyState,
  Group,
  Odometer,
  Row,
  Screen,
  Segmented,
  SkeletonRows,
  Txt,
  c,
  money,
  space,
  useOverlay,
} from "@nova/kit";
import { statusFor } from "@nova/ui";
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
} from "@nova/data";
import { supabase } from "../../src/lib/supabase";
import { useSession } from "../../src/lib/session";
import { TripCard } from "../../src/activity/TripCard";
import { useLightStatusBar } from "../../src/lib/statusBar";

function dayKey(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}

const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export default function Activity() {
  useLightStatusBar();
  const router = useRouter();
  const overlay = useOverlay();
  const { userId } = useSession();
  const [trips, setTrips] = useState<TripHistoryItem[] | null>(null);
  const [upcoming, setUpcoming] = useState<UpcomingRide[]>([]);
  const [schedules, setSchedules] = useState<RecurringSchedule[]>([]);
  const [reload, setReload] = useState(0);
  const [tab, setTab] = useState<"upcoming" | "past" | null>(null);

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
          label: "See the ticket",
          hint: "Reference, QR code and the price",
          icon: "qr-code",
          onPress: () => router.push({ pathname: "/trip/[id]", params: { id: r.id } }),
        },
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
  const booked = upcoming.length + schedules.length;

  // Open on what is coming, when anything is; otherwise on what has been.
  useEffect(() => {
    if (tab === null && trips !== null) setTab(booked > 0 ? "upcoming" : "past");
  }, [trips, booked, tab]);
  const showing = tab ?? "past";

  const hero =
    trips !== null && !nothing ? (
      <View style={styles.hero}>
        <View style={styles.figures}>
          <View style={styles.figure}>
            <Odometer value={String(completed.length)} v="display" tone="onHero" />
            <Txt v="label" tone="onHeroMuted">
              {completed.length === 1 ? "trip taken" : "trips taken"}
            </Txt>
          </View>
          <View style={styles.rule} />
          <View style={styles.figure}>
            <View style={styles.money}>
              <Odometer value={money(spent)} v="display" tone="onHero" />
              <Txt v="label" tone="onHeroMuted">
                RWF
              </Txt>
            </View>
            <Txt v="label" tone="onHeroMuted">
              spent on rides
            </Txt>
          </View>
        </View>
        <Segmented
          onHero
          label="Which trips"
          value={showing}
          onChange={setTab}
          options={[
            { value: "upcoming", label: booked > 0 ? `Upcoming (${booked})` : "Upcoming" },
            { value: "past", label: "Past" },
          ]}
        />
      </View>
    ) : null;

  return (
    <Screen title="Your trips" brand hero={hero} gap={space.lg}>
      {trips === null ? (
        <SkeletonRows count={5} />
      ) : nothing ? (
        <EmptyState
          icon="navigate"
          art={require("../../assets/empty-trips.png")}
          title="No trips yet"
          body="Your rides will show up here, with what you paid and who took you."
          action={{ label: "Book a ride", onPress: () => router.push("/") }}
        />
      ) : (
        <View style={styles.stack}>
          {showing === "upcoming" && booked === 0 ? (
            <View style={styles.none}>
              <Txt v="section">Nothing booked</Txt>
              <Txt v="body" tone="muted">
                Book a ride for later, or set up a trip you take every week. The price is fixed when you book.
              </Txt>
              <Button label="Book ahead" icon="calendar" variant="highlight" onPress={() => router.push({ pathname: "/destination", params: { mode: "later" } })} />
            </View>
          ) : null}

          {showing === "upcoming" && schedules.length > 0 ? (
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

          {showing === "upcoming" && upcoming.length > 0 ? (
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

          {showing === "past" && groups.length === 0 ? (
            <View style={styles.none}>
              <Txt v="section">No trips taken yet</Txt>
              <Txt v="body" tone="muted">
                Your rides will show up here, with what you paid and who took you.
              </Txt>
            </View>
          ) : null}

          {(showing === "past" ? groups : []).map((g) => (
            <View key={g.day} style={styles.day}>
              <Txt v="section" style={styles.dayTitle}>
                {g.day}
              </Txt>
              {g.items.map((t) => (
                <TripCard
                  key={t.id}
                  trip={t}
                  onOpen={() =>
                    isTripLive(t.state)
                      ? router.push({ pathname: "/ride", params: { trip: t.id } })
                      : router.push({ pathname: "/trip/[id]", params: { id: t.id } })
                  }
                  onAgain={() => router.push({ pathname: "/destination", params: { q: t.dropoffLabel } })}
                />
              ))}
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  hero: { gap: space.lg },
  figures: { flexDirection: "row", alignItems: "flex-end", gap: space.lg },
  figure: { gap: 2 },
  money: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  rule: { width: 1, alignSelf: "stretch", backgroundColor: c.heroRaised },
  none: { gap: space.sm, paddingTop: space.sm },
  day: { gap: space.sm + 2 },
  dayTitle: { paddingHorizontal: 2 },
});
