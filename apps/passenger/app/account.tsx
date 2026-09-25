import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
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
import { Card, Chip, Row } from "../src/components/Card";

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
          listTrips(supabase, "passenger_id", id),
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

  const completed = trips.filter((t) => t.state === "completed");
  const spent = completed.reduce((sum, t) => sum + (t.fareRwf ?? 0), 0);

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + tokens.space.md, paddingBottom: insets.bottom + tokens.space.xl },
      ]}
      showsVerticalScrollIndicator={false}
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

      {/* Two figures rather than a list of trips to count. Both are the
          passenger's own money, which is the only thing this screen is for. */}
      <Card style={styles.gap}>
        <View style={styles.statRow}>
          <View style={styles.flex}>
            <Text style={styles.statLabel}>Trips taken</Text>
            <Text style={styles.statValue}>{loading ? "—" : completed.length}</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.flex}>
            <Text style={styles.statLabel}>Spent</Text>
            <View style={styles.statValueRow}>
              <Text style={styles.statValue}>{loading ? "—" : money(spent)}</Text>
              <Text style={styles.statUnit}>RWF</Text>
            </View>
          </View>
        </View>
      </Card>

      <Card style={[styles.gap, styles.rowList]}>
        <Row
          icon="card-outline"
          label="How you pay"
          onPress={() => router.push("/payment")}
        />
        <View style={styles.hairline} />
        <Row
          icon="shield-checkmark-outline"
          tone="good"
          label="Help and safety"
          onPress={() => router.push("/help")}
        />
      </Card>

      {places.length > 0 ? (
        <>
          <Text style={styles.section}>Saved places</Text>
          <Card style={styles.rowList}>
            {places.map((pl, i) => (
              <View key={pl.id}>
                {i > 0 ? <View style={styles.hairline} /> : null}
                <View style={styles.place}>
                  <View style={styles.well}>
                    <Ionicons name="bookmark-outline" size={17} color={theme.accent} />
                  </View>
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
                    <Ionicons name="close" size={18} color={theme.textMuted} />
                  </Pressable>
                </View>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      <Text style={styles.section}>Your trips</Text>

      {loading ? (
        <ActivityIndicator style={styles.spin} color={theme.accent} />
      ) : trips.length === 0 ? (
        <EmptyState
          icon="map-outline"
          title="No trips yet"
          body="Your first ride will show up here, with what you paid and who drove you."
        />
      ) : (
        trips.map((t) => {
          const status = statusFor(t.state);
          return (
            <Card key={t.id} style={styles.trip}>
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
                <Chip
                  label={status.label}
                  tone={
                    status.tone === "success" ? "good" : status.tone === "danger" ? "bad" : "neutral"
                  }
                />
              </View>
            </Card>
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
  content: { paddingHorizontal: tokens.space.lg, paddingBottom: tokens.space.xxl },
  flex: { flex: 1 },
  gap: { marginTop: tokens.space.md },
  header: { flexDirection: "row", alignItems: "center", gap: tokens.space.md },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: tokens.radius.pill,
    backgroundColor: theme.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: tokens.type.title.size,
    fontWeight: "700",
    color: theme.accent,
  },
  name: {
    fontSize: tokens.type.title.size,
    fontWeight: "700",
    color: theme.textStrong,
  },
  phone: { fontSize: tokens.type.body.size, color: theme.textMuted },
  statRow: { flexDirection: "row", alignItems: "flex-start" },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: "stretch",
    backgroundColor: theme.border,
    marginHorizontal: tokens.space.sm,
  },
  statLabel: {
    fontSize: tokens.type.label.size,
    fontWeight: "600",
    color: theme.textMuted,
  },
  statValueRow: { flexDirection: "row", alignItems: "baseline" },
  statValue: {
    marginTop: 2,
    fontSize: tokens.type.stat.size,
    fontWeight: "700",
    color: theme.textStrong,
    letterSpacing: -0.5,
  },
  statUnit: {
    marginLeft: 4,
    fontSize: tokens.type.body.size,
    fontWeight: "600",
    color: theme.textMuted,
  },
  rowList: { paddingVertical: tokens.space.xs },
  hairline: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.border,
    marginLeft: 30 + tokens.space.sm,
  },
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
    gap: tokens.space.sm,
    minHeight: tokens.MIN_TOUCH_TARGET,
  },
  well: {
    width: 30,
    height: 30,
    borderRadius: tokens.radius.sm,
    backgroundColor: theme.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  placeLabel: { fontSize: tokens.type.body.size, fontWeight: "600", color: theme.textStrong },
  placeNote: { fontSize: tokens.type.label.size, color: theme.textMuted },
  remove: {
    width: tokens.MIN_TOUCH_TARGET,
    minHeight: tokens.MIN_TOUCH_TARGET,
    alignItems: "center",
    justifyContent: "center",
  },
  spin: { marginTop: tokens.space.lg },
  trip: { marginBottom: tokens.space.sm },
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
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: tokens.space.sm,
    paddingTop: tokens.space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.border,
  },
  tripMeta: { fontSize: tokens.type.label.size, color: theme.textMuted },
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
