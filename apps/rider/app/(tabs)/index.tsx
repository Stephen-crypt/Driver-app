import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { ActivityIndicator, Alert, Linking, StyleSheet, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Banner,
  Button,
  Chip,
  FloatButton,
  GeraMap,
  Paper,
  Row,
  SlideToConfirm,
  Stat,
  StatRow,
  Txt,
  VestPatch,
  c,
  money,
  shadow,
  space,
} from "@gera/kit";
import {
  EMERGENCY_NUMBER,
  acceptOffer,
  advanceTrip,
  cancelTrip,
  canGoOnline,
  completeTrip,
  declineOffer,
  getActiveTrip,
  getCashHeld,
  getEarningsSince,
  getLiveOffer,
  getOpenShift,
  getPresence,
  getRiderProfile,
  getTripContact,
  getTripPoints,
  getWaitStatus,
  heartbeat,
  publishTrackPoint,
  raiseSos,
  registerDeviceToken,
  reportNoShow,
  setPresence,
  startOfToday,
  watchOffers,
  watchRiderTrips,
  type ActiveTrip,
  type CompleteTripResult,
  type Earnings,
  type LiveOffer,
  type RiderProfile,
  type Shift,
  type TripPoints,
  type VehicleClass,
  type WaitStatus,
} from "@gera/data";
import { supabase } from "../../src/lib/supabase";
import { registerForPush } from "../../src/lib/push";
import * as loc from "../../src/lib/location";
import { useSession } from "../../src/lib/session";
import { OfferSheet } from "../../src/today/OfferSheet";
import { PinSheet } from "../../src/today/PinSheet";
import { ReceiptSheet } from "../../src/today/ReceiptSheet";
import { TripPanel } from "../../src/today/TripPanel";
import { duration, useNow } from "../../src/today/useNow";

const CLASS_NAME: Record<string, string> = { moto: "Moto", cab: "Cab", cab_xl: "Cab XL" };

