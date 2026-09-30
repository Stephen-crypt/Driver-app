import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useFocusEffect } from "expo-router";
import {
  Chip,
  Divider,
  EmptyState,
  Group,
  Row,
  RouteRail,
  Screen,
  SkeletonRows,
  Txt,
  c,
  money,
  space,
  type ChipTone,
} from "@nova/kit";
import { listPlannedRides, listTrips, whenLabel, type PlannedRide, tripTime, type TripHistoryItem } from "@nova/data";
import { supabase } from "../../src/lib/supabase";
import { useSession } from "../../src/lib/session";
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

// Told from the rider's side. The shared labels are the passenger's ("You
// cancelled"), which on this screen would blame the rider for the passenger's
// cancellation.
const STATUS: Record<string, { label: string; tone: ChipTone }> = {
  cancelled_by_passenger: { label: "Passenger cancelled", tone: "neutral" },
  cancelled_by_rider: { label: "You cancelled", tone: "bad" },
  no_show: { label: "Passenger didn't come", tone: "warn" },
  accepted: { label: "In progress", tone: "accent" },
  arrived: { label: "In progress", tone: "accent" },
  in_progress: { label: "In progress", tone: "accent" },
};

export default function Trips() {
  useLightStatusBar();
  const { riderId } = useSession();
  const [trips, setTrips] = useState<TripHistoryItem[] | null>(null);
  const [planned, setPlanned] = useState<PlannedRide[]>([]);

  useFocusEffect(
    useCallback(() => {
      if (!riderId) return;
      let active = true;
      listTrips(supabase, "rider_id", riderId, 60)
        .then((t) => active && setTrips(t))
        .catch(() => active && setTrips([]));
      listPlannedRides(supabase)
        .then((p) => active && setPlanned(p))
        .catch(() => {});
      return () => {
        active = false;
      };
    }, [riderId]),
  );

  // Grouped by day: a rider thinks about their work in shifts, not as one
  // endless list.
  const groups: { day: string; items: TripHistoryItem[] }[] = [];
  for (const t of trips ?? []) {
    const k = dayKey(tripTime(t));
    const last = groups[groups.length - 1];
    if (last && last.day === k) last.items.push(t);
    else groups.push({ day: k, items: [t] });
  }

  // NOVA §13: rides operations has planned for this rider. They still arrive
  // as offers - being planned is not being booked.
  const bookedForYou =
    planned.length > 0 ? (
      <Group key="planned" title="Planned for you">
        {planned.map((p, i) => (
          <View key={p.id}>
            {i > 0 ? <Divider inset={space.md + 38 + space.md} /> : null}
            <Row title={whenLabel(p.scheduledFor)} subtitle={`${p.passengerName}, ${p.pickupLabel} to ${p.dropoffLabel}`} icon="calendar" />
          </View>
        ))}
        <Txt v="caption" tone="muted" style={styles.note}>
          Be online around then: the ride comes to you first as an offer. If you can't take it, it goes to another rider.
        </Txt>
      </Group>
    ) : null;

  return (
    <Screen
      title="Trips"
      brand
      gap={space.lg}
      hero={
        trips && trips.length > 0 ? (
          <View style={styles.figures}>
            <View>
              <Txt v="display" tone="onHero" tabularNums>
                {trips.filter((t) => t.state === "completed").length}
              </Txt>
              <Txt v="label" tone="onHeroMuted">
                trips completed
              </Txt>
            </View>
            <View style={styles.rule} />
            <View>
              <View style={styles.money}>
                <Txt v="display" tone="light" tabularNums>
                  {money(trips.filter((t) => t.state === "completed").reduce((sum, t) => sum + (t.fareRwf ?? 0), 0))}
                </Txt>
                <Txt v="label" tone="onHeroMuted">
                  RWF
                </Txt>
              </View>
              <Txt v="label" tone="onHeroMuted">
                in fares collected
              </Txt>
            </View>
          </View>
        ) : undefined
      }
    >
      {bookedForYou}
      {trips === null ? (
        <SkeletonRows key="loading" count={4} />
      ) : trips.length === 0 ? (
        <EmptyState key="empty" icon="navigate" title="No trips yet" body="Start a shift and go online. Every trip you take lands here." />
      ) : (
        groups.map((g) => {
          const done = g.items.filter((t) => t.state === "completed");
          const fares = done.reduce((sum, t) => sum + (t.fareRwf ?? 0), 0);
          return (
            <Group
              key={g.day}
              title={g.day}
              meta={`${done.length} ${done.length === 1 ? "trip" : "trips"}, ${money(fares)} RWF`}
            >
              {g.items.map((t, i) => (
                <View key={t.id}>
                  {i > 0 ? <Divider inset={space.md} /> : null}
                  <TripItem trip={t} />
                </View>
              ))}
            </Group>
          );
        })
      )}
    </Screen>
  );
}

function TripItem({ trip }: { readonly trip: TripHistoryItem }) {
  const time = new Date(tripTime(trip)).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const done = trip.state === "completed";
  const status = STATUS[trip.state] ?? { label: "Ended", tone: "neutral" as ChipTone };
  return (
    <View
      style={styles.item}
      accessible
      accessibilityLabel={`${time}, ${trip.pickupLabel} to ${trip.dropoffLabel}. ${done && trip.fareRwf !== null ? `${money(trip.fareRwf)} Rwandan francs` : status.label}`}
    >
      <Txt v="bodyStrong" tone="muted" tabularNums style={styles.time}>
        {time}
      </Txt>
      <View style={styles.route}>
        <RouteRail dense from={{ label: trip.pickupLabel }} to={{ label: trip.dropoffLabel }} />
      </View>
      <View style={styles.end}>
        {done ? (
          <>
            <Txt v="bodyStrong" tabularNums>
              {trip.fareRwf === null ? "-" : money(trip.fareRwf)}
            </Txt>
            <Txt v="caption" tone="muted">
              RWF
            </Txt>
          </>
        ) : (
          <Chip label={status.label} tone={status.tone} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  figures: { flexDirection: "row", alignItems: "flex-end", gap: space.lg },
  rule: { width: 1, alignSelf: "stretch", backgroundColor: c.heroRaised },
  money: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  note: { paddingHorizontal: space.md, paddingBottom: space.md },
  item: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.md, paddingVertical: space.sm + 2 },
  time: { width: 48 },
  route: { flex: 1, minWidth: 0 },
  end: { alignItems: "flex-end", maxWidth: 120 },
});
