import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { Linking, StyleSheet, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import {
  Banner,
  BellButton,
  Button,
  Chip,
  FloatButton,
  NovaMap,
  useRoad,
  type RoadFetch,
  LiveDot,
  Paper,
  PAPER_PEEK,
  Press,
  Skeleton,
  SlideToConfirm,
  StatTile,
  Swap,
  Txt,
  VehicleArt,
  VestPatch,
  c,
  font,
  money,
  notify,
  radius,
  shadow,
  space,
  useOverlay,
  useSettledHeight,
  ChatSheet,
  ReasonSheet,
} from "@nova/kit";
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
  getRoute,
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
  QUICK_REPLIES,
  countUnread,
  watchInbox,
} from "@nova/data";
import { supabase } from "../../src/lib/supabase";
import { registerForPush } from "../../src/lib/push";
import * as loc from "../../src/lib/location";
import { useSession } from "../../src/lib/session";
import { OfferSheet } from "../../src/today/OfferSheet";
import { PinSheet } from "../../src/today/PinSheet";
import { ReceiptSheet } from "../../src/today/ReceiptSheet";
import { TripPanel } from "../../src/today/TripPanel";
import { duration, useNow } from "../../src/today/useNow";
import { useTripChat } from "../../src/lib/chat";

// The router, for the road to the pickup and then the drop-off. Stable, so
// the hook never re-asks just because the screen re-rendered.
const fetchRoad: RoadFetch = (a, b) => getRoute(supabase, a, b);

const CLASS_NAME: Record<string, string> = { moto: "Moto", cab: "Cab", cab_xl: "Cab XL" };

// A cancellation after accepting counts against a rider, so the reason is
// recorded with it - a passenger who never answers is not the rider's fault.
const RIDER_CANCEL_REASONS = [
  { label: "The passenger isn't answering", icon: "call" },
  { label: "The pickup point is wrong", icon: "location" },
  { label: "A problem with the vehicle", icon: "construct" },
  { label: "The passenger asked me to cancel", icon: "person" },
] as const;