export default function Today() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { riderId } = useSession();

  const [profile, setProfile] = useState<RiderProfile | null>(null);
  const [shift, setShift] = useState<Shift | null | undefined>(undefined);
  const [online, setOnline] = useState(false);
  const [vehicleClass, setVehicleClass] = useState<VehicleClass>("moto");
  const [cashHeld, setCashHeld] = useState<number | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [earnings, setEarnings] = useState<Earnings | null>(null);

  const [here, setHere] = useState<loc.Coords | null>(null);
  const [gpsDenied, setGpsDenied] = useState(false);
  const hereRef = useRef<loc.Coords | null>(null);
  hereRef.current = here;

  const [offer, setOffer] = useState<LiveOffer | null>(null);
  const [trip, setTrip] = useState<ActiveTrip | null>(null);
  const [points, setPoints] = useState<TripPoints | null>(null);
  const [passengerName, setPassengerName] = useState("your passenger");
  const [wait, setWait] = useState<{ status: WaitStatus; readAt: number } | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [receipt, setReceipt] = useState<CompleteTripResult | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paperH, setPaperH] = useState(320);

  const now = useNow(1000, trip?.state === "arrived" || shift != null);

  // ---- load ----------------------------------------------------------------

  // Re-read on every focus: the shift is started and ended on other screens,
  // and coming back to a Today that still says "Start your shift" after you
  // just started one reads as the app not working.
  const load = useCallback(async () => {
    if (!riderId) return;
    try {
      const [prof, sh, pres, cash, allowed, earned] = await Promise.all([
        getRiderProfile(supabase, riderId),
        getOpenShift(supabase, riderId),
        getPresence(supabase, riderId),
        getCashHeld(supabase, riderId),
        canGoOnline(supabase, riderId),
        getEarningsSince(supabase, riderId, startOfToday()),
      ]);
      setProfile(prof);
      setShift(sh);
      setCashHeld(cash);
      setEarnings(earned);
      if (prof.vehicle) setVehicleClass(prof.vehicle.vehicleClass as VehicleClass);
      setOnline(pres ? pres.status !== "offline" : false);
      // Three things gate going online and each has a different fix. Name the
      // right one - "you can't go online" alone sends a rider to the wrong desk.
      setBlocked(
        allowed || !sh
          ? null
          : !prof.vehicle
            ? "No vehicle is assigned to you. Speak to the fleet office."
            : "You're carrying too much company cash. Hand it in before going online.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your day.");
    }
  }, [riderId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // ---- push ----------------------------------------------------------------
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

  // ---- location --------------------------------------------------------------
  // Asked for once, up front: a rider who goes online without it is invisible
  // to dispatch, which looks like "the app gives me no work".
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
      sub = await loc.watch((p) => active && setHere(p));
      // Left the screen while the watcher was starting: cleanup has already
      // run, so stop it here or it runs - and drains the battery - for good.
      if (!active) sub.remove();
    })();
    return () => {
      active = false;
      sub?.remove();
    };
  }, []);

  // ---- online: offers, trips, heartbeat --------------------------------------
  const refreshWork = useCallback(async () => {
    if (!riderId) return;
    try {
      const [o, t] = await Promise.all([getLiveOffer(supabase, riderId), getActiveTrip(supabase, riderId)]);
      setOffer(o);
      setTrip(t);
    } catch {
      // A dropped read is not a dropped shift.
    }
  }, [riderId]);

  // A trip already in hand keeps being watched even offline: a rider who went
  // offline mid-trip must still be able to finish it.
  useEffect(() => {
    if (!riderId) return;
    void refreshWork();
    const trips = watchRiderTrips(supabase, riderId, refreshWork);
    return () => trips.unsubscribe();
  }, [riderId, refreshWork]);

  useEffect(() => {
    if (!riderId || !online) return;
    // Offers arrive over realtime, not polling: an offer lives fifteen seconds.
    const offers = watchOffers(supabase, riderId, refreshWork);
    // The heartbeat keeps the rider in the dispatch index; presence goes stale
    // in thirty seconds.
    const beat = setInterval(() => {
      const at = hereRef.current;
      if (at) heartbeat(supabase, riderId, at).catch(() => {});
    }, 3000);
    // Backstop for a websocket that died quietly.
    const backstop = setInterval(refreshWork, 15000);
    return () => {
      offers.unsubscribe();
      clearInterval(beat);
      clearInterval(backstop);
    };
  }, [riderId, online, refreshWork]);

  // ---- the trip in hand ------------------------------------------------------
  useEffect(() => {
    setPoints(null);
    setPassengerName("your passenger");
    if (!trip) return;
    let active = true;
    getTripPoints(supabase, trip.id)
      .then((p) => active && setPoints(p))
      .catch(() => {});
    getTripContact(supabase, trip.id)
      .then((ct) => active && ct?.displayName && setPassengerName(ct.displayName))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [trip?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setWait(null);
    if (!trip || trip.state !== "arrived") return;
    let active = true;
    const read = () =>
      getWaitStatus(supabase, trip.id)
        .then((s) => active && s && setWait({ status: s, readAt: Date.now() }))
        .catch(() => {});
    void read();
    // Re-synced now and then; the clock itself runs locally between reads.
    const id = setInterval(read, 30_000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [trip?.id, trip?.state]); // eslint-disable-line react-hooks/exhaustive-deps

  // Publish position while a trip is live - it is what the passenger watches.
  useEffect(() => {
    if (!trip) return;
    const send = () => {
      const at = hereRef.current;
      if (at) publishTrackPoint(supabase, trip.id, at).catch(() => {});
    };
    send();
    const id = setInterval(send, 5000);
    return () => clearInterval(id);
  }, [trip?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- actions ---------------------------------------------------------------
  const run = async (fn: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : fallback);
    } finally {
      setBusy(false);
    }
  };

  const goOnline = () =>
    run(async () => {
      if (!riderId) return;
      const at = hereRef.current;
      if (!at) throw new Error("Waiting for your location. Turn on GPS and try again.");
      if (!(await canGoOnline(supabase, riderId))) {
        await load();
        return;
      }
      await setPresence(supabase, riderId, { status: "online", at, vehicleClass });
      setOnline(true);
    }, "Could not go online.");

  const goOffline = () =>
    run(async () => {
      if (!riderId) return;
      await setPresence(supabase, riderId, {
        status: "offline",
        at: hereRef.current ?? loc.KIGALI_FALLBACK,
        vehicleClass,
      });
      setOnline(false);
      setOffer(null);
    }, "Could not go offline.");

  const accept = () =>
    run(async () => {
      if (!offer) return;
      try {
        await acceptOffer(supabase, offer.offerId);
      } catch {
        setOffer(null);
        throw new Error("That trip is gone. Someone else took it.");
      }
      setOffer(null);
      await refreshWork();
    }, "Could not accept.");

  const pass = () => {
    if (!offer) return;
    const id = offer.offerId;
    setOffer(null);
    declineOffer(supabase, id).catch(() => {});
  };

  const arrive = () =>
    run(async () => {
      if (!trip) return;
      await advanceTrip(supabase, trip.id, "arrived");
      await refreshWork();
    }, "Could not update the trip.");

  const finish = () =>
    run(async () => {
      if (!trip || !riderId) return;
      // Real travelled distance arrives with navigation; until then the quoted
      // distance is what the fare was agreed on, so it is what is charged.
      const result = await completeTrip(supabase, {
        tripId: trip.id,
        actualDistanceM: trip.quotedDistanceM ?? 0,
        idempotencyKey: `complete-${trip.id}`,
      });
      setReceipt(result);
      setTrip(null);
      void load();
    }, "Could not finish the trip.");

  const noShow = () => {
    if (!trip) return;
    Alert.alert(
      `${passengerName} didn't come?`,
      "This ends the trip and records that you waited. Call them first if you haven't.",
      [
        { text: "Keep waiting", style: "cancel" },
        {
          text: "End trip",
          style: "destructive",
          onPress: () =>
            run(async () => {
              await reportNoShow(supabase, trip.id, "Passenger could not be found", hereRef.current);
              setTrip(null);
            }, "Could not report that."),
        },
      ],
    );
  };

  const callPassenger = async () => {
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
  };

  // Hands off to Google Maps, which every rider already has and trusts, with
  // the real destination. The old console passed the rider's OWN position here
  // under the label "Pickup" - it navigated you to where you already were.
  const navigate = (to: loc.Coords) => {
    void Linking.openURL(
      `https://www.google.com/maps/dir/?api=1&destination=${to.lat},${to.lng}&travelmode=driving`,
    );
  };

  const cancel = () => {
    if (!trip) return;
    Alert.alert("Cancel this trip?", "Cancelling after accepting affects your standing.", [
      { text: "Keep it", style: "cancel" },
      {
        text: "Cancel trip",
        style: "destructive",
        onPress: () =>
          run(async () => {
            await cancelTrip(supabase, trip.id, "rider");
            setTrip(null);
          }, "Could not cancel."),
      },
    ]);
  };

  const sos = () => {
    Alert.alert("Emergency", `We'll record where you are. If you're in danger, call ${EMERGENCY_NUMBER}.`, [
      { text: "Close", style: "cancel" },
      {
        text: "Record alert",
        onPress: async () => {
          const at = hereRef.current;
          try {
            await raiseSos(supabase, {
              ...(trip ? { tripId: trip.id } : {}),
              ...(at ? { at } : {}),
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
    ]);
  };

  // ---- map -------------------------------------------------------------------
  const markers = [
    ...(here ? [{ id: "me", at: here, kind: "me" as const }] : []),
    ...(trip && points
      ? trip.state === "in_progress"
        ? [{ id: "dropoff", at: points.dropoff, kind: "dropoff" as const, tag: trip.dropoffLabel }]
        : [{ id: "pickup", at: points.pickup, kind: "pickup" as const, tag: trip.pickupLabel }]
      : []),
  ];
  const target = trip && points ? (trip.state === "in_progress" ? points.dropoff : points.pickup) : null;

  // ---- sheet content -----------------------------------------------------------
  let body: ReactElement;
  if (shift === undefined || !riderId) {
    body = <ActivityIndicator color={c.accent} style={styles.spin} />;
  } else if (trip) {
    body = (
      <TripPanel
        trip={trip}
        points={points}
        here={here}
        passengerName={passengerName}
        wait={wait}
        now={now}
        busy={busy}
        error={error}
        onArrive={arrive}
        onOpenPin={() => setPinOpen(true)}
        onFinish={finish}
        onNoShow={noShow}
        onCall={callPassenger}
        onNavigate={navigate}
        onCancel={cancel}
      />
    );
  } else if (!shift) {
    body = (
      <View style={styles.block}>
        <Txt v="title">Start your shift</Txt>
        <Txt v="body" tone="muted">
          A quick check of your {CLASS_NAME[profile?.vehicle?.vehicleClass ?? "moto"]?.toLowerCase() ?? "vehicle"} first. It takes a minute.
        </Txt>
        {profile?.vehicle ? (
          <View style={styles.vehicle}>
            <Row
              title={profile.vehicle.plate}
              subtitle={`${CLASS_NAME[profile.vehicle.vehicleClass] ?? "Vehicle"} assigned to you`}
              icon="bicycle"
            />
          </View>
        ) : (
          <Banner tone="warn" icon="alert-circle">
            No vehicle is assigned to you yet. Speak to the fleet office.
          </Banner>
        )}
        {error ? <Banner tone="bad" icon="alert-circle">{error}</Banner> : null}
        <Button
          label="Start shift"
          icon="shield-checkmark"
          onPress={() => router.push("/shift/start")}
          disabled={!profile?.vehicle}
        />
      </View>
    );
  } else {
    body = (
      <View style={styles.block}>
        <View style={styles.statusRow}>
          {online ? <Chip label="Online" tone="good" dot /> : <Chip label="Offline" dot />}
          <Txt v="label" tone="muted">
            On shift {duration(shift.startedAt, now)}
          </Txt>
        </View>
        <Txt v="title">{online ? "Trips come to you" : "Ready when you are"}</Txt>
        <StatRow>
          <Stat label="Earned today" value={money(earnings?.earnedRwf ?? 0)} tone="good" />
          <Stat label="Trips" value={String(earnings?.trips ?? 0)} />
          <Stat label="Cash to hand in" value={money(cashHeld ?? 0)} />
        </StatRow>
        {gpsDenied ? (
          <Banner tone="warn" icon="location">
            Location is off. Dispatch can't find you without it.
          </Banner>
        ) : null}
        {blocked ? <Banner tone="warn" icon="wallet">{blocked}</Banner> : null}
        {error ? <Banner tone="bad" icon="alert-circle">{error}</Banner> : null}
        {online ? (
          <SlideToConfirm label="Slide to go offline" tone="dark" icon="pause" onConfirm={goOffline} disabled={busy} />
        ) : (
          <SlideToConfirm
            label="Slide to go online"
            tone="good"
            icon="power"
            onConfirm={goOnline}
            disabled={busy || !!blocked}
          />
        )}
        {!online ? (
          <View style={styles.pair}>
            <Button label="Report a problem" icon="construct" variant="secondary" compact style={styles.flex} onPress={() => router.push("/report")} />
            <Button label="End shift" icon="flag" variant="secondary" compact style={styles.flex} onPress={() => router.push("/shift/end")} />
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <GeraMap
        center={here ?? loc.KIGALI_FALLBACK}
        markers={markers}
        route={here && target ? [here, target] : undefined}
        fit={!!target}
        topInset={insets.top + 60}
        bottomInset={paperH}
      />

      <View style={[styles.top, { top: insets.top + space.sm }]}>
        <View style={styles.idCard}>
          {profile?.vehicle?.vestNumber ? (
            <VestPatch value={profile.vehicle.vestNumber} size="sm" />
          ) : null}
          <View>
            <Txt v="bodyStrong" lines={1}>
              {profile?.firstName ?? " "}
            </Txt>
            <Txt v="caption" tone="muted" lines={1}>
              {profile?.vehicle?.plate ?? "No vehicle"}
              {profile?.rating ? ` · ★ ${profile.rating.toFixed(1)}` : ""}
            </Txt>
          </View>
        </View>
        <FloatButton icon="warning" label="Emergency" tone="bad" onPress={sos} />
      </View>

      <View style={styles.sheet} onLayout={(e) => setPaperH(e.nativeEvent.layout.height)}>
        <Paper padBottom={false}>{body}</Paper>
      </View>

      <OfferSheet offer={trip ? null : offer} here={here} busy={busy} onAccept={accept} onPass={pass} />
      {trip ? (
        <PinSheet
          tripId={trip.id}
          passengerName={passengerName}
          visible={pinOpen}
          onClose={() => setPinOpen(false)}
          onStarted={() => {
            setPinOpen(false);
            void refreshWork();
          }}
        />
      ) : null}
      <ReceiptSheet result={receipt} onDone={() => setReceipt(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  root: { flex: 1, backgroundColor: c.surface },
  top: {
    position: "absolute",
    left: space.md,
    right: space.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  idCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingVertical: 6,
    paddingLeft: 6,
    paddingRight: space.md,
    borderRadius: 14,
    backgroundColor: c.surfaceRaised,
    maxWidth: "75%",
    ...shadow.float,
  },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0 },
  block: { gap: space.md },
  spin: { marginVertical: space.xl },
  statusRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  vehicle: { marginHorizontal: -space.md },
  pair: { flexDirection: "row", gap: space.sm },
});
