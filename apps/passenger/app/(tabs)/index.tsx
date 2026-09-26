import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Banner, Chip, GeraMap, Paper, Txt, c, font, radius, space, tap } from "@gera/kit";
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
} from "@gera/data";
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

const shadowSoft = {
  shadowColor: "#0B0D12",
  shadowOpacity: 0.08,
  shadowRadius: 4,
  shadowOffset: { width: 0, height: 1 },
  elevation: 2,
} as const;

const LIVE_COPY: Record<string, string> = {
  requested: "Finding you a rider",
  offered: "Finding you a rider",
  accepted: "Your rider is on the way",
  arrived: "Your rider is here",
  in_progress: "You're on your way",
};

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
  const [paperH, setPaperH] = useState(300);
  // NOVA §7: three ways to book, and only three - "later" and "prebook" are
  // the same idea and a fourth button would only confuse.
  const [mode, setMode] = useState<"now" | "later" | "regular">("now");
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
        setNext(upcoming[0] ?? null);
        if (!active) return;
        setName((profile.data as { first_name?: string } | null)?.first_name ?? null);
        setSaved(places);
        setLive(trip);
        // Recent destinations, most recent first, each once.
        const seen = new Set<string>();
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

  const go = (params: Record<string, string> = {}) => {
    tap();
    router.push({
      pathname: "/destination",
      params: {
        ...(here ? { plat: String(here.lat), plng: String(here.lng) } : {}),
        ...(pickupLabel ? { plabel: pickupLabel } : {}),
        mode,
        ...params,
      },
    });
  };

  const choose = (p: SavedPlace) =>
    router.push({
      pathname: "/ride",
      params: {
        lat: String(p.lat),
        lng: String(p.lng),
        label: p.label,
        ...(p.note ? { note: p.note } : {}),
        ...(here ? { plat: String(here.lat), plng: String(here.lng) } : {}),
        ...(pickupLabel ? { plabel: pickupLabel } : {}),
        mode,
      },
    });

  return (
    <View style={styles.root}>
      <GeraMap
        center={here ?? loc.KIGALI_FALLBACK}
        markers={here ? [{ id: "me", at: here, kind: "me" }] : []}
        topInset={insets.top}
        bottomInset={paperH}
      />

      <View style={styles.sheet} onLayout={(e) => setPaperH(e.nativeEvent.layout.height)}>
        <Paper padBottom={false}>
          <View style={styles.stack}>
            {live ? (
              <Pressable
                onPress={() => router.push({ pathname: "/ride", params: { trip: live.id } })}
                accessibilityRole="button"
                style={styles.live}
              >
                <View style={styles.liveDot} />
                <View style={styles.flex}>
                  <Txt v="bodyStrong" tone="inverse">
                    {LIVE_COPY[live.state] ?? "Your trip"}
                  </Txt>
                  <Txt v="label" tone="inverse" lines={1} style={styles.liveSub}>
                    To {live.dropoffLabel}
                  </Txt>
                </View>
                <Ionicons name="chevron-forward" size={20} color={c.onAccent} />
              </Pressable>
            ) : null}

            <Txt v="label" tone="muted">
              {greeting()}
              {name ? `, ${name}` : ""}
            </Txt>

            <View style={styles.modes} accessibilityRole="radiogroup">
              {(
                [
                  ["now", "Ride now"],
                  ["later", "Schedule"],
                  ["regular", "Regular"],
                ] as const
              ).map(([k, l]) => (
                <Pressable
                  key={k}
                  onPress={() => {
                    tap();
                    setMode(k);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: mode === k }}
                  style={[styles.mode, mode === k && styles.modeOn]}
                >
                  <Txt v="label" tone={mode === k ? "strong" : "muted"}>
                    {l}
                  </Txt>
                </Pressable>
              ))}
            </View>

            {/* The whole of the home screen's job. Set in the condensed face at
                title size: it is a question, and it should read like one. */}
            <Pressable
              onPress={() => go()}
              accessibilityRole="button"
              accessibilityLabel="Where to?"
              style={({ pressed }) => [styles.search, pressed && styles.pressed]}
            >
              <Ionicons name="search" size={22} color={c.textStrong} />
              <Txt v="title" style={styles.searchText}>
                {mode === "now" ? "Where to?" : mode === "later" ? "Where, and when?" : "Your regular trip"}
              </Txt>
            </Pressable>

            <View style={styles.pickup}>
              <View style={styles.pickupDot} />
              <Txt v="label" tone="muted" lines={1} style={styles.flex}>
                Pickup ·{" "}
                <Txt v="label" tone="strong">
                  {pickupLabel ?? (gpsDenied ? "Location is off" : "Finding you…")}
                </Txt>
              </Txt>
            </View>

            {next ? (
              <Pressable onPress={() => router.push("/activity")} style={styles.next} accessibilityRole="button">
                <Ionicons name="calendar-outline" size={18} color={c.accent} />
                <Txt v="label" lines={1} style={styles.flex}>
                  Next: {whenLabel(next.scheduledFor)} to {next.dropoffLabel}
                </Txt>
                <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
              </Pressable>
            ) : null}

            {gpsDenied ? (
              <Banner tone="warn" icon="location">
                Turn on location so your rider comes to where you are.
              </Banner>
            ) : null}

            {saved.length > 0 || recent.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                {saved.map((p) => (
                  <Pressable key={p.id} onPress={() => choose(p)} style={styles.place} accessibilityRole="button">
                    <Ionicons name={/home/i.test(p.label) ? "home" : /work|office/i.test(p.label) ? "briefcase" : "bookmark"} size={16} color={c.accent} />
                    <Txt v="label" lines={1}>
                      {p.label}
                    </Txt>
                  </Pressable>
                ))}
                {recent.map((r) => (
                  <Pressable key={r} onPress={() => go({ q: r })} style={styles.place} accessibilityRole="button">
                    <Ionicons name="time-outline" size={16} color={c.textMuted} />
                    <Txt v="label" lines={1}>
                      {r}
                    </Txt>
                  </Pressable>
                ))}
              </ScrollView>
            ) : (
              <View style={styles.firstRun}>
                <Chip label="Moto" icon="bicycle" />
                <Chip label="Cab" icon="car" />
                <Chip label="Price agreed before you go" icon="pricetag" tone="accent" />
              </View>
            )}
          </View>
        </Paper>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  root: { flex: 1, backgroundColor: c.surface },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0 },
  stack: { gap: space.md },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    minHeight: 64,
    paddingHorizontal: space.lg,
    borderRadius: radius.lg,
    backgroundColor: c.surfaceHigh,
  },
  searchText: { fontFamily: font.numBold },
  pressed: { opacity: 0.85 },
  pickup: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.xs },
  pickupDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: c.textStrong },
  chips: { gap: space.sm, paddingRight: space.md },
  place: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: 190,
    paddingHorizontal: space.md,
    height: 40,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: c.border,
  },
  modes: {
    flexDirection: "row",
    padding: 4,
    gap: 4,
    borderRadius: radius.pill,
    backgroundColor: c.surfaceHigh,
  },
  mode: { flex: 1, height: 36, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  modeOn: { backgroundColor: c.surfaceRaised, ...shadowSoft },
  next: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: c.accentSoft,
  },
  firstRun: { flexDirection: "row", gap: space.sm, flexWrap: "wrap" },
  live: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: c.accentDeep,
  },
  liveDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: c.onAccent },
  liveSub: { opacity: 0.85 },
});
