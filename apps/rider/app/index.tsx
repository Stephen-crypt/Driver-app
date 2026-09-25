import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { Redirect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme, tokens } from "@gera/ui";
import {
  setPresence,
  heartbeat,
  getPresence,
  getCashHeld,
  getNetOwed,
  canGoOnline,
  getLiveOffer,
  acceptOffer,
  declineOffer,
  getActiveTrip,
  advanceTrip,
  completeTrip,
  registerDeviceToken,
  getTripContact,
  cancelTrip,
  getEarningsSince,
  startOfToday,
  watchOffers,
  watchRiderTrips,
  publishTrackPoint,
  raiseSos,
  EMERGENCY_NUMBER,
  secondsLeft,
  type LiveOffer,
  type ActiveTrip,
  type VehicleClass,
  type Earnings,
} from "@gera/data";
import { supabase } from "../src/lib/supabase";
import { registerForPush } from "../src/lib/push";
import * as loc from "../src/lib/location";
import { EmptyState } from "../src/components/EmptyState";
import { Card, Chip, PrimaryButton, Row, Stat } from "../src/components/Card";

const money = (rwf: number) => rwf.toLocaleString("en-US");

export default function Console() {
  const insets = useSafeAreaInsets();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [riderId, setRiderId] = useState<string | null>(null);

  const [online, setOnline] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [cashHeld, setCashHeld] = useState<number | null>(null);
  const [netOwed, setNetOwed] = useState<number | null>(null);
  const [vehicleClass, setVehicleClass] = useState<VehicleClass>("moto");

  const [here, setHere] = useState<loc.Coords | null>(null);
  const [gpsDenied, setGpsDenied] = useState(false);

  const [offer, setOffer] = useState<LiveOffer | null>(null);
  const [trip, setTrip] = useState<ActiveTrip | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  // Bumped on every poll purely to force a re-render, so the offer countdown
  // ticks down on screen. secondsLeft reads the clock, not this value.
  const [, setTick] = useState(0);

  const hereRef = useRef<loc.Coords | null>(null);
  hereRef.current = here;

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSignedIn(data.session !== null);
      setRiderId(data.session?.user.id ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!active) return;
      setSignedIn(session !== null);
      setRiderId(session?.user.id ?? null);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Push. This is what makes an offer reach a rider whose phone is in their
  // pocket - polling only works while the app is foregrounded, and an offer
  // lives fifteen seconds.
  useEffect(() => {
    if (!riderId) return;
    let active = true;
    (async () => {
      const result = await registerForPush();
      if (!active || !result.ok) return;
      try {
        await registerDeviceToken(supabase, riderId, result.token, "android");
      } catch {
        // A rider without push still sees offers while the app is open.
      }
    })();
    return () => {
      active = false;
    };
  }, [riderId]);

  // Location. Asked for once, up front: a rider who goes online without it is
  // invisible to dispatch, which looks like "the app gives me no work".
  useEffect(() => {
    let sub: { remove: () => void } | null = null;
    let active = true;
    (async () => {
      const granted = await loc.requestPermission();
      if (!active) return;
      if (!granted) {
        setGpsDenied(true);
        return;
      }
      const first = await loc.getCurrent();
      if (active && first) setHere(first);
      sub = await loc.watch((c) => {
        if (active) setHere(c);
      });
    })();
    return () => {
      active = false;
      sub?.remove();
    };
  }, []);

  // Existing state on launch, so closing the app mid-shift does not lose it.
  useEffect(() => {
    if (!riderId) return;
    let active = true;
    (async () => {
      try {
        const [p, cash, owed, allowed] = await Promise.all([
          getPresence(supabase, riderId),
          getCashHeld(supabase, riderId),
          getNetOwed(supabase, riderId),
          canGoOnline(supabase, riderId),
        ]);
        if (!active) return;
        setCashHeld(cash);
        setNetOwed(owed);
        if (p) {
          setOnline(p.status !== "offline");
          setVehicleClass(p.vehicleClass);
        }
        // The server owns this rule; the app only reports it.
        // The server owns this rule; the app only reports it. Two things can
        // block a fleet rider, and telling them the wrong one wastes their day.
        setBlocked(
          allowed
            ? null
            : cash > 0
              ? "Hand in the cash you're carrying before your next shift."
              : "No vehicle assigned yet. Speak to the depot.",
        );
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Could not load your status.");
      }
    })();
    return () => {
      active = false;
    };
  }, [riderId]);

  // Offers arrive over realtime, not polling: an offer lives fifteen seconds and
  // a three-second poll was spending up to a fifth of that before the rider
  // even saw it. The interval that remains is the heartbeat - which has to keep
  // running regardless, or the rider falls out of the dispatch index - plus a
  // re-read as a backstop for a websocket that dropped.
  useEffect(() => {
    if (!riderId || !online) return;

    const refresh = async () => {
      try {
        const [o, t] = await Promise.all([
          getLiveOffer(supabase, riderId),
          getActiveTrip(supabase, riderId),
        ]);
        setOffer(o);
        setTrip(t);
      } catch {
        // A dropped read is not a dropped shift.
      }
    };

    const offers = watchOffers(supabase, riderId, refresh);
    const trips = watchRiderTrips(supabase, riderId, refresh);
    void refresh();

    // Still every three seconds: this is the heartbeat, and rider_presence
    // goes stale in thirty. The countdown redraw rides along with it.
    const id = setInterval(async () => {
      setTick((t) => t + 1);
      const at = hereRef.current;
      try {
        if (at) await heartbeat(supabase, riderId, at);
      } catch {
        // The next beat retries.
      }
    }, 3000);

    // Slower backstop, in case the subscription died quietly.
    const backstop = setInterval(refresh, 15000);

    return () => {
      offers.unsubscribe();
      trips.unsubscribe();
      clearInterval(id);
      clearInterval(backstop);
    };
  }, [riderId, online]);

  // Publish position while a trip is live. This is what the passenger sees moving
  // on their map; without it "Rider on the way" is indistinguishable from a
  // stuck app, which is the single most common reason a passenger cancels.
  useEffect(() => {
    if (!trip) return;
    let active = true;

    const send = () => {
      const at = hereRef.current;
      if (!at) return;
      publishTrackPoint(supabase, trip.id, { lng: at.lng, lat: at.lat }).catch(() => {
        // A dropped point is not a dropped trip; the next tick carries a
        // fresher position anyway.
      });
    };

    send();
    // Every five seconds. Faster drains a battery that has to last a shift;
    // slower makes the marker visibly jump between fixes.
    const id = setInterval(send, 5000);
    return () => {
      active = false;
      void active;
      clearInterval(id);
    };
  }, [trip?.id]);

  // Today's earnings. Refreshed when a trip finishes rather than on a timer -
  // that is the only moment the number can change.
  useEffect(() => {
    if (!riderId) return;
    let active = true;
    getEarningsSince(supabase, riderId, startOfToday())
      .then((e) => {
        if (active) setEarnings(e);
      })
      .catch(() => {
        // Earnings are informational; the console works without them.
      });
    return () => {
      active = false;
    };
  }, [riderId, trip?.id]);

  const toggleOnline = useCallback(
    async (next: boolean) => {
      if (!riderId) return;
      setError(null);
      const at = hereRef.current;
      if (next && !at) {
        setError("Waiting for your location. Turn on GPS and try again.");
        return;
      }
      setBusy(true);
      try {
        if (next) {
          const allowed = await canGoOnline(supabase, riderId);
          if (!allowed) {
            const cash = await getCashHeld(supabase, riderId);
            setBlocked(
              cash > 0
                ? "Hand in the cash you're carrying before your next shift."
                : "No vehicle assigned yet. Speak to the depot.",
            );
            return;
          }
          setBlocked(null);
        }
        await setPresence(supabase, riderId, {
          status: next ? "online" : "offline",
          at: at ?? loc.KIGALI_FALLBACK,
          vehicleClass,
        });
        setOnline(next);
        if (!next) setOffer(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not change your status.");
      } finally {
        setBusy(false);
      }
    },
    [riderId, vehicleClass],
  );

  const onAccept = useCallback(async () => {
    if (!offer) return;
    setBusy(true);
    setError(null);
    try {
      await acceptOffer(supabase, offer.offerId);
      setOffer(null);
      if (riderId) setTrip(await getActiveTrip(supabase, riderId));
    } catch {
      setError("That trip is gone. Someone else took it.");
      setOffer(null);
    } finally {
      setBusy(false);
    }
  }, [offer, riderId]);

  const onDecline = useCallback(async () => {
    if (!offer) return;
    setBusy(true);
    try {
      await declineOffer(supabase, offer.offerId);
      setOffer(null);
    } catch {
      setOffer(null);
    } finally {
      setBusy(false);
    }
  }, [offer]);

  const onAdvance = useCallback(
    async (to: "arrived" | "in_progress") => {
      if (!trip) return;
      setBusy(true);
      setError(null);
      try {
        await advanceTrip(supabase, trip.id, to);
        if (riderId) setTrip(await getActiveTrip(supabase, riderId));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not update the trip.");
      } finally {
        setBusy(false);
      }
    },
    [trip, riderId],
  );

  const onComplete = useCallback(async () => {
    if (!trip || !riderId) return;
    setBusy(true);
    setError(null);
    try {
      // Real travelled distance arrives with navigation; until then the quoted
      // distance is what the fare was agreed on, so it is what is charged.
      const distance = trip.quotedDistanceM ?? 0;
      await completeTrip(supabase, {
        tripId: trip.id,
        actualDistanceM: distance,
        idempotencyKey: `complete-${trip.id}`,
      });
      setTrip(null);
      setCashHeld(await getCashHeld(supabase, riderId));
      setNetOwed(await getNetOwed(supabase, riderId));
      setEarnings(await getEarningsSince(supabase, riderId, startOfToday()));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not finish the trip.");
    } finally {
      setBusy(false);
    }
  }, [trip, riderId]);

  const onCallPassenger = useCallback(async () => {
    if (!trip) return;
    try {
      const contact = await getTripContact(supabase, trip.id);
      if (!contact?.phone) {
        Alert.alert("Not available", "You can call once the trip is active.");
        return;
      }
      await Linking.openURL(`tel:${contact.phone}`);
    } catch {
      Alert.alert("Could not call", "Try again in a moment.");
    }
  }, [trip]);

  const onCancelTrip = useCallback(() => {
    if (!trip) return;
    Alert.alert(
      "Cancel this trip?",
      "Cancelling after accepting affects your standing.",
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Cancel trip",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            try {
              await cancelTrip(supabase, trip.id, "rider");
              setTrip(null);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Could not cancel.");
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }, [trip]);

  const onSos = useCallback(() => {
    Alert.alert(
      "Emergency",
      "We'll record where you are and who you're with. If you're in danger, call 112.",
      [
        { text: "Close", style: "cancel" },
        {
          text: "Record alert",
          onPress: async () => {
            const at = hereRef.current;
            try {
              await raiseSos(supabase, {
                ...(trip ? { tripId: trip.id } : {}),
                ...(at ? { at: { lng: at.lng, lat: at.lat } } : {}),
              });
              Alert.alert("Recorded", "Your alert and location have been saved.");
            } catch {
              Alert.alert("Could not record", `Call ${EMERGENCY_NUMBER} directly.`);
            }
          },
        },
        {
          text: `Call ${EMERGENCY_NUMBER}`,
          style: "destructive",
          onPress: () => {
            void raiseSos(supabase, trip ? { tripId: trip.id } : {}).catch(() => {});
            void Linking.openURL(`tel:${EMERGENCY_NUMBER}`);
          },
        },
      ],
    );
  }, [trip]);

  if (signedIn === null) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }
  if (!signedIn) return <Redirect href="/welcome" />;

  const left = offer ? secondsLeft(offer.expiresAt) : 0;

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
        <View style={styles.flex}>
          <Text style={styles.eyebrow}>Gera rider</Text>
          <Text style={styles.headline}>{online ? "You're online" : "You're offline"}</Text>
        </View>
        <Chip
          label={online ? "Live" : "Off"}
          tone={online ? "good" : "neutral"}
        />
      </View>

      <Card style={styles.toggleCard}>
        <Row
          icon={online ? "radio-outline" : "power-outline"}
          tone={online ? "good" : "accent"}
          label={online ? "Taking trips" : "Go online"}
          style={styles.flex}
        />
        <Switch
          value={online}
          onValueChange={toggleOnline}
          disabled={busy || Boolean(blocked)}
          trackColor={{ true: theme.accent, false: theme.border }}
          thumbColor={theme.surfaceRaised}
        />
      </Card>

      {/* Two numbers, never one. The cash is the company's and has to be
          handed in; the owed is the rider's and gets paid out. A single
          "balance" would net them and tell the rider neither fact. */}
      <Card style={styles.gap}>
        <View style={styles.statRow}>
          <Stat
            label="Cash to hand in"
            value={cashHeld === null ? "—" : money(cashHeld)}
            unit="RWF"
            tone={cashHeld !== null && cashHeld > 0 ? "bad" : "default"}
          />
          <View style={styles.statDivider} />
          <Stat
            label="You're owed"
            value={netOwed === null ? "—" : money(netOwed)}
            unit="RWF"
            tone="good"
          />
        </View>
      </Card>

      {/* Gross, commission and net together. Showing gross alone is the number
          that makes a rider feel cheated when the wallet moves. */}
      <Card style={styles.gap}>
        <Text style={styles.cardTitle}>Today</Text>
        <View style={styles.statRow}>
          <Stat label="Trips" value={String(earnings?.trips ?? 0)} />
          <View style={styles.statDivider} />
          <Stat label="Collected" value={money(earnings?.collectedRwf ?? 0)} unit="RWF" />
          <View style={styles.statDivider} />
          <Stat
            label="You earned"
            value={money(earnings?.earnedRwf ?? 0)}
            unit="RWF"
            tone="good"
          />
        </View>
      </Card>

      {blocked ? <Banner icon="wallet-outline" tone="warn" text={blocked} /> : null}
      {gpsDenied ? (
        <Banner
          icon="location-outline"
          tone="warn"
          text="Location is off. Dispatch cannot find you without it."
        />
      ) : null}
      {error ? <Banner icon="alert-circle-outline" tone="bad" text={error} /> : null}

      {/* An offer beats everything else on screen: it has fifteen seconds. */}
      {offer && !trip ? (
        <Card style={styles.offer}>
          <View style={styles.offerHead}>
            <View style={styles.flex}>
              <Text style={styles.statLabelUp}>New trip</Text>
              <View style={styles.fareRow}>
                <Text style={styles.fare}>
                  {offer.fareRwf === null ? "—" : money(offer.fareRwf)}
                </Text>
                <Text style={styles.fareUnit}>RWF</Text>
              </View>
            </View>
            {/* The countdown sits inside a ring rather than as loose text: the
                shape is what makes it read as time running out at a glance. */}
            <View style={styles.ring}>
              <Text style={styles.ringValue}>{left}</Text>
              <Text style={styles.ringUnit}>sec</Text>
            </View>
          </View>

          <Leg
            pickup={offer.pickupLabel}
            note={offer.pickupNote}
            dropoff={offer.dropoffLabel}
          />

          <PrimaryButton label="Accept" badge={String(left)} onPress={onAccept} disabled={busy} />
          <Pressable style={styles.ghost} onPress={onDecline} disabled={busy}>
            <Text style={styles.ghostText}>Pass</Text>
          </Pressable>
        </Card>
      ) : null}

      {trip ? (
        <Card style={styles.gap}>
          <View style={styles.offerHead}>
            <View style={styles.flex}>
              <Chip
                label={
                  trip.state === "accepted"
                    ? "Head to pickup"
                    : trip.state === "arrived"
                      ? "Waiting"
                      : "In progress"
                }
                tone={trip.state === "in_progress" ? "good" : "warn"}
              />
              <View style={styles.fareRow}>
                <Text style={styles.fare}>
                  {trip.fareRwf === null ? "—" : money(trip.fareRwf)}
                </Text>
                <Text style={styles.fareUnit}>RWF</Text>
              </View>
            </View>
          </View>

          <Leg pickup={trip.pickupLabel} note={trip.pickupNote} dropoff={trip.dropoffLabel} />

          <View style={styles.rowList}>
            <Row icon="call-outline" label="Call passenger" onPress={onCallPassenger} />
            {/* Hands the coordinates to whatever maps app the rider already
                uses and trusts, rather than pretending to do navigation. */}
            <Row
              icon="navigate-outline"
              label="Navigate"
              onPress={() => {
                const at = hereRef.current;
                if (!at) return;
                void Linking.openURL(`geo:0,0?q=${at.lat},${at.lng}(Pickup)`);
              }}
            />
          </View>

          {trip.state === "accepted" ? (
            <PrimaryButton label="I've arrived" onPress={() => onAdvance("arrived")} disabled={busy} />
          ) : trip.state === "arrived" ? (
            <PrimaryButton
              label="Start trip"
              onPress={() => onAdvance("in_progress")}
              disabled={busy}
            />
          ) : (
            <PrimaryButton label="Finish · take cash" onPress={onComplete} disabled={busy} />
          )}

          {/* Cancelling is allowed from accepted and arrived, and nowhere else -
              the same window trip_transition_rules defines. */}
          {trip.state !== "in_progress" ? (
            <Pressable style={styles.ghost} onPress={onCancelTrip} disabled={busy}>
              <Text style={styles.cancelText}>Cancel trip</Text>
            </Pressable>
          ) : null}
        </Card>
      ) : null}

      {online && !offer && !trip ? (
        <Card style={styles.waiting}>
          <ActivityIndicator color={theme.accent} />
          <Text style={styles.waitingText}>Looking for trips near you…</Text>
        </Card>
      ) : null}

      {/* Offline with nothing running: the screen would otherwise be a toggle
          and a lot of empty space. */}
      {!online && !trip ? (
        <View style={styles.gap}>
          <EmptyState
            icon="moon-outline"
            title="Nothing running"
            body="Go online and trips near you will come straight to this screen."
          />
        </View>
      ) : null}

      <Pressable style={styles.sos} onPress={onSos} accessibilityRole="button">
        <Ionicons name="warning-outline" size={18} color={theme.danger} />
        <Text style={styles.sosText}>Emergency</Text>
      </Pressable>
    </ScrollView>
  );
}

