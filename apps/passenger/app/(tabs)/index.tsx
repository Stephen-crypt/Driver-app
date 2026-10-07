import { useCallback, useEffect, useState } from "react";
import { Image, ScrollView, StyleSheet, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  Avatar,
  Banner,
  BellButton,
  Card,
  Enter,
  Hero,
  IconButton,
  LiveDot,
  MoodRating,
  Press,
  SectionTitle,
  Txt,
  c,
  font,
  radius,
  shadow,
  space,
  tap,
} from "@nova/kit";
import {
  getActivePassengerTrip,
  listUpcoming,
  whenLabel,
  type UpcomingRide,
  listSavedPlaces,
  listTrips,
  describePickup,
  registerDeviceToken,
  ridersNearby,
  pickupMinutes,
  countUnread,
  watchInbox,
  isRated,
  rateTrip,
  type TripHistoryItem,
  type NearbyRiders,
  type SavedPlace,
  type TripSnapshot,
} from "@nova/data";
import { supabase } from "../../src/lib/supabase";
import { registerForPush } from "../../src/lib/push";
import * as loc from "../../src/lib/location";
import { useSession } from "../../src/lib/session";
import { ServiceTiles, type Service } from "../../src/home/ServiceTiles";
import { SafetyCards } from "../../src/home/SafetyCards";
import { useLightStatusBar } from "../../src/lib/statusBar";

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

function placeIcon(label: string): "home" | "briefcase" | "bookmark" {
  return /home|urugo/i.test(label) ? "home" : /work|office|akazi/i.test(label) ? "briefcase" : "bookmark";
}