export default function Today() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { riderId } = useSession();
  const overlay = useOverlay();

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
  const [chatOpen, setChatOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paperH, onPaperLayout] = useSettledHeight(320);
  // Pulled down, the sheet leaves a strip and the map gets the room.
  const [folded, setFolded] = useState(false);

  const now = useNow(1000, trip?.state === "arrived" || shift != null);

  const chat = useTripChat(trip?.id ?? null, riderId ?? null, !!trip);

  // The number on the bell: read on focus, and again whenever one lands.
  useFocusEffect(
    useCallback(() => {
      if (!riderId) return;
      let active = true;
      const read = () => countUnread(supabase).then((n) => active && setUnread(n)).catch(() => {});
      read();
      const w = watchInbox(supabase, riderId, read);
      return () => {
        active = false;
        w.unsubscribe();
      };
    }, [riderId]),
  );
  const lastUnread = useRef(0);
  useEffect(() => {
    if (chatOpen) void chat.markRead();
  }, [chatOpen, chat.lines.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!chatOpen && chat.unread > lastUnread.current) {
      const last = chat.lines[chat.lines.length - 1];
      if (last && !last.mine) overlay.toast({ message: `${passengerName}: ${last.body}`, icon: "chatbubble" });
    }
    lastUnread.current = chat.unread;
  }, [chat.unread]); // eslint-disable-line react-hooks/exhaustive-deps

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
      } catch (e) {
        setOffer(null);
        // Say what actually happened. "Someone else took it" for every
        // failure sent the first live tester looking for a second rider
        // who did not exist.
        const why = e instanceof Error ? e.message : "";
        throw new Error(
          /offer_not_available/.test(why)
            ? "That offer ran out before it reached Nova, or went to another rider."
            : /illegal_transition|not_a_participant/.test(why)
              ? "This trip can't be accepted any more."
              : /network|fetch|timeout/i.test(why)
                ? "Couldn't reach Nova. Check your connection - the next offer will come through."
                : "Couldn't accept that trip. The next one will come to you.",
        );
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

  const noShow = async () => {
    if (!trip) return;
    const ok = await overlay.confirm({
      title: `${passengerName} didn't come?`,
      message: "This ends the trip and records how long you waited. Call them first if you haven't.",
      confirmLabel: "End the trip",
      cancelLabel: "Keep waiting",
      tone: "danger",
    });
    if (!ok) return;
    run(async () => {
      await reportNoShow(supabase, trip.id, "Passenger could not be found", hereRef.current);
      setTrip(null);
      overlay.toast({ message: "No-show recorded. You're free for the next trip.", tone: "good" });
    }, "Could not report that.");
  };

  // Starts a call and returns what went wrong, rather than showing it: the PIN
  // sheet is a modal, which sits above the toasts, so it says it itself.
  const startCall = async (): Promise<{ text: string; bad: boolean } | null> => {
    if (!trip) return null;
    try {
      const contact = await getTripContact(supabase, trip.id);
      if (!contact?.phone) return { text: "You can call once the trip is active.", bad: false };
      await Linking.openURL(`tel:${contact.phone}`);
      return null;
    } catch {
      return { text: "Couldn't start the call. Try again in a moment.", bad: true };
    }
  };

  const callPassenger = async () => {
    const problem = await startCall();
    if (problem) overlay.toast({ message: problem.text, tone: problem.bad ? "bad" : "neutral" });
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
    if (trip) setCancelOpen(true);
  };
  const cancelWith = (reason: string) => {
    if (!trip) return;
    setCancelOpen(false);
    void run(async () => {
      await cancelTrip(supabase, trip.id, "rider", reason);
      setTrip(null);
    }, "Could not cancel.");
  };

  const sos = () => {
    overlay.actions({
      title: "Emergency",
      message: "The control room sees your alert at once, with where you are and who you're carrying.",
      options: [
        {
          label: `Call ${EMERGENCY_NUMBER}`,
          hint: "Police, ambulance and fire. The control room is alerted too.",
          icon: "call",
          tone: "danger",
          onPress: () => {
            const at = hereRef.current;
            void raiseSos(supabase, { ...(trip ? { tripId: trip.id } : {}), ...(at ? { at } : {}) }).catch(() => {});
            void Linking.openURL(`tel:${EMERGENCY_NUMBER}`);
          },
        },
        {
          label: "Alert the control room",
          hint: "They call you back straight away.",
          icon: "shield-half",
          onPress: async () => {
            const at = hereRef.current;
            try {
              await raiseSos(supabase, {
                ...(trip ? { tripId: trip.id } : {}),
                ...(at ? { at } : {}),
              });
              notify("warning");
              overlay.toast({ message: "Alert sent. The control room will call you.", tone: "good", icon: "shield-checkmark" });
            } catch {
              overlay.toast({ message: `Couldn't send it. Call ${EMERGENCY_NUMBER} directly.`, tone: "bad" });
            }
          },
        },
        { label: "Report a problem", hint: "Not urgent: a fault, a hazard, a dispute", icon: "construct", onPress: () => router.push("/report") },
      ],
    });
  };

  // ---- map -------------------------------------------------------------------
  const markers = [
    // Online and free: the radar goes out from the rider, the same yellow
    // rings a passenger sees while looking for them.
    ...(here && online && !trip ? [{ id: "radar", at: here, kind: "radar" as const }] : []),
    ...(here ? [{ id: "me", at: here, kind: "me" as const }] : []),
    ...(trip && points
      ? trip.state === "in_progress"
        ? [{ id: "dropoff", at: points.dropoff, kind: "dropoff" as const, tag: trip.dropoffLabel }]
        : [{ id: "pickup", at: points.pickup, kind: "pickup" as const, tag: trip.pickupLabel }]
      : []),
  ];
  const target = trip && points ? (trip.state === "in_progress" ? points.dropoff : points.pickup) : null;
  // The road there, shortening as the rider goes. Turn-by-turn stays with
  // Google Maps behind the Navigate button; this is the at-a-glance picture.
  const ahead = useRoad(target ? here : null, target, fetchRoad);

  // ---- sheet content -----------------------------------------------------------
  // One panel per state. A new state swaps in and the sheet eases to its size.
  let stage: string;
  let body: ReactElement;
  if (shift === undefined || !riderId) {
    stage = "loading";
    body = (
      <View style={styles.block} accessibilityLabel="Loading your day" accessibilityRole="progressbar">
        <Skeleton width="40%" height={14} />
        <Skeleton width="72%" height={30} r={8} />
        <Skeleton height={64} r={32} />
      </View>
    );
  } else if (trip) {
    stage = `trip-${trip.state}`;
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
        onMessage={() => setChatOpen(true)}
        unread={chat.unread}
        onNavigate={navigate}
        onCancel={cancel}
      />
    );
  } else if (!shift) {
    stage = "no-shift";
    body = (
      <View style={styles.block}>
        <Txt v="title">Start your shift</Txt>
        <Txt v="body" tone="muted">
          A quick check of your {CLASS_NAME[profile?.vehicle?.vehicleClass ?? "moto"]?.toLowerCase() ?? "vehicle"} first. It takes a minute.
        </Txt>
        {profile?.vehicle ? (
          <View style={styles.vehicle}>
            <VehicleArt kind={profile.vehicle.vehicleClass} size={64} />
            <View style={styles.flex}>
              <Txt v="bodyStrong">{profile.vehicle.plate}</Txt>
              <Txt v="label" tone="muted">
                {CLASS_NAME[profile.vehicle.vehicleClass] ?? "Vehicle"} assigned to you
              </Txt>
            </View>
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
    stage = online ? "online" : "offline";
    body = (
      <View style={styles.block}>
        {online ? (
          // Yellow, like the vest: a rider glancing down from the road knows
          // from the colour alone that work can reach them.
          <View style={styles.slab}>
            <LiveDot tone="good" size={10} />
            <View style={styles.flex}>
              <Txt v="section" tone="onHighlight">
                You're online
              </Txt>
              <Txt v="label" tone="onHighlight" style={styles.soft} lines={1}>
                Keep the app open
              </Txt>
            </View>
            <View style={styles.clock}>
              <Txt v="caption" tone="onHighlight" style={styles.soft}>
                On shift
              </Txt>
              <Txt v="bodyStrong" tone="onHighlight" tabularNums>
                {duration(shift.startedAt, now)}
              </Txt>
            </View>
          </View>
        ) : (
          <>
            <View style={styles.statusRow}>
              <Chip label="Offline" dot />
              <Txt v="label" tone="muted" tabularNums>
                On shift {duration(shift.startedAt, now)}
              </Txt>
            </View>
            <Txt v="title">Ready when you are</Txt>
          </>
        )}
        <View style={styles.tiles}>
          <StatTile icon="trending-up" label="Earned today" value={money(earnings?.earnedRwf ?? 0)} ground={c.tintGreen} ink={c.success} tone="good" roll />
          <StatTile icon="navigate" label="Trips today" value={String(earnings?.trips ?? 0)} ground={c.tintBlue} ink={c.accent} roll />
          <StatTile icon="cash" label="Cash to hand in" value={money(cashHeld ?? 0)} ground={c.tintAmber} ink={c.warning} roll />
        </View>
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
      <NovaMap
        center={here ?? loc.KIGALI_FALLBACK}
        markers={markers}
        route={ahead?.path ?? (here && target ? [here, target] : undefined)}
        routeIsRoad={ahead ? true : undefined}
        fit={!!target}
        topInset={insets.top + 60}
        bottomInset={folded ? PAPER_PEEK : paperH}
      />

      <View style={[styles.top, { top: insets.top + space.sm }]} pointerEvents="box-none">
        <Press
          onPress={() => router.navigate("/me")}
          style={styles.idCard}
          accessibilityRole="button"
          accessibilityLabel={`${profile?.firstName ?? "You"}${profile?.vehicle?.plate ? `, ${profile.vehicle.plate}` : ""}, ${online ? "online" : "offline"}. Open your profile`}
        >
          {profile?.vehicle?.vestNumber ? <VestPatch value={profile.vehicle.vestNumber} size="sm" /> : null}
          <View style={styles.shrink}>
            <Txt v="bodyStrong" tone="onHero" lines={1}>
              {profile?.firstName ?? " "}
            </Txt>
            <View style={styles.idMeta}>
              <Txt v="caption" tone="onHeroMuted" lines={1}>
                {profile?.vehicle?.plate ?? "No vehicle"}
              </Txt>
              {profile?.rating ? (
                <View style={styles.rating}>
                  <Ionicons name="star" size={10} color={c.highlight} />
                  <Txt v="caption" tone="onHeroMuted" tabularNums>
                    {profile.rating.toFixed(1)}
                  </Txt>
                </View>
              ) : null}
            </View>
          </View>
          <View style={[styles.state, online && styles.stateOn]}>
            <View style={[styles.stateDot, online && styles.stateDotOn]} />
            <Txt v="caption" tone={online ? "onHighlight" : "onHeroMuted"} style={styles.stateText}>
              {online ? "Online" : trip ? "On a trip" : "Offline"}
            </Txt>
          </View>
        </Press>
        <View style={styles.topRight}>
          <BellButton count={unread} onPress={() => router.push("/inbox")} />
          <FloatButton icon="warning" label="Emergency" tone="bad" onPress={sos} />
        </View>
      </View>

      {/* box-none: folded, the sheet slides down inside this box, and the
          empty part of the box must let the map be touched. */}
      <View style={styles.sheet} onLayout={onPaperLayout} pointerEvents="box-none">
        <Paper padBottom={false} foldable foldKey={stage} onFold={setFolded}>
          <Swap id={stage}>{body}</Swap>
        </Paper>
      </View>

      <OfferSheet offer={trip ? null : offer} here={here} busy={busy} onAccept={accept} onPass={pass} />
      {trip ? (
        <PinSheet
          tripId={trip.id}
          passengerName={passengerName}
          visible={pinOpen}
          onClose={() => setPinOpen(false)}
          onCall={startCall}
          onStarted={() => {
            setPinOpen(false);
            void refreshWork();
          }}
        />
      ) : null}
      <ChatSheet
        visible={chatOpen}
        onClose={() => setChatOpen(false)}
        name={passengerName}
        lines={chat.lines}
        quickReplies={QUICK_REPLIES.rider}
        onSend={(t) => void chat.send(t).catch(() => overlay.toast({ message: "Couldn't send that. Try again.", tone: "bad" }))}
        sending={chat.sending}
        open={!!trip}
      />
      <ReasonSheet
        visible={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancel this trip?"
        message={`${passengerName} is waiting for you. Cancelling after accepting counts against your standing, so say why.`}
        reasons={RIDER_CANCEL_REASONS}
        confirmLabel="Cancel trip"
        keepLabel="Keep the trip"
        busy={busy}
        onConfirm={cancelWith}
      />
      <ReceiptSheet result={receipt} onDone={() => setReceipt(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1 },
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
    paddingRight: 8,
    borderRadius: 18,
    backgroundColor: c.hero,
    maxWidth: "80%",
    ...shadow.float,
  },
  state: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginLeft: space.xs,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: c.heroRaised,
  },
  stateOn: { backgroundColor: c.highlight },
  stateDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: c.onHeroMuted },
  stateDotOn: { backgroundColor: c.success },
  stateText: { fontFamily: font.semibold },
  tiles: { flexDirection: "row", gap: space.sm },
  topRight: { flexDirection: "row", alignItems: "center", gap: space.sm },
  idMeta: { flexDirection: "row", alignItems: "center", gap: space.sm },
  rating: { flexDirection: "row", alignItems: "center", gap: 3 },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0 },
  block: { gap: space.md },
  statusRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  slab: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.md + 2,
    borderRadius: radius.lg,
    backgroundColor: c.highlight,
  },
  soft: { opacity: 0.8 },
  clock: { alignItems: "flex-end" },
  vehicle: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.sm,
    paddingRight: space.md,
    borderRadius: radius.lg,
    backgroundColor: c.surfaceHigh,
  },
  pair: { flexDirection: "row", gap: space.sm },
});
