import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme, tokens, ROUTE_DOT, railGeometry, statusFor } from "@gera/ui";
import {
  listTrips,
  listSavedPlaces,
  deleteSavedPlace,
  type TripHistoryItem,
  type SavedPlace,
} from "@gera/data";
import { supabase } from "../src/lib/supabase";
import { EmptyState } from "../src/components/EmptyState";

const money = (rwf: number) => rwf.toLocaleString("en-US");

function when(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) +
    " · " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export default function Account() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [trips, setTrips] = useState<TripHistoryItem[]>([]);
  const [places, setPlaces] = useState<SavedPlace[]>([]);
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
        const [profile, history, saved] = await Promise.all([
          supabase.from("profiles").select("first_name").eq("id", id).maybeSingle(),
          listTrips(supabase, "rider_id", id),
          listSavedPlaces(supabase, id),
        ]);
        if (!active) return;
        setName((profile.data as { first_name?: string } | null)?.first_name ?? null);
        setTrips(history);
        setPlaces(saved);
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
    <ScrollView
      style={styles.root}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + tokens.space.md, paddingBottom: insets.bottom + tokens.space.xl },
      ]}
    >
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

      <Pressable style={styles.link} onPress={() => router.push("/help")}>
        <Text style={styles.linkLabel}>Help and safety</Text>
        <Text style={styles.linkChevron}>›</Text>
      </Pressable>

      {places.length > 0 ? (
        <>
          <Text style={styles.section}>Saved places</Text>
          {places.map((pl) => (
            <View key={pl.id} style={styles.place}>
              <View style={styles.flex}>
                <Text style={styles.placeLabel}>{pl.label}</Text>
                {pl.note ? <Text style={styles.placeNote}>{pl.note}</Text> : null}
              </View>
              {/* Without this a mis-named place was permanent - the first cut
                  saved everything as "Saved place" and there was no way back. */}
              <Pressable
                style={styles.remove}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${pl.label}`}
                onPress={() =>
                  Alert.alert("Remove this place?", pl.label, [
                    { text: "Keep", style: "cancel" },
                    {
                      text: "Remove",
                      style: "destructive",
                      onPress: async () => {
                        try {
                          await deleteSavedPlace(supabase, pl.id);
                          setPlaces((ps) => ps.filter((x) => x.id !== pl.id));
                        } catch {
                          Alert.alert("Could not remove that.");
                        }
                      },
                    },
                  ])
                }
              >
                <Text style={styles.removeText}>Remove</Text>
              </Pressable>
            </View>
          ))}
        </>
      ) : null}

      <Text style={styles.section}>Your trips</Text>

      {loading ? (
        <ActivityIndicator style={styles.spin} color={theme.accent} />
      ) : trips.length === 0 ? (
        <EmptyState
          title="No trips yet"
          body="Your first ride will show up here, with what you paid and who drove you."
        />
      ) : (
        trips.map((t) => {
          const status = statusFor(t.state);
          return (
            <View key={t.id} style={styles.trip}>
              <View style={styles.tripTop}>
                {/* Origin and destination as a joined pair, so the row reads as
                    one journey rather than two lines of text. */}
                <View style={styles.rail}>
                  <View style={[styles.dot, styles.dotOrigin]} />
                  <View style={styles.railLine} />
                  <View style={[styles.dot, styles.dotDestination]} />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.leg} numberOfLines={1}>
                    {t.pickupLabel}
                  </Text>
                  <Text style={[styles.leg, styles.legLast]} numberOfLines={1}>
                    {t.dropoffLabel}
                  </Text>
                </View>
                {t.fareRwf !== null && t.state === "completed" ? (
                  <Text style={styles.tripFare}>{money(t.fareRwf)}</Text>
                ) : null}
              </View>

              <View style={styles.tripFoot}>
                <Text style={styles.tripMeta}>{when(t.createdAt)}</Text>
                <Text
                  style={[
                    styles.tripStatus,
                    status.tone === "success" && styles.statusSuccess,
                    status.tone === "danger" && styles.statusDanger,
                  ]}
                >
                  {status.label}
                </Text>
              </View>
            </View>
          );
        })
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
  root: { flex: 1, backgroundColor: theme.surface },
  content: { padding: tokens.space.lg, paddingBottom: tokens.space.xxl },
  flex: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: tokens.space.md },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: tokens.radius.pill,
    backgroundColor: theme.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: tokens.type.title.size,
    fontWeight: "700",
    color: theme.onAccent,
  },
  name: {
    fontSize: tokens.type.title.size,
    fontWeight: "700",
    color: theme.textStrong,
  },
  phone: { fontSize: tokens.type.body.size, color: theme.textMuted },
  link: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: tokens.MIN_TOUCH_TARGET,
    marginTop: tokens.space.lg,
    paddingHorizontal: tokens.space.md,
    borderRadius: tokens.radius.md,
    backgroundColor: theme.surfaceRaised,
  },
  linkLabel: {
    flex: 1,
    fontSize: tokens.type.body.size,
    fontWeight: "600",
    color: theme.textStrong,
  },
  linkChevron: { fontSize: tokens.type.title.size, color: theme.textMuted },
  section: {
    marginTop: tokens.space.xl,
    marginBottom: tokens.space.sm,
    fontSize: tokens.type.label.size,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: theme.textMuted,
  },
  place: {
    flexDirection: "row",
    alignItems: "center",
    padding: tokens.space.md,
    marginBottom: tokens.space.sm,
    borderRadius: tokens.radius.md,
    backgroundColor: theme.surfaceRaised,
  },
  placeLabel: { fontSize: tokens.type.body.size, fontWeight: "700", color: theme.textStrong },
  placeNote: { fontSize: tokens.type.label.size, color: theme.textMuted },
  remove: {
    minHeight: tokens.MIN_TOUCH_TARGET,
    paddingHorizontal: tokens.space.md,
    justifyContent: "center",
  },
  removeText: { fontSize: tokens.type.label.size, fontWeight: "700", color: theme.danger },
  spin: { marginTop: tokens.space.lg },
  empty: { fontSize: tokens.type.body.size, color: theme.textMuted },
  trip: {
    padding: tokens.space.md,
    marginBottom: tokens.space.sm,
    borderRadius: tokens.radius.lg,
    backgroundColor: theme.surfaceRaised,
  },
  tripTop: { flexDirection: "row", alignItems: "center" },
  rail: { width: ROUTE_DOT.size, alignItems: "center", marginRight: tokens.space.md },
  dot: {
    width: ROUTE_DOT.size,
    height: ROUTE_DOT.size,
    borderRadius: tokens.radius.pill,
  },
  dotOrigin: { backgroundColor: theme.origin },
  dotDestination: { backgroundColor: theme.destination },
  railLine: {
    width: ROUTE_DOT.railWidth,
    height: railGeometry().height,
    backgroundColor: theme.border,
  },
  leg: {
    fontSize: tokens.type.body.size,
    fontWeight: "600",
    color: theme.textStrong,
    height: ROUTE_DOT.size + ROUTE_DOT.gap / 2,
  },
  legLast: { height: undefined },
  tripFoot: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: tokens.space.sm,
    paddingTop: tokens.space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.border,
  },
  tripMeta: { fontSize: tokens.type.label.size, color: theme.textMuted },
  tripStatus: { fontSize: tokens.type.label.size, fontWeight: "700", color: theme.textMuted },
  statusSuccess: { color: theme.success },
  statusDanger: { color: theme.danger },
  tripFare: {
    fontSize: tokens.type.title.size,
    fontWeight: "700",
    color: theme.textStrong,
  },
  signOut: {
    marginTop: tokens.space.xxl,
    minHeight: tokens.MIN_TOUCH_TARGET,
    alignItems: "center",
    justifyContent: "center",
  },
  signOutText: { fontSize: tokens.type.body.size, color: theme.danger },
});
