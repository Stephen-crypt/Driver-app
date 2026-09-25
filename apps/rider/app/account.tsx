import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { lightTheme, tokens } from "@gera/ui";
import { listTrips, type TripHistoryItem } from "@gera/data";
import { supabase } from "../src/lib/supabase";

const money = (rwf: number) => rwf.toLocaleString("en-US");

// Riders read outcomes, not schema - the same rule the trip sheet follows.
const OUTCOME: Record<string, string> = {
  completed: "Completed",
  cancelled_by_rider: "You cancelled",
  cancelled_by_driver: "Driver cancelled",
  no_drivers: "No drivers found",
  expired: "Timed out",
};

function when(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) +
    " · " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export default function Account() {
  const router = useRouter();
  const [name, setName] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [trips, setTrips] = useState<TripHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase.auth.getUser();
      const id = data.user?.id;
      if (!id || !active) {
        if (active) setLoading(false);
        return;
      }
      setPhone(data.user?.phone ?? null);
      try {
        const [profile, history] = await Promise.all([
          supabase.from("profiles").select("first_name").eq("id", id).maybeSingle(),
          listTrips(supabase, "rider_id", id),
        ]);
        if (!active) return;
        setName((profile.data as { first_name?: string } | null)?.first_name ?? null);
        setTrips(history);
      } catch {
        // An account screen that fails to load history is still an account
        // screen. Nothing here is load-bearing for booking.
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(name ?? "?").trim().charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.flex}>
          <Text style={styles.name}>{name ?? "Your account"}</Text>
          {phone ? <Text style={styles.phone}>{phone}</Text> : null}
        </View>
      </View>

      <Pressable style={styles.link} onPress={() => router.push("/payment")}>
        <Text style={styles.linkLabel}>How you pay</Text>
        <Text style={styles.linkChevron}>›</Text>
      </Pressable>

      <Text style={styles.section}>Your trips</Text>

      {loading ? (
        <ActivityIndicator style={styles.spin} color={lightTheme.accent} />
      ) : trips.length === 0 ? (
        <Text style={styles.empty}>No trips yet. Your first one will show up here.</Text>
      ) : (
        trips.map((t) => (
          <View key={t.id} style={styles.trip}>
            <View style={styles.flex}>
              <Text style={styles.tripRoute} numberOfLines={1}>
                {t.pickupLabel} → {t.dropoffLabel}
              </Text>
              <Text style={styles.tripMeta}>
                {when(t.createdAt)} · {OUTCOME[t.state] ?? "In progress"}
              </Text>
            </View>
            {t.fareRwf !== null && t.state === "completed" ? (
              <Text style={styles.tripFare}>{money(t.fareRwf)}</Text>
            ) : null}
          </View>
        ))
      )}

      <Pressable
        style={styles.signOut}
        onPress={async () => {
          await supabase.auth.signOut();
          router.replace("/");
        }}
        accessibilityRole="button"
      >
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: lightTheme.surface },
  content: { padding: tokens.space.lg, paddingBottom: tokens.space.xxl },
  flex: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: tokens.space.md },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: tokens.radius.pill,
    backgroundColor: lightTheme.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: tokens.type.title.size,
    fontWeight: "700",
    color: lightTheme.onAccent,
  },
  name: {
    fontSize: tokens.type.title.size,
    fontWeight: "700",
    color: lightTheme.textStrong,
  },
  phone: { fontSize: tokens.type.body.size, color: lightTheme.textMuted },
  link: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: tokens.MIN_TOUCH_TARGET,
    marginTop: tokens.space.lg,
    paddingHorizontal: tokens.space.md,
    borderRadius: tokens.radius.md,
    backgroundColor: lightTheme.surfaceRaised,
  },
  linkLabel: {
    flex: 1,
    fontSize: tokens.type.body.size,
    fontWeight: "600",
    color: lightTheme.textStrong,
  },
  linkChevron: { fontSize: tokens.type.title.size, color: lightTheme.textMuted },
  section: {
    marginTop: tokens.space.xl,
    marginBottom: tokens.space.sm,
    fontSize: tokens.type.label.size,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: lightTheme.textMuted,
  },
  spin: { marginTop: tokens.space.lg },
  empty: { fontSize: tokens.type.body.size, color: lightTheme.textMuted },
  trip: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: tokens.space.md,
    paddingHorizontal: tokens.space.md,
    marginBottom: tokens.space.sm,
    borderRadius: tokens.radius.md,
    backgroundColor: lightTheme.surfaceRaised,
  },
  tripRoute: {
    fontSize: tokens.type.body.size,
    fontWeight: "600",
    color: lightTheme.textStrong,
  },
  tripMeta: { fontSize: tokens.type.label.size, color: lightTheme.textMuted },
  tripFare: {
    fontSize: tokens.type.body.size,
    fontWeight: "700",
    color: lightTheme.textStrong,
  },
  signOut: {
    marginTop: tokens.space.xxl,
    minHeight: tokens.MIN_TOUCH_TARGET,
    alignItems: "center",
    justifyContent: "center",
  },
  signOutText: { fontSize: tokens.type.body.size, color: lightTheme.danger },
});
