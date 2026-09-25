import { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Button, Divider, Group, Row, Screen, Txt, c, money, space } from "@gera/kit";
import { statusFor } from "@gera/ui";
import { isTripLive, listTrips, type TripHistoryItem } from "@gera/data";
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

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      let active = true;
      listTrips(supabase, "passenger_id", userId, 60)
        .then((t) => active && setTrips(t))
        .catch(() => active && setTrips([]));
      return () => {
        active = false;
      };
    }, [userId]),
  );

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
      ) : trips.length === 0 ? (
        <View style={styles.empty}>
          <Txt v="heading">No trips yet</Txt>
          <Txt v="body" tone="muted">
            Your rides will show up here, with what you paid and who took you.
          </Txt>
          <Button label="Book a ride" onPress={() => router.push("/")} />
        </View>
      ) : (
        <View style={styles.stack}>
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
                      onPress={going ? () => router.push({ pathname: "/ride", params: { trip: t.id } }) : undefined}
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