/**
 * Pickup and drop-off joined by a line, because a rider reads a trip as one
 * movement rather than as two addresses. The dots carry the meaning: the route
 * colours are the only place in the product where two hues appear together.
 */
function Leg({
  pickup,
  note,
  dropoff,
}: {
  readonly pickup: string;
  readonly note?: string | null;
  readonly dropoff: string;
}) {
  return (
    <View style={styles.leg}>
      <View style={styles.legRail}>
        <View style={[styles.legDot, { backgroundColor: theme.origin }]} />
        <View style={styles.legLine} />
        <View style={[styles.legDot, { backgroundColor: theme.destination }]} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.legLabel} numberOfLines={1}>
          {pickup}
        </Text>
        {note ? (
          <Text style={styles.legNote} numberOfLines={2}>
            “{note}”
          </Text>
        ) : null}
        <Text style={[styles.legLabel, styles.legDrop]} numberOfLines={1}>
          {dropoff}
        </Text>
      </View>
    </View>
  );
}

/** A warning that stays legible: tinted ground, matching ink, an icon to find it by. */
function Banner({
  icon,
  tone,
  text,
}: {
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly tone: "warn" | "bad";
  readonly text: string;
}) {
  const ink = tone === "bad" ? theme.danger : theme.warning;
  return (
    <View
      style={[
        styles.banner,
        { backgroundColor: tone === "bad" ? theme.dangerSoft : theme.warningSoft },
      ]}
    >
      <Ionicons name={icon} size={18} color={ink} />
      <Text style={[styles.bannerText, { color: ink }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.surface },
  content: { paddingHorizontal: tokens.space.lg, paddingBottom: tokens.space.xxl },
  flex: { flex: 1 },
  gap: { marginTop: tokens.space.md },
  centre: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.surface,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: tokens.space.md,
  },
  eyebrow: {
    fontSize: tokens.type.label.size,
    fontWeight: "600",
    color: theme.textMuted,
  },
  headline: {
    fontSize: tokens.type.title.size,
    fontWeight: "700",
    color: theme.textStrong,
  },
  toggleCard: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  cardTitle: {
    fontSize: tokens.type.label.size,
    fontWeight: "700",
    color: theme.textMuted,
    marginBottom: tokens.space.sm,
  },
  statRow: { flexDirection: "row", alignItems: "flex-start" },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: "stretch",
    backgroundColor: theme.border,
    marginHorizontal: tokens.space.sm,
  },
  statLabelUp: {
    fontSize: tokens.type.label.size,
    fontWeight: "600",
    color: theme.textMuted,
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    marginTop: tokens.space.md,
    padding: tokens.space.md,
    borderRadius: tokens.radius.md,
  },
  bannerText: { flex: 1, fontSize: tokens.type.body.size, fontWeight: "600" },
  // The one card that is allowed a border: an offer has fifteen seconds and has
  // to be findable without reading anything.
  offer: {
    marginTop: tokens.space.md,
    borderWidth: 2,
    borderColor: theme.accent,
  },
  offerHead: { flexDirection: "row", alignItems: "flex-start" },
  fareRow: { flexDirection: "row", alignItems: "baseline", marginTop: 2 },
  fare: {
    fontSize: tokens.type.display.size,
    fontWeight: "700",
    color: theme.textStrong,
    letterSpacing: -1,
  },
  fareUnit: {
    marginLeft: tokens.space.xs,
    fontSize: tokens.type.body.size,
    fontWeight: "700",
    color: theme.textMuted,
  },
  ring: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 3,
    borderColor: theme.accent,
    backgroundColor: theme.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  ringValue: {
    fontSize: tokens.type.title.size,
    fontWeight: "700",
    color: theme.accent,
    lineHeight: tokens.type.title.size + 2,
  },
  ringUnit: { fontSize: 10, fontWeight: "700", color: theme.accent },
  leg: {
    flexDirection: "row",
    gap: tokens.space.sm,
    marginVertical: tokens.space.md,
  },
  legRail: { alignItems: "center", paddingTop: 6 },
  legDot: { width: 10, height: 10, borderRadius: 5 },
  legLine: { flex: 1, width: 2, minHeight: 22, backgroundColor: theme.border },
  legLabel: {
    fontSize: tokens.type.body.size,
    fontWeight: "600",
    color: theme.textStrong,
  },
  legNote: {
    fontSize: tokens.type.label.size,
    color: theme.textMuted,
    fontStyle: "italic",
  },
  legDrop: { marginTop: "auto", paddingTop: tokens.space.md },
  rowList: { gap: tokens.space.xs, marginBottom: tokens.space.sm },
  waiting: {
    marginTop: tokens.space.md,
    alignItems: "center",
    paddingVertical: tokens.space.lg,
  },
  waitingText: {
    marginTop: tokens.space.md,
    fontSize: tokens.type.body.size,
    color: theme.textMuted,
  },
  ghost: {
    marginTop: tokens.space.sm,
    minHeight: tokens.MIN_TOUCH_TARGET,
    alignItems: "center",
    justifyContent: "center",
  },
  ghostText: { fontSize: tokens.type.body.size, color: theme.textMuted },
  cancelText: { fontSize: tokens.type.body.size, color: theme.danger },
  sos: {
    flexDirection: "row",
    gap: tokens.space.sm,
    marginTop: tokens.space.lg,
    minHeight: tokens.MIN_TOUCH_TARGET,
    borderRadius: tokens.radius.pill,
    backgroundColor: theme.dangerSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  sosText: { fontSize: tokens.type.body.size, fontWeight: "700", color: theme.danger },
});
