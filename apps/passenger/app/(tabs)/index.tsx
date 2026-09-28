import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Banner,
  Chip,
  Enter,
  NovaMap,
  LiveDot,
  Paper,
  Press,
  Segmented,
  Txt,
  c,
  font,
  radius,
  space,
  tap,
  useSettledHeight,
} from "@nova/kit";
import {
  getActivePassengerTrip,
  listUpcoming,
  whenLabel,
  type UpcomingRide,
  listSavedPlaces,
  listTrips,
  nearestLandmark,
  pickupLabelFor,
  registerDeviceToken,
  type SavedPlace,
  type TripSnapshot,
} from "@nova/data";
import { supabase } from "../../src/lib/supabase";
import { registerForPush } from "../../src/lib/push";
import * as loc from "../../src/lib/location";
import { useSession } from "../../src/lib/session";

/**
 * Kinyarwanda first, because it is what people say to each other. Mwaramutse
 * until noon, Mwiriwe after.
 */
function greeting(now = new Date()): string {
  return now.getHours() < 12 ? "Mwaramutse" : "Mwiriwe";
}

const LIVE_COPY: Record<string, string> = {
  requested: "Finding you a rider",
  offered: "Finding you a rider",
  accepted: "Your rider is on the way",
  arrived: "Your rider is here",
  in_progress: "You're on your way",
};

type Mode = "now" | "later" | "regular";

const MODES = [
  { value: "now", label: "Ride now" },
  { value: "later", label: "Schedule" },
  { value: "regular", label: "Regular" },
] as const;

const PROMPT: Record<Mode, string> = {
  now: "Where to?",
  later: "Where, and when?",
  regular: "Your regular trip",
};

function placeIcon(label: string): "home" | "briefcase" | "bookmark" {
  return /home|urugo/i.test(label) ? "home" : /work|office|akazi/i.test(label) ? "briefcase" : "bookmark";
}

