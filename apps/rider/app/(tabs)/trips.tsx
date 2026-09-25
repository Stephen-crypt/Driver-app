import { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Divider, Group, Row, Screen, Txt, c, money, space } from "@gera/kit";
import { statusFor } from "@gera/ui";
import { listTrips, type TripHistoryItem } from "@gera/data";
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

export default function Trips() {
  const { riderId } = useSession();
  const [trips, setTrips] = useState<TripHistoryItem[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!riderId) return;
      let active = true;
      listTrips(supabase, "rider_id", riderId, 60)
        .then((t) => active && setTrips(t))
        .catch(() => active && setTrips([]));
      return () => {
        active = false;
      };
    }, [riderId]),
  );

  // Grouped by day: a rider thinks about their work in shifts, not as one
  // endless list.
  const groups: { day: string; items: TripHistoryItem[] }[] = [];
  for (const t of trips ?? []) {
    const k = dayKey(t.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.day === k) last.items.push(t);
    else groups.push({ day: k, items: [t] });
  }

  return (
    <Screen title="Trips">
      {trips === null ? (
        <ActivityIndicator color={c.accent} />
      ) : trips.length === 0 ? (
        <View style={styles.empty}>
          <Txt v="heading">No trips yet</Txt>
          <Txt v="body" tone="muted">
            Start a shift and go online. Every trip you take lands here.
          </Txt>
        </View>
      ) : (
        <View style={styles.stack}>
          {groups.map((g) => (
            <Group key={g.day} title={g.day}>
              {g.items.map((t, i) => {
                const s = statusFor(t.state);
                const done = t.state === "completed";
                return (
                  <View key={t.id}>
                    {i > 0 ? <Divider inset={space.md + 38 + space.md} /> : null}
                    <Row
                      title={`${t.pickupLabel} → ${t.dropoffLabel}`}
                      subtitle={`${new Date(t.createdAt).toLocaleTimeString(undefined, {
                        hour: "2-digit",
                        minute: "2-digit",
                      })} · ${s.label}`}
                      icon={done ? "checkmark" : s.tone === "danger" ? "close" : "time-outline"}
                      iconTone={done ? "good" : s.tone === "danger" ? "bad" : "neutral"}
                      value={done && t.fareRwf !== null ? money(t.fareRwf) : undefined}
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
  empty: { gap: space.xs, paddingVertical: space.xl },
});
