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
import { theme, tokens } from "@gera/ui";
import {
  setPresence,
  heartbeat,
  getPresence,
  getBalance,
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
  watchDriverTrips,
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

const money = (rwf: number) => rwf.toLocaleString("en-US");

export default function Console() {
  const insets = useSafeAreaInsets();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [driverId, setDriverId] = useState<string | null>(null);

  const [online, setOnline] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
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
      setDriverId(data.session?.user.id ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!active) return;
      setSignedIn(session !== null);
      setDriverId(session?.user.id ?? null);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Push. This is what makes an offer reach a driver whose phone is in their
  // pocket - polling only works while the app is foregrounded, and an offer
  // lives fifteen seconds.
  useEffect(() => {
    if (!driverId) return;
    let active = true;
    (async () => {
      const result = await registerForPush();
      if (!active || !result.ok) return;
      try {
        await registerDeviceToken(supabase, driverId, result.token, "android");
      } catch {
        // A driver without push still sees offers while the app is open.
      }
    })();
    return () => {
      active = false;
    };
  }, [driverId]);

  // Location. Asked for once, up front: a driver who goes online without it is
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
    if (!driverId) return;
    let active = true;
    (async () => {
      try {
        const [p, b, allowed] = await Promise.all([
          getPresence(supabase, driverId),
          getBalance(supabase, driverId),
          canGoOnline(supabase, driverId),
        ]);
        if (!active) return;
        setBalance(b);
        if (p) {
          setOnline(p.status !== "offline");
          setVehicleClass(p.vehicleClass);
        }
        // The server owns this rule; the app only reports it.
        setBlocked(allowed ? null : "Top up your wallet to go online.");
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Could not load your status.");
      }
    })();
    return () => {
      active = false;
    };
  }, [driverId]);

  // Offers arrive over realtime, not polling: an offer lives fifteen seconds and
  // a three-second poll was spending up to a fifth of that before the driver
  // even saw it. The interval that remains is the heartbeat - which has to keep
  // running regardless, or the driver falls out of the dispatch index - plus a
  // re-read as a backstop for a websocket that dropped.
  useEffect(() => {
    if (!driverId || !online) return;

    const refresh = async () => {
      try {
        const [o, t] = await Promise.all([
          getLiveOffer(supabase, driverId),
          getActiveTrip(supabase, driverId),
        ]);
        setOffer(o);
        setTrip(t);
      } catch {
        // A dropped read is not a dropped shift.
      }
    };

    const offers = watchOffers(supabase, driverId, refresh);
    const trips = watchDriverTrips(supabase, driverId, refresh);
    void refresh();

    // Still every three seconds: this is the heartbeat, and driver_presence
    // goes stale in thirty. The countdown redraw rides along with it.
    const id = setInterval(async () => {
      setTick((t) => t + 1);
      const at = hereRef.current;
      try {
        if (at) await heartbeat(supabase, driverId, at);
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
  }, [driverId, online]);

  // Today's earnings. Refreshed when a trip finishes rather than on a timer -
  // that is the only moment the number can change.
  useEffect(() => {
    if (!driverId) return;
    let active = true;
    getEarningsSince(supabase, driverId, startOfToday())
      .then((e) => {
        if (active) setEarnings(e);
      })
      .catch(() => {
        // Earnings are informational; the console works without them.
      });
    return () => {
      active = false;
    };
  }, [driverId, trip?.id]);

  const toggleOnline = useCallback(
    async (next: boolean) => {
      if (!driverId) return;
      setError(null);
      const at = hereRef.current;
      if (next && !at) {
        setError("Waiting for your location. Turn on GPS and try again.");
        return;
      }
      setBusy(true);
      try {
        if (next) {
          const allowed = await canGoOnline(supabase, driverId);
          if (!allowed) {
            setBlocked("Top up your wallet to go online.");
            return;
          }
          setBlocked(null);
        }
        await setPresence(supabase, driverId, {
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
    [driverId, vehicleClass],
  );

  const onAccept = useCallback(async () => {
    if (!offer) return;
    setBusy(true);
    setError(null);
    try {
      await acceptOffer(supabase, offer.offerId);
      setOffer(null);
      if (driverId) setTrip(await getActiveTrip(supabase, driverId));
    } catch {
      setError("That trip is gone. Someone else took it.");
      setOffer(null);
    } finally {
      setBusy(false);
    }
  }, [offer, driverId]);

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
        if (driverId) setTrip(await getActiveTrip(supabase, driverId));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not update the trip.");
      } finally {
        setBusy(false);
      }
    },
    [trip, driverId],
  );

  const onComplete = useCallback(async () => {
    if (!trip || !driverId) return;
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
      setBalance(await getBalance(supabase, driverId));
      setEarnings(await getEarningsSince(supabase, driverId, startOfToday()));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not finish the trip.");
    } finally {
      setBusy(false);
    }
  }, [trip, driverId]);

  const onCallRider = useCallback(async () => {
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
              await cancelTrip(supabase, trip.id, "driver");
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
    >
      <View style={styles.statusRow}>
        <View style={styles.flex}>
          <Text style={styles.statusLabel}>{online ? "You're online" : "You're offline"}</Text>
          <Text style={styles.statusSub}>
            {online ? "Waiting for trips nearby" : "Go online to get trips"}
          </Text>
        </View>
        <Switch
          value={online}
          onValueChange={toggleOnline}
          disabled={busy || Boolean(blocked)}
          trackColor={{ true: theme.accent, false: theme.textMuted }}
        />
      </View>

      <View style={styles.walletRow}>
        <Text style={styles.walletLabel}>Wallet</Text>
        <Text style={styles.walletValue}>
          {balance === null ? "—" : `${money(balance)} RWF`}
        </Text>
      </View>

      {/* Gross, commission and net together. Showing gross alone is the number
          that makes a driver feel cheated when the wallet moves. */}
      <View style={styles.earnings}>
        <Text style={styles.earningsTitle}>Today</Text>
        <View style={styles.earningsRow}>
          <View style={styles.earningsCell}>
            <Text style={styles.earningsValue}>{earnings?.trips ?? 0}</Text>
            <Text style={styles.earningsLabel}>trips</Text>
          </View>
          <View style={styles.earningsCell}>
            <Text style={styles.earningsValue}>{money(earnings?.grossRwf ?? 0)}</Text>
            <Text style={styles.earningsLabel}>collected</Text>
          </View>
          <View style={styles.earningsCell}>
            <Text style={styles.earningsValue}>−{money(earnings?.commissionRwf ?? 0)}</Text>
            <Text style={styles.earningsLabel}>commission</Text>
          </View>
          <View style={styles.earningsCell}>
            <Text style={[styles.earningsValue, styles.earningsNet]}>
              {money(earnings?.netRwf ?? 0)}
            </Text>
            <Text style={styles.earningsLabel}>you keep</Text>
          </View>
        </View>
      </View>

      {blocked ? <Text style={styles.warn}>{blocked}</Text> : null}
      {gpsDenied ? (
        <Text style={styles.warn}>
          Location is off. Dispatch cannot find you without it.
        </Text>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {/* An offer beats everything else on screen: it has fifteen seconds. */}
      {offer && !trip ? (
        <View style={styles.offer}>
          <Text style={styles.offerCountdown}>{left}s</Text>
          <Text style={styles.offerFare}>
            {offer.fareRwf === null ? "—" : `${money(offer.fareRwf)} RWF`}
          </Text>
          <Text style={styles.offerLeg}>Pick up · {offer.pickupLabel}</Text>
          {offer.pickupNote ? (
            <Text style={styles.offerNote}>“{offer.pickupNote}”</Text>
          ) : null}
          <Text style={styles.offerLeg}>Drop off · {offer.dropoffLabel}</Text>

          <Pressable
            style={[styles.cta, busy && styles.ctaDisabled]}
            onPress={onAccept}
            disabled={busy}
            accessibilityRole="button"
          >
            <Text style={styles.ctaText}>Accept</Text>
          </Pressable>
          <Pressable style={styles.ghost} onPress={onDecline} disabled={busy}>
            <Text style={styles.ghostText}>Pass</Text>
          </Pressable>
        </View>
      ) : null}

      {trip ? (
        <View style={styles.trip}>
          <Text style={styles.tripState}>
            {trip.state === "accepted"
              ? "Head to the pickup"
              : trip.state === "arrived"
                ? "Waiting for your rider"
                : "Trip in progress"}
          </Text>
          <Text style={styles.offerFare}>
            {trip.fareRwf === null ? "—" : `${money(trip.fareRwf)} RWF`}
          </Text>
          <Text style={styles.offerLeg}>Pick up · {trip.pickupLabel}</Text>
          {trip.pickupNote ? <Text style={styles.offerNote}>“{trip.pickupNote}”</Text> : null}
          <Text style={styles.offerLeg}>Drop off · {trip.dropoffLabel}</Text>

          {trip.state === "accepted" ? (
            <Pressable
              style={[styles.cta, busy && styles.ctaDisabled]}
              onPress={() => onAdvance("arrived")}
              disabled={busy}
            >
              <Text style={styles.ctaText}>I've arrived</Text>
            </Pressable>
          ) : trip.state === "arrived" ? (
            <Pressable
              style={[styles.cta, busy && styles.ctaDisabled]}
              onPress={() => onAdvance("in_progress")}
              disabled={busy}
            >
              <Text style={styles.ctaText}>Start trip</Text>
            </Pressable>
          ) : (
            <Pressable
              style={[styles.cta, busy && styles.ctaDisabled]}
              onPress={onComplete}
              disabled={busy}
            >
              <Text style={styles.ctaText}>Finish · collect cash</Text>
            </Pressable>
          )}

          <Pressable style={styles.call} onPress={onCallRider} accessibilityRole="button">
            <Text style={styles.callText}>Call rider</Text>
          </Pressable>

          {/* Cancelling is allowed from accepted and arrived, and nowhere else -
              the same window trip_transition_rules defines. */}
          {trip.state !== "in_progress" ? (
            <Pressable style={styles.ghost} onPress={onCancelTrip} disabled={busy}>
              <Text style={styles.cancelText}>Cancel trip</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {online && !offer && !trip ? (
        <View style={styles.waiting}>
          <ActivityIndicator color={theme.accent} />
          <Text style={styles.waitingText}>Looking for trips near you…</Text>
        </View>
      ) : null}

      {/* Offline with nothing running: the screen would otherwise be a toggle
          and a lot of empty space. */}
      {!online && !trip ? (
        <View style={styles.offlineArt}>
          <EmptyState
            title="You're offline"
            body="Go online and trips near you will come straight to this screen."
          />
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.surface },
  content: { padding: tokens.space.lg, paddingBottom: tokens.space.xxl },
  flex: { flex: 1 },
  centre: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.surface,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: tokens.space.md,
    borderRadius: tokens.radius.lg,
    backgroundColor: theme.surfaceRaised,
    minHeight: tokens.MIN_TOUCH_TARGET,
  },
  statusLabel: {
    fontSize: tokens.type.title.size,
    fontWeight: "700",
    color: theme.textStrong,
  },
  statusSub: { fontSize: tokens.type.label.size, color: theme.textMuted },
  walletRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: tokens.space.md,
    padding: tokens.space.md,
    borderRadius: tokens.radius.md,
    backgroundColor: theme.surfaceRaised,
  },
  walletLabel: { fontSize: tokens.type.body.size, color: theme.textMuted },
  walletValue: {
    fontSize: tokens.type.title.size,
    fontWeight: "700",
    color: theme.textStrong,
  },
  warn: {
    marginTop: tokens.space.md,
    fontSize: tokens.type.body.size,
    color: theme.textStrong,
    backgroundColor: theme.surfaceRaised,
    padding: tokens.space.md,
    borderRadius: tokens.radius.md,
    borderLeftWidth: 4,
    borderLeftColor: theme.accent,
  },
  error: {
    marginTop: tokens.space.md,
    fontSize: tokens.type.body.size,
    color: theme.danger,
  },
  offer: {
    marginTop: tokens.space.lg,
    padding: tokens.space.lg,
    borderRadius: tokens.radius.lg,
    backgroundColor: theme.surfaceRaised,
    borderWidth: 3,
    borderColor: theme.accent,
  },
  // The countdown is the most urgent thing on the screen, so it is the largest.
  offerCountdown: {
    fontSize: tokens.type.display.size,
    fontWeight: "700",
    color: theme.accent,
  },
  offerFare: {
    fontSize: tokens.type.display.size,
    fontWeight: "700",
    color: theme.textStrong,
  },
  offerLeg: {
    marginTop: tokens.space.sm,
    fontSize: tokens.type.body.size,
    color: theme.textStrong,
  },
  offerNote: {
    fontSize: tokens.type.body.size,
    color: theme.textMuted,
    fontStyle: "italic",
  },
  trip: {
    marginTop: tokens.space.lg,
    padding: tokens.space.lg,
    borderRadius: tokens.radius.lg,
    backgroundColor: theme.surfaceRaised,
  },
  tripState: {
    fontSize: tokens.type.title.size,
    fontWeight: "700",
    color: theme.textStrong,
    marginBottom: tokens.space.sm,
  },
  waiting: { marginTop: tokens.space.xxl, alignItems: "center" },
  offlineArt: { marginTop: tokens.space.lg },
  waitingText: {
    marginTop: tokens.space.md,
    fontSize: tokens.type.body.size,
    color: theme.textMuted,
  },
  cta: {
    marginTop: tokens.space.lg,
    minHeight: tokens.MIN_TOUCH_TARGET,
    backgroundColor: theme.accent,
    borderRadius: tokens.radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaDisabled: { opacity: 0.5 },
  ctaText: {
    fontSize: tokens.type.body.size,
    fontWeight: "700",
    color: theme.onAccent,
  },
  ghost: {
    marginTop: tokens.space.sm,
    minHeight: tokens.MIN_TOUCH_TARGET,
    alignItems: "center",
    justifyContent: "center",
  },
  ghostText: { fontSize: tokens.type.body.size, color: theme.textMuted },
  call: {
    marginTop: tokens.space.sm,
    minHeight: tokens.MIN_TOUCH_TARGET,
    borderRadius: tokens.radius.md,
    borderWidth: 2,
    borderColor: theme.textStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  callText: {
    fontSize: tokens.type.body.size,
    fontWeight: "700",
    color: theme.textStrong,
  },
  cancelText: { fontSize: tokens.type.body.size, color: theme.danger },
  earnings: {
    marginTop: tokens.space.md,
    padding: tokens.space.md,
    borderRadius: tokens.radius.md,
    backgroundColor: theme.surfaceRaised,
  },
  earningsTitle: {
    fontSize: tokens.type.label.size,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: theme.textMuted,
    marginBottom: tokens.space.sm,
  },
  earningsRow: { flexDirection: "row", justifyContent: "space-between" },
  earningsCell: { flex: 1 },
  earningsValue: {
    fontSize: tokens.type.body.size,
    fontWeight: "700",
    color: theme.textStrong,
  },
  earningsNet: { color: theme.success },
  earningsLabel: { fontSize: tokens.type.label.size, color: theme.textMuted },
});