/** "in 25 min", "in 3 h 10 min"; null a day or more away, where the date says it. */
function countdown(ms: number): string | null {
  if (ms <= 0 || ms >= 86_400_000) return null;
  const m = Math.round(ms / 60_000);
  if (m < 60) return `in ${Math.max(1, m)} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `in ${h} h ${rest} min` : `in ${h} h`;
}

/** How far the search card rides up over the hero's edge. */
const OVERLAP = 40;

export default function Home() {
  useLightStatusBar();
  const router = useRouter();
  const { userId } = useSession();
  const [name, setName] = useState<string | null>(null);
  const [here, setHere] = useState<loc.Coords | null>(null);
  const [pickupLabel, setPickupLabel] = useState<string | null>(null);
  const [gpsDenied, setGpsDenied] = useState(false);
  const [saved, setSaved] = useState<SavedPlace[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [live, setLive] = useState<TripSnapshot | null>(null);
  const [upcoming, setUpcoming] = useState<UpcomingRide[]>([]);
  const [nearby, setNearby] = useState<NearbyRiders[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [toRate, setToRate] = useState<TripHistoryItem | null>(null);
  const [mood, setMood] = useState(0);
  const [thanked, setThanked] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // A countdown reads in minutes; once a minute is often enough.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  // The number on the bell: read on focus, and again whenever one lands.
  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      let active = true;
      const read = () => countUnread(supabase).then((n) => active && setUnread(n)).catch(() => {});
      read();
      const w = watchInbox(supabase, userId, read);
      return () => {
        active = false;
        w.unsubscribe();
      };
    }, [userId]),
  );

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
      const label = await describePickup(supabase, at);
      if (active) setPickupLabel(label);
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
        const [profile, places, history, trip, next] = await Promise.all([
          supabase.from("profiles").select("first_name").eq("id", userId).maybeSingle(),
          listSavedPlaces(supabase, userId).catch(() => [] as SavedPlace[]),
          listTrips(supabase, "passenger_id", userId, 20).catch(() => []),
          getActivePassengerTrip(supabase, userId).catch(() => null),
          listUpcoming(supabase, userId).catch(() => [] as UpcomingRide[]),
        ]);
        if (!active) return;
        setUpcoming(next);
        setName((profile.data as { first_name?: string } | null)?.first_name ?? null);
        setSaved(places);
        setLive(trip);
        // Recent destinations, most recent first, each once, none already saved.
        const seen = new Set<string>(places.map((p) => p.label));
        // The last ride, if it was in the past three days and has no rating:
        // asked on the home screen, where it is one tap, not buried in history.
        const last = history.find((t) => t.state === "completed");
        if (last && Date.now() - new Date(last.scheduledFor ?? last.createdAt).getTime() < 3 * 86_400_000) {
          isRated(supabase, last.id)
            .then((done) => active && setToRate(done ? null : last))
            .catch(() => {});
        } else {
          setToRate(null);
        }
        setRecent(
          history
            .filter((t) => t.state === "completed")
            .map((t) => t.dropoffLabel)
            .filter((l) => (seen.has(l) ? false : (seen.add(l), true)))
            .slice(0, 3),
        );
      })();
      return () => {
        active = false;
      };
    }, [userId]),
  );

  // Who is free nearby, re-read every half minute while the screen is open:
  // the number moves as riders take trips and come back.
  useFocusEffect(
    useCallback(() => {
      if (!here) return;
      let active = true;
      const read = () =>
        ridersNearby(supabase, here)
          .then((n) => active && setNearby(n))
          .catch(() => {});
      read();
      const t = setInterval(read, 30_000);
      return () => {
        active = false;
        clearInterval(t);
      };
    }, [here?.lat, here?.lng]), // eslint-disable-line react-hooks/exhaustive-deps
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

  // The search and the saved places book now. A tile picks its own mode for
  // that one search, and nothing on this screen remembers it.
  const go = (params: Record<string, string> = {}, as: Mode = "now") => {
    tap();
    router.push({ pathname: "/destination", params: { ...pickupParams, mode: as, ...params } });
  };

  // A tile is a decision already made: the vehicle, or the kind of booking.
  const pick = (service: Service) => {
    if (service === "moto" || service === "cab") go({ vehicle: service });
    else go({}, service);
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
        mode: "now",
      },
    });

  const next = upcoming[0] ?? null;
  const startsIn = next ? countdown(new Date(next.scheduledFor).getTime() - now) : null;

  const rate = async (n: number) => {
    if (!toRate) return;
    setMood(n);
    try {
      await rateTrip(supabase, toRate.id, n);
      setThanked(true);
      setTimeout(() => setToRate(null), 2400);
    } catch {
      setMood(0);
    }
  };
  const free = (nearby ?? []).reduce((n, r) => n + r.riders, 0);
  const closest = (nearby ?? []).reduce((m, r) => Math.min(m, r.nearestM), Infinity);

  return (
    <View style={styles.root}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Hero overlap={OVERLAP}>
          <Enter i={0} style={styles.top}>
            <Press onPress={() => router.navigate("/account")} scaleTo={0.94} accessibilityRole="button" accessibilityLabel="Your account">
              <Avatar name={name ?? "?"} size={46} tone="highlight" />
            </Press>
            <View style={styles.flex}>
              <Txt v="label" tone="onHeroMuted">
                {greeting()}
              </Txt>
              <Txt v="h2" tone="onHero" lines={1}>
                {name ?? "Welcome"}
              </Txt>
            </View>
            <BellButton count={unread} onPress={() => router.push("/inbox")} onHero />
          </Enter>

          <Enter i={1} style={styles.ask}>
            <Txt v="title" tone="onHero" style={styles.askText}>
              Where are you going?
            </Txt>
            {/* Where the rider comes to. GPS by default; a tap sets it
                somewhere else - a main road, a gate, someone else's door. */}
            <Press
              onPress={() => go({ edit: "pickup" })}
              scaleTo={0.98}
              style={styles.pickup}
              accessibilityRole="button"
              accessibilityLabel={`Pickup: ${pickupLabel ?? "your current location"}. Change pickup`}
            >
              <View style={styles.pickupDot} />
              <Txt v="label" tone="onHeroMuted" lines={1} style={styles.flex}>
                {pickupLabel ? `From ${pickupLabel}` : gpsDenied ? "Location is off" : "Finding where you are…"}
              </Txt>
              <Txt v="label" tone="light" style={styles.pickupChange}>
                Change
              </Txt>
            </Press>
            {nearby !== null ? (
              <View style={styles.supply} accessibilityRole="text">
                <LiveDot tone={free > 0 ? "good" : "bad"} size={8} onDark />
                <Txt v="caption" tone="onHero" style={styles.supplyText}>
                  {free > 0
                    ? `${free} ${free === 1 ? "rider" : "riders"} free nearby, the closest about ${pickupMinutes(closest)} min away`
                    : "No riders free nearby right now"}
                </Txt>
              </View>
            ) : null}
          </Enter>
        </Hero>

        <View style={[styles.body, { marginTop: -OVERLAP }]}>
          {live ? (
            <Enter i={2}>
              <Card
                tone="yellow"
                onPress={() => router.push({ pathname: "/ride", params: { trip: live.id } })}
                accessibilityLabel={`${LIVE_COPY[live.state] ?? "Your trip"}, to ${live.dropoffLabel}`}
                inner={styles.live}
              >
                <LiveDot tone="good" size={10} />
                <View style={styles.flex}>
                  <Txt v="section" tone="onHighlight">
                    {LIVE_COPY[live.state] ?? "Your trip"}
                  </Txt>
                  <Txt v="label" tone="onHighlight" lines={1}>
                    To {live.dropoffLabel}
                  </Txt>
                </View>
                <View style={styles.arrowDark}>
                  <Ionicons name="arrow-forward" size={18} color={c.highlight} />
                </View>
              </Card>
            </Enter>
          ) : null}

          {/* The screen's whole job. The square is where you are going, drawn
              the way every drop-off in Nova is drawn. */}
          <Enter i={2}>
            <Card onPress={() => go()} accessibilityLabel="Search for a place to go" inner={styles.search}>
              <View style={styles.square} />
              <Txt v="section" tone="muted" style={styles.searchText} lines={1}>
                Search for a place
              </Txt>
              <View style={styles.searchIcon}>
                <Ionicons name="search" size={19} color={c.onHighlight} />
              </View>
            </Card>
          </Enter>

          {saved.length > 0 ? (
            <Enter i={3}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.places} style={styles.placesScroll}>
                {saved.map((p) => (
                  <Press key={p.id} onPress={() => choose(p)} scaleTo={0.96} style={styles.place} accessibilityRole="button" accessibilityLabel={`Go to ${p.label}`}>
                    <View style={styles.placeIcon}>
                      <Ionicons name={placeIcon(p.label)} size={15} color={c.accent} />
                    </View>
                    <Txt v="label" tone="strong" lines={1} style={styles.placeText}>
                      {p.label}
                    </Txt>
                  </Press>
                ))}
                <Press onPress={() => router.push({ pathname: "/destination", params: { map: "1" } })} scaleTo={0.96} style={[styles.place, styles.placeAdd]} accessibilityRole="button" accessibilityLabel="Save a place">
                  <Ionicons name="add" size={17} color={c.textMuted} />
                  <Txt v="label" tone="muted">
                    Add place
                  </Txt>
                </Press>
              </ScrollView>
            </Enter>
          ) : null}

          {gpsDenied ? (
            <Banner tone="warn" icon="location">
              Turn on location so your rider comes to where you are.
            </Banner>
          ) : null}

          {toRate ? (
            <Enter i={3}>
              <Card inner={styles.rate}>
                <View style={styles.rateHead}>
                  <View style={styles.rateIcon}>
                    <Ionicons name="star" size={18} color={c.onHighlight} />
                  </View>
                  <View style={styles.flex}>
                    <Txt v="section">{thanked ? "Thanks for rating" : "How was your last ride?"}</Txt>
                    <Txt v="label" tone="muted" lines={1}>
                      {thanked ? "Your rider will see it." : `To ${toRate.dropoffLabel}`}
                    </Txt>
                  </View>
                  {!thanked ? <IconButton icon="close" label="Not now" onPress={() => setToRate(null)} size={36} /> : null}
                </View>
                <MoodRating value={mood} onChange={(n) => void rate(n)} />
              </Card>
            </Enter>
          ) : null}

          <Enter i={4} style={styles.section}>
            <SectionTitle title="What do you need today?" />
            <ServiceTiles onPick={pick} />
          </Enter>

          {next ? (
            <Enter i={5}>
              <Card
                tone="hero"
                onPress={() => router.navigate("/activity")}
                accessibilityLabel={`Next ride ${whenLabel(next.scheduledFor)} to ${next.dropoffLabel}`}
                inner={styles.next}
              >
                <View style={styles.nextIcon}>
                  <Ionicons name={next.scheduleId ? "repeat" : "calendar"} size={20} color={c.onHighlight} />
                </View>
                <View style={styles.flex}>
                  <Txt v="caption" tone="onHeroMuted">
                    Your next ride
                  </Txt>
                  <Txt v="section" tone="onHero" lines={1}>
                    {whenLabel(next.scheduledFor)}
                  </Txt>
                  <Txt v="label" tone="onHeroMuted" lines={1}>
                    To {next.dropoffLabel}
                  </Txt>
                </View>
                {startsIn ? (
                  <View style={styles.countdown}>
                    <Txt v="caption" tone="onHighlight" style={styles.countdownText}>
                      {startsIn}
                    </Txt>
                  </View>
                ) : (
                  <Ionicons name="chevron-forward" size={20} color={c.onHeroMuted} />
                )}
              </Card>
            </Enter>
          ) : (
            <Enter i={5}>
              <Card tone="yellow" onPress={() => pick("later")} accessibilityLabel="Book tomorrow's ride tonight" inner={styles.promo}>
                <View style={styles.flex}>
                  <Txt v="section" tone="onHighlight">
                    Tomorrow's commute, sorted
                  </Txt>
                  <Txt v="label" tone="onHighlight" style={styles.promoBody}>
                    Book tonight. The price is fixed the moment you book.
                  </Txt>
                  <View style={styles.promoAction}>
                    <Txt v="label" tone="onHero" style={styles.promoActionText}>
                      Book ahead
                    </Txt>
                    <Ionicons name="arrow-forward" size={14} color={c.highlight} />
                  </View>
                </View>
                <Image source={require("../../assets/banner-ahead.png")} style={styles.promoArt} resizeMode="contain" accessibilityIgnoresInvertColors />
              </Card>
            </Enter>
          )}

          <Enter i={6} style={styles.section}>
            <SectionTitle title="Ride with confidence" action={{ label: "Safety", onPress: () => router.push("/help") }} />
            <SafetyCards onOpen={() => router.push("/help")} />
          </Enter>

          {recent.length > 0 ? (
            <Enter i={7} style={styles.section}>
              <SectionTitle title="Recent places" />
              <Card>
                {recent.map((r, i) => (
                  <Press key={r} onPress={() => go({ q: r })} scaleTo={1} bg={c.surfaceRaised} pressedBg={c.surfaceHigh} style={[styles.recent, i > 0 && styles.recentLine]} accessibilityRole="button" accessibilityLabel={`Go to ${r}`}>
                    <View style={styles.recentIcon}>
                      <Ionicons name="time-outline" size={17} color={c.textMuted} />
                    </View>
                    <Txt v="bodyStrong" lines={1} style={styles.flex}>
                      {r}
                    </Txt>
                    <Ionicons name="chevron-forward" size={17} color={c.textMuted} />
                  </Press>
                ))}
              </Card>
            </Enter>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  root: { flex: 1, backgroundColor: c.surface },
  scroll: { paddingBottom: space.xl },
  top: { flexDirection: "row", alignItems: "center", gap: space.md },
  bell: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: c.heroRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    top: -2,
    right: -2,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: c.highlight,
    borderWidth: 2,
    borderColor: c.hero,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontFamily: font.numBold, fontSize: 11, lineHeight: 14 },
  ask: { marginTop: space.lg, gap: space.sm },
  askText: { fontFamily: font.numBold, fontSize: 30, lineHeight: 36 },
  pickup: { flexDirection: "row", alignItems: "center", gap: space.sm },
  pickupDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 2.5, borderColor: c.highlight },
  pickupChange: { fontFamily: font.semibold },
  supply: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    alignSelf: "flex-start",
    marginTop: space.xs,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: c.heroRaised,
  },
  supplyText: { fontFamily: font.semibold, flexShrink: 1 },
  body: { paddingHorizontal: space.lg, gap: space.lg },
  live: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md },
  arrowDark: { width: 38, height: 38, borderRadius: 19, backgroundColor: c.hero, alignItems: "center", justifyContent: "center" },
  search: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md, paddingLeft: space.lg, paddingRight: space.md },
  square: { width: 12, height: 12, borderRadius: 3, backgroundColor: c.destination },
  searchText: { flex: 1, minWidth: 0 },
  now: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: c.tintBlue,
  },
  nowText: { fontFamily: font.semibold },
  searchIcon: { width: 46, height: 46, borderRadius: 23, backgroundColor: c.highlight, alignItems: "center", justifyContent: "center" },
  // The row of saved places bleeds to the screen's edges, so it reads as a
  // strip to scroll rather than a list that stops.
  placesScroll: { marginHorizontal: -space.lg, marginTop: -space.sm },
  places: { gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm },
  place: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingVertical: 8,
    paddingLeft: 8,
    paddingRight: 14,
    borderRadius: radius.pill,
    backgroundColor: c.surfaceRaised,
    ...shadow.card,
  },
  placeIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: c.tintBlue, alignItems: "center", justifyContent: "center" },
  placeText: { maxWidth: 140, fontFamily: font.semibold },
  placeAdd: { backgroundColor: "transparent", borderWidth: 1.5, borderStyle: "dashed", borderColor: c.border, shadowOpacity: 0, elevation: 0, paddingLeft: 12 },
  section: { gap: space.md },
  rate: { padding: space.md, gap: space.md },
  rateHead: { flexDirection: "row", alignItems: "center", gap: space.md },
  rateIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: c.highlight, alignItems: "center", justifyContent: "center" },
  countdown: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: c.highlight },
  countdownText: { fontFamily: font.semibold },
  next: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md },
  nextIcon: { width: 46, height: 46, borderRadius: 14, backgroundColor: c.highlight, alignItems: "center", justifyContent: "center" },
  promo: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingLeft: space.lg, paddingRight: space.sm, paddingVertical: space.md },
  promoBody: { marginTop: 2, opacity: 0.85 },
  promoAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    marginTop: space.md,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: c.hero,
  },
  promoActionText: { fontFamily: font.semibold },
  promoArt: { width: 116, height: 116 },
  recent: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 14, paddingHorizontal: space.md },
  recentLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
  recentIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: c.surfaceHigh, alignItems: "center", justifyContent: "center" },
});