export default function Home() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { userId } = useSession();
  const [name, setName] = useState<string | null>(null);
  const [here, setHere] = useState<loc.Coords | null>(null);
  const [pickupLabel, setPickupLabel] = useState<string | null>(null);
  const [gpsDenied, setGpsDenied] = useState(false);
  const [saved, setSaved] = useState<SavedPlace[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [live, setLive] = useState<TripSnapshot | null>(null);
  const [paperH, onPaperLayout] = useSettledHeight(320);
  // NOVA §7: three ways to book, and only three - "later" and "prebook" are
  // the same idea and a fourth button would only confuse.
  const [mode, setMode] = useState<Mode>("now");
  const [next, setNext] = useState<UpcomingRide | null>(null);

  // Where the passenger actually is. The pickup used to be a constant -
  // Kimironko Market for everyone - which sent every rider to the same place.
  useEffect(() => {
    let active = true;
    (async () => {
      if (!(await loc.requestPermission())) {
        if (active) setGpsDenied(true);
        return;
      }
      const at = await loc.getCurrent(8000);
      if (!active || !at) return;
      setHere(at);
      try {
        setPickupLabel(pickupLabelFor(await nearestLandmark(supabase, at)));
      } catch {
        setPickupLabel("Current location");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      let active = true;
      (async () => {
        const [profile, places, history, trip, upcoming] = await Promise.all([
          supabase.from("profiles").select("first_name").eq("id", userId).maybeSingle(),
          listSavedPlaces(supabase, userId).catch(() => [] as SavedPlace[]),
          listTrips(supabase, "passenger_id", userId, 20).catch(() => []),
          getActivePassengerTrip(supabase, userId).catch(() => null),
          listUpcoming(supabase, userId).catch(() => [] as UpcomingRide[]),
        ]);
        if (!active) return;
        setNext(upcoming[0] ?? null);
        setName((profile.data as { first_name?: string } | null)?.first_name ?? null);
        setSaved(places);
        setLive(trip);
        // Recent destinations, most recent first, each once, none already saved.
        const seen = new Set<string>(places.map((p) => p.label));
        setRecent(
          history
            .filter((t) => t.state === "completed")
            .map((t) => t.dropoffLabel)
            .filter((l) => (seen.has(l) ? false : (seen.add(l), true)))
            .slice(0, 4),
        );
      })();
      return () => {
        active = false;
      };
    }, [userId]),
  );

  useEffect(() => {
    if (!userId) return;
    let active = true;
    (async () => {
      const result = await registerForPush();
      if (!active || !result.ok) return;
      registerDeviceToken(supabase, userId, result.token, "android").catch(() => {});
    })();
    return () => {
      active = false;
    };
  }, [userId]);

  const pickupParams = {
    ...(here ? { plat: String(here.lat), plng: String(here.lng) } : {}),
    ...(pickupLabel ? { plabel: pickupLabel } : {}),
  };

  const go = (params: Record<string, string> = {}) => {
    tap();
    router.push({ pathname: "/destination", params: { ...pickupParams, mode, ...params } });
  };

  const choose = (p: SavedPlace) =>
    router.push({
      pathname: "/ride",
      params: {
        lat: String(p.lat),
        lng: String(p.lng),
        label: p.label,
        ...(p.note ? { note: p.note } : {}),
        ...pickupParams,
        mode,
      },
    });

  const hasPlaces = saved.length > 0 || recent.length > 0;

  return (
    <View style={styles.root}>
      <NovaMap
        center={here ?? loc.KIGALI_FALLBACK}
        markers={here ? [{ id: "me", at: here, kind: "me" }] : []}
        topInset={insets.top}
        bottomInset={paperH}
      />

      <View style={styles.sheet} onLayout={onPaperLayout}>
        <Paper padBottom={false}>
          <View style={styles.stack}>
            {live ? (
              <Enter i={0}>
                <Press
                  onPress={() => router.push({ pathname: "/ride", params: { trip: live.id } })}
                  accessibilityRole="button"
                  accessibilityLabel={`${LIVE_COPY[live.state] ?? "Your trip"}, to ${live.dropoffLabel}`}
                  style={styles.live}
                >
                  <LiveDot tone="good" size={9} />
                  <View style={styles.flex}>
                    <Txt v="bodyStrong" tone="inverse">
                      {LIVE_COPY[live.state] ?? "Your trip"}
                    </Txt>
                    <Txt v="label" tone="inverse" lines={1} style={styles.liveSub}>
                      To {live.dropoffLabel}
                    </Txt>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={c.onAccent} />
                </Press>
              </Enter>
            ) : null}

            <Enter i={1} style={styles.greetingRow}>
              <Txt v="h2">
                {greeting()}
                {name ? `, ${name}` : ""}
              </Txt>
            </Enter>

            <Enter i={2}>
              <Segmented label="How to book" options={MODES} value={mode} onChange={setMode} />
            </Enter>

            {/* The home screen's whole job, drawn the way every route in Nova is
                drawn: a ring where you are, a square where you are going. The
                square is the question. */}
            <Enter i={3}>
              <Press onPress={() => go()} scaleTo={0.985} accessibilityRole="button" accessibilityLabel={PROMPT[mode]} style={styles.search}>
                <View style={styles.rail} pointerEvents="none">
                  <View style={styles.ring} />
                  <View style={styles.railLine} />
                  <View style={styles.square} />
                </View>
                <View style={styles.flex}>
                  <View style={styles.pickupLine}>
                    <Txt v="caption" tone="muted">
                      Pickup
                    </Txt>
                    <Txt v="label" tone="strong" lines={1}>
                      {pickupLabel ?? (gpsDenied ? "Location is off" : "Finding where you are…")}
                    </Txt>
                  </View>
                  <View style={styles.searchLine}>
                    <Txt v="title" style={styles.searchText} lines={1}>
                      {PROMPT[mode]}
                    </Txt>
                    <View style={styles.searchIcon}>
                      <Ionicons name="search" size={20} color={c.onAccent} />
                    </View>
                  </View>
                </View>
              </Press>
            </Enter>

            {gpsDenied ? (
              <Banner tone="warn" icon="location">
                Turn on location so your rider comes to where you are.
              </Banner>
            ) : null}

            {next ? (
              <Enter i={4}>
                <Press onPress={() => router.push("/activity")} scaleTo={0.985} style={styles.next} accessibilityRole="button" accessibilityLabel={`Next ride ${whenLabel(next.scheduledFor)} to ${next.dropoffLabel}`}>
                  <View style={styles.nextIcon}>
                    <Ionicons name={next.scheduleId ? "repeat" : "calendar"} size={17} color={c.accent} />
                  </View>
                  <View style={styles.flex}>
                    <Txt v="bodyStrong" lines={1}>
                      {whenLabel(next.scheduledFor)}
                    </Txt>
                    <Txt v="label" tone="muted" lines={1}>
                      To {next.dropoffLabel}
                    </Txt>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
                </Press>
              </Enter>
            ) : null}

            {hasPlaces ? (
              <Enter i={5}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                  {saved.map((p) => (
                    <Chip key={p.id} label={p.label} icon={placeIcon(p.label)} tone="accent" onPress={() => choose(p)} />
                  ))}
                  {recent.map((r) => (
                    <Chip key={r} label={r} icon="time-outline" onPress={() => go({ q: r })} />
                  ))}
                </ScrollView>
              </Enter>
            ) : (
              <Enter i={5} style={styles.promise}>
                <Ionicons name="pricetag" size={15} color={c.accent} />
                <Txt v="label" tone="muted" style={styles.flex}>
                  Motos and cabs, at a price you agree before you go.
                </Txt>
              </Enter>
            )}
          </View>
        </Paper>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  root: { flex: 1, backgroundColor: c.surface },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0 },
  stack: { gap: space.md },
  greetingRow: { paddingHorizontal: 2 },
  search: {
    flexDirection: "row",
    gap: space.md,
    paddingLeft: space.md,
    paddingRight: space.sm,
    paddingVertical: space.md,
    borderRadius: radius.lg,
    backgroundColor: c.surfaceHigh,
  },
  rail: { width: 14, alignItems: "center", paddingTop: 16, paddingBottom: 21 },
  ring: { width: 12, height: 12, borderRadius: 6, borderWidth: 3, borderColor: c.textStrong, backgroundColor: c.surfaceHigh },
  railLine: { flex: 1, width: 2, borderRadius: 1, backgroundColor: c.border, marginVertical: 3 },
  square: { width: 12, height: 12, borderRadius: 3, backgroundColor: c.destination },
  pickupLine: { gap: 1, paddingBottom: space.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border, marginRight: space.sm },
  searchLine: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingTop: space.sm },
  searchText: { flex: 1, fontFamily: font.numBold, fontSize: 30, lineHeight: 36 },
  searchIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: c.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  chips: { gap: space.sm, paddingRight: space.md },
  next: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingVertical: space.sm + 2,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
  },
  nextIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: c.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  promise: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: 2 },
  live: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: c.accentDeep,
  },
  liveSub: { opacity: 0.85 },
});
