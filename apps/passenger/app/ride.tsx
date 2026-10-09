import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Linking, ScrollView, Share, StyleSheet, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Button,
  FloatButton,
  NovaMap,
  useRoad,
  type RoadFetch,
  ModalSheet,
  Paper,
  PAPER_PEEK,
  Swap,
  Txt,
  VEHICLE_NAME,
  VehicleArt,
  VehicleGlyph,
  VestPatch,
  c,
  notify,
  space,
  useOverlay,
  useSettledHeight,
  type MapMarker,
  type VehicleKind,
  ChatSheet,
  ReasonSheet,
} from "@nova/kit";
import {
  EMERGENCY_NUMBER,
  addDays,
  createRecurringSchedule,
  daysLabel,
  kigaliInstant,
  kigaliToday,
  scheduleTrip,
  whenLabel,
  cancelTrip,
  createTripFromQuote,
  getRidePin,
  getRiderCard,
  getRiderPosition,
  getRoute,
  getTrip,
  getTripContact,
  getTripPoints,
  getTripTotal,
  getWaitStatus,
  isTripLive,
  describePickup,
  raiseSos,
  rateTrip,
  requestQuote,
  isPromoUnavailable,
  PROMO_RAN_OUT,
  shareTripText,
  watchTrip,
  distanceBetween,
  type QuoteResult,
  type RiderCard,
  type RiderPosition,
  type RouteResult,
  type TripPoints,
  type TripSnapshot,
  type TripTotal,
  type WaitStatus,
  QUICK_REPLIES,
  ridersNearby,
  getTripEvents,
  type NearbyRiders,
  type TripEvent,
} from "@nova/data";
import { supabase } from "../src/lib/supabase";
import { goBack } from "../src/lib/nav";
import * as loc from "../src/lib/location";
import { CLASSES, Choose, type VehicleClass } from "../src/ride/Choose";
import { Ticket } from "../src/ride/Ticket";
import type { PromoChoice } from "../src/ride/PromoLine";
import { useSession } from "../src/lib/session";
import { useTripChat } from "../src/lib/chat";

// NOVA asks why. The reason goes on the trip's record, so a rider who is always
// "taking too long", or a pickup pin that is always wrong, both show up.
const PASSENGER_CANCEL_REASONS = [
  { label: "The rider is taking too long", icon: "time" },
  { label: "I booked by mistake", icon: "close-circle" },
  { label: "My pickup point is wrong", icon: "location" },
  { label: "I found another way", icon: "walk" },
] as const;
import { Assigned, Ended, Searching } from "../src/ride/Live";
import { Completed } from "../src/ride/Completed";
import { endDateOf, type BookingMode, type LaterPlan, type RegularPlan } from "../src/ride/When";

// The router, for the road a rider is on. Stable, so the hook never re-asks
// just because the screen re-rendered.
const fetchRoad: RoadFetch = (a, b) => getRoute(supabase, a, b);

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const num = (v: string | string[] | undefined) => {
  const n = Number(one(v));
  return Number.isFinite(n) && one(v) !== undefined ? n : null;
};

export default function Ride() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const { height } = useWindowDimensions();
  const modeParam = one(params.mode);
  const mode: BookingMode = modeParam === "later" || modeParam === "regular" ? modeParam : "now";
  const [later, setLater] = useState<LaterPlan>({ date: addDays(kigaliToday(), 1), time: null });
  const [regular, setRegular] = useState<RegularPlan>({
    days: [1, 2, 3, 4, 5],
    time: null,
    startDate: addDays(kigaliToday(), 1),
    weeks: 4,
  });
  // Set once a ride is booked ahead: what to tell the passenger instead of a
  // live trip, because there is not one yet.
  const [bookedAhead, setBookedAhead] = useState<{
    id: string;
    kind: "ride" | "regular";
    when: string;
    detail: string;
    amountRwf: number;
  } | null>(null);

  // Two ways in: a destination to book, or a trip id to resume.
  const resumeId = one(params.trip);
  const dropLat = num(params.lat);
  const dropLng = num(params.lng);
  const dropoff = dropLat !== null && dropLng !== null ? { lat: dropLat, lng: dropLng } : null;
  const dropLabel = one(params.label) ?? "Destination";

  const [pickup, setPickup] = useState<loc.Coords | null>(() => {
    const la = num(params.plat);
    const ln = num(params.plng);
    return la !== null && ln !== null ? { lat: la, lng: ln } : null;
  });
  const [pickupLabel, setPickupLabel] = useState(one(params.plabel) ?? "Current location");
  // Set on the destination screen when the pickup was moved there.
  const [pickupNote, setPickupNote] = useState(one(params.pnote) ?? "");
  // Pulled down, the sheet leaves a strip and the map gets the room.
  const [folded, setFolded] = useState(false);

  const [road, setRoad] = useState<RouteResult | null>(null);
  const [quotes, setQuotes] = useState<Partial<Record<VehicleClass, QuoteResult>>>({});
  // Which saved promo code the prices use; every change asks for new prices.
  const [promoChoice, setPromoChoice] = useState<PromoChoice>("best");
  const [quoteRound, setQuoteRound] = useState(0);
  // A tile on the home screen may have chosen the vehicle already.
  const [selected, setSelected] = useState<VehicleClass>(() => {
    const v = one(params.vehicle);
    return v === "cab" || v === "cab_xl" ? v : "moto";
  });

  const [trip, setTrip] = useState<TripSnapshot | null>(null);
  const [points, setPoints] = useState<TripPoints | null>(null);
  const [rider, setRider] = useState<RiderCard | null>(null);
  const [riderAt, setRiderAt] = useState<RiderPosition | null>(null);
  const [pin, setPin] = useState<string | null>(null);
  const [wait, setWait] = useState<{ status: WaitStatus; readAt: number } | null>(null);
  const [total, setTotal] = useState<TripTotal | null>(null);
  const [rated, setRated] = useState(false);
  const [now, setNow] = useState(Date.now());

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paperH, onPaperLayout] = useSettledHeight(420);
  const [riderSheet, setRiderSheet] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [nearby, setNearby] = useState<NearbyRiders[] | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [events, setEvents] = useState<TripEvent[]>([]);
  const sheetScroll = useRef<ScrollView>(null);
  const { userId } = useSession();
  const overlay = useOverlay();

  // ---- resuming ----------------------------------------------------------------
  useEffect(() => {
    if (!resumeId) return;
    getTrip(supabase, resumeId).then(setTrip).catch(() => setError("Could not load that trip."));
  }, [resumeId]);

  // ---- where the passenger is --------------------------------------------------
  // Only when booking and the home screen did not already have a fix.
  useEffect(() => {
    if (resumeId || pickup) return;
    let active = true;
    (async () => {
      if (!(await loc.requestPermission())) return;
      const at = await loc.getCurrent(8000);
      if (!active || !at) return;
      setPickup(at);
      void describePickup(supabase, at).then((l) => active && setPickupLabel(l));
    })();
    return () => {
      active = false;
    };
  }, [resumeId, pickup]);

  // ---- pricing -------------------------------------------------------------------
  const straightM = pickup && dropoff ? distanceBetween(pickup, dropoff) : 0;
  // Road distance when the router answers; straight-line otherwise. Kigali is
  // built on ridges, so the straight line under-reads - it is only a fallback.
  const distanceM = road?.distanceM ?? straightM;
  // A destination where the passenger already is has nothing to price.
  const samePlace = !!pickup && !!dropoff && straightM < 150;
  const durationS = road?.durationS ?? Math.max(60, Math.round(straightM / 7.5));

  useEffect(() => {
    if (trip || !pickup || !dropoff) return;
    let active = true;
    getRoute(supabase, pickup, dropoff)
      .then((r) => active && r && setRoad(r))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [trip, pickup?.lat, pickup?.lng, dropLat, dropLng]); // eslint-disable-line react-hooks/exhaustive-deps

  // Every class quoted at once, so each option carries its own locked price.
  useEffect(() => {
    if (trip || !pickup || !dropoff || distanceM <= 0 || samePlace) return;
    let active = true;
    // A code that ran out at booking says so while the new prices come in.
    setError((e) => (e === PROMO_RAN_OUT ? e : null));
    Promise.all(
      CLASSES.map((k) =>
        requestQuote(supabase, { vehicleClass: k.id, distanceM, durationS, pickup, dropoff, promo: promoChoice })
          .then((q) => [k.id, q] as const)
          .catch(() => null),
      ),
    ).then((rows) => {
      if (!active) return;
      const got = Object.fromEntries(rows.filter((r): r is NonNullable<typeof r> => r !== null));
      setQuotes(got);
      if (Object.keys(got).length === 0) setError("Could not get a price just now. Check your connection.");
    });
    return () => {
      active = false;
    };
  }, [trip, distanceM, durationS, promoChoice, quoteRound, samePlace]); // eslint-disable-line react-hooks/exhaustive-deps

  // Back to set the pickup somewhere else, keeping the destination: once it
  // is set, the destination screen comes straight back here with both ends.
  // Back to choose where to go, keeping the pickup.
  const changeDestination = () => {
    router.replace({
      pathname: "/destination",
      params: {
        ...(pickup ? { plat: String(pickup.lat), plng: String(pickup.lng), plabel: pickupLabel } : {}),
        ...(pickupNote.trim() ? { pnote: pickupNote.trim() } : {}),
        mode,
        ...(one(params.vehicle) ? { vehicle: one(params.vehicle) as string } : {}),
      },
    });
  };

  const changePickup = () => {
    if (!dropoff) return;
    router.replace({
      pathname: "/destination",
      params: {
        edit: "pickup",
        lat: String(dropoff.lat),
        lng: String(dropoff.lng),
        label: dropLabel,
        ...(one(params.note) ? { note: one(params.note) as string } : {}),
        ...(pickup ? { plat: String(pickup.lat), plng: String(pickup.lng), plabel: pickupLabel } : {}),
        ...(pickupNote.trim() ? { pnote: pickupNote.trim() } : {}),
        mode,
        ...(one(params.vehicle) ? { vehicle: one(params.vehicle) as string } : {}),
      },
    });
  };

  // ---- the live trip ---------------------------------------------------------------
  const live = trip ? isTripLive(trip.state) : false;

  const chat = useTripChat(trip?.id ?? null, userId, live && !!trip?.riderId);
  const lastUnread = useRef(0);
  useEffect(() => {
    if (chatOpen) void chat.markRead();
  }, [chatOpen, chat.lines.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // A message while the thread is closed shows as a toast, so it is not
  // missed behind the map.
  useEffect(() => {
    if (!chatOpen && chat.unread > lastUnread.current) {
      const last = chat.lines[chat.lines.length - 1];
      if (last && !last.mine) overlay.toast({ message: `${rider?.firstName ?? "Your rider"}: ${last.body}`, icon: "chatbubble" });
    }
    lastUnread.current = chat.unread;
  }, [chat.unread]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!trip || !live) return;
    const tripId = trip.id;
    const refresh = () => getTrip(supabase, tripId).then(setTrip).catch(() => {});
    const sub = watchTrip(supabase, tripId, refresh);
    const id = setInterval(refresh, 15000);
    return () => {
      sub.unsubscribe();
      clearInterval(id);
    };
  }, [trip?.id, live]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!trip) return;
    getTripPoints(supabase, trip.id).then(setPoints).catch(() => {});
  }, [trip?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!trip?.riderId || rider) return;
    getRiderCard(supabase, trip.id).then(setRider).catch(() => {});
  }, [trip?.riderId, trip?.id, rider]);

  // The rider moving on the map is what makes "on the way" believable.
  useEffect(() => {
    if (!trip?.riderId || !live) {
      setRiderAt(null);
      return;
    }
    const tripId = trip.id;
    let active = true;
    const read = () => getRiderPosition(supabase, tripId).then((p) => active && setRiderAt(p)).catch(() => {});
    void read();
    const id = setInterval(read, 4000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [trip?.id, trip?.riderId, live]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!trip || (trip.state !== "accepted" && trip.state !== "arrived")) return;
    getRidePin(supabase, trip.id).then(setPin).catch(() => {});
  }, [trip?.id, trip?.state]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setWait(null);
    if (!trip || trip.state !== "arrived") return;
    notify("warning");
    let active = true;
    const read = () =>
      getWaitStatus(supabase, trip.id)
        .then((s) => active && s && setWait({ status: s, readAt: Date.now() }))
        .catch(() => {});
    void read();
    const sync = setInterval(read, 30_000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      active = false;
      clearInterval(sync);
      clearInterval(tick);
    };
  }, [trip?.id, trip?.state]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (trip?.state !== "completed") return;
    notify("success");
    getTripTotal(supabase, trip.id).then(setTotal).catch(() => {});
  }, [trip?.id, trip?.state]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- actions -----------------------------------------------------------------------
  const book = useCallback(async () => {
    const quote = quotes[selected];
    if (!quote || !pickup || !dropoff) return;
    setBusy(true);
    setError(null);
    try {
      const args = {
        quoteId: quote.quoteId,
        pickup,
        pickupLabel,
        ...(pickupNote.trim() ? { pickupNote: pickupNote.trim() } : {}),
        dropoff,
        dropoffLabel: dropLabel,
      };
      if (mode === "later" && later.time) {
        const at = kigaliInstant(later.date, later.time);
        const booked = await scheduleTrip(supabase, { ...args, scheduledFor: at });
        notify("success");
        sheetScroll.current?.scrollTo({ y: 0, animated: false });
        setBookedAhead({
          id: booked.id,
          kind: "ride",
          when: whenLabel(at.toISOString()),
          detail: "We'll start finding your rider ten minutes before. It shows in Activity, where you can change the time or cancel.",
          amountRwf: quote.payRwf,
        });
      } else if (mode === "regular" && regular.time) {
        const schedule = await createRecurringSchedule(supabase, {
          ...args,
          days: regular.days,
          time: regular.time,
          startDate: regular.startDate,
          endDate: endDateOf(regular),
        });
        notify("success");
        sheetScroll.current?.scrollTo({ y: 0, animated: false });
        setBookedAhead({
          id: schedule.id,
          kind: "regular",
          when: `${daysLabel(regular.days)} at ${regular.time}`,
          detail: "Each ride is booked a week ahead and shows in Activity, where you can skip a day or cancel the lot.",
          amountRwf: quote.amountRwf,
        });
      } else {
        const created = await createTripFromQuote(supabase, args);
        setTrip(await getTrip(supabase, created.id));
      }
    } catch (e) {
      if (isPromoUnavailable(e)) {
        // The code ran out between the price and the booking: price again
        // with whatever else fits, and say why the price changed.
        setError(PROMO_RAN_OUT);
        setQuotes({});
        setPromoChoice("best");
        setQuoteRound((r) => r + 1);
        return;
      }
      setError(
        e instanceof Error && mode !== "now"
          ? e.message
          : "Could not book that ride. The price may have expired - pick again.",
      );
    } finally {
      setBusy(false);
    }
  }, [quotes, selected, pickup, dropoff, pickupLabel, pickupNote, dropLabel, mode, later, regular]);

  const call = async () => {
    if (!trip) return;
    try {
      const contact = await getTripContact(supabase, trip.id);
      if (!contact?.phone) {
        overlay.toast("You can call your rider once they've accepted.");
        return;
      }
      await Linking.openURL(`tel:${contact.phone}`);
    } catch {
      overlay.toast({ message: "Couldn't start the call. Try again in a moment.", tone: "bad" });
    }
  };

  const cancelWith = async (reason: string) => {
    if (!trip) return;
    setBusy(true);
    try {
      await cancelTrip(supabase, trip.id, "passenger", reason);
      setTrip(await getTrip(supabase, trip.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not cancel.");
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    if (trip) setCancelOpen(true);
  };

  const share = async () => {
    if (!trip) return;
    try {
      await Share.share({
        message: shareTripText({
          pickupLabel: trip.pickupLabel,
          dropoffLabel: trip.dropoffLabel,
          riderName: rider?.firstName ?? null,
          plate: rider?.plate ?? null,
          etaSeconds: tracked?.etaSeconds ?? null,
        }),
      });
    } catch {
      // The passenger dismissed the share sheet.
    }
  };

  const sos = () => {
    overlay.actions({
      title: "Safety",
      message: `Nova's control room sees an alert the moment you send it, with where you are and who you're with.`,
      options: [
        {
          label: `Call ${EMERGENCY_NUMBER}`,
          hint: "Police, ambulance and fire. We alert the control room too.",
          icon: "call",
          tone: "danger",
          onPress: () => {
            // With where the trip is, like the alert below: the control room
            // may reach the scene before the emergency services do.
            void raiseSos(supabase, {
              ...(trip ? { tripId: trip.id } : {}),
              ...(riderAt ? { at: { lng: riderAt.lng, lat: riderAt.lat } } : {}),
            }).catch(() => {});
            void Linking.openURL(`tel:${EMERGENCY_NUMBER}`);
          },
        },
        {
          label: "Alert the control room",
          hint: "They call you back and can see this trip live.",
          icon: "shield-half",
          onPress: async () => {
            try {
              await raiseSos(supabase, {
                ...(trip ? { tripId: trip.id } : {}),
                ...(riderAt ? { at: { lng: riderAt.lng, lat: riderAt.lat } } : {}),
              });
              notify("warning");
              overlay.toast({ message: "Alert sent. The control room will call you.", tone: "good", icon: "shield-checkmark" });
            } catch {
              overlay.toast({ message: `Couldn't send it. Call ${EMERGENCY_NUMBER} directly.`, tone: "bad" });
            }
          },
        },
        { label: "Share this trip", hint: "Send your route, rider and plate to someone.", icon: "share-social", onPress: () => void share() },
      ],
    });
  };

  // ---- map -------------------------------------------------------------------------
  const from = points?.pickup ?? pickup;
  const to = points?.dropoff ?? dropoff;
  const searching = trip?.state === "requested" || trip?.state === "offered";

  // The trip's steps, re-read as it moves on, for the times on the tracker.
  useEffect(() => {
    if (!trip) return;
    let active = true;
    getTripEvents(supabase, trip.id)
      .then((e) => active && setEvents(e))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [trip?.id, trip?.state]); // eslint-disable-line react-hooks/exhaustive-deps

  // While choosing, how far the closest free rider of each kind is.
  useEffect(() => {
    if (trip || !from) return;
    let active = true;
    ridersNearby(supabase, from)
      .then((n) => active && setNearby(n))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [trip === null, from?.lat, from?.lng]); // eslint-disable-line react-hooks/exhaustive-deps
  // The road the rider is on: to the pickup while they come, to the drop-off
  // once you are aboard. Its time replaces the straight-line guess, and the
  // line shortens behind the rider as they move.
  const heading = trip && riderAt ? (trip.state === "accepted" ? from : trip.state === "in_progress" ? to : null) : null;
  const ahead = useRoad(heading ? riderAt : null, heading, fetchRoad);
  const tracked: RiderPosition | null = riderAt && ahead ? { ...riderAt, etaSeconds: ahead.remainingS } : riderAt;

  const markers = useMemo(() => {
    const m: MapMarker[] = [];
    // While a rider is being found, the pickup sends out the radar.
    if (from && searching) m.push({ id: "radar", at: from, kind: "radar" });
    // The pickup says how long until the rider is there, while they are coming.
    const onTheWay = trip?.state === "accepted" && tracked?.etaSeconds;
    const pickupTag = onTheWay ? `Pickup, ${Math.max(1, Math.round((tracked?.etaSeconds ?? 60) / 60))} min` : "Pickup";
    // While the rider comes, the map is the rider, the road and the pickup -
    // the drop-off would zoom it out until the road is a hair. Once aboard,
    // the pickup is behind you and only the drop-off matters.
    const coming = trip?.state === "accepted" || trip?.state === "arrived";
    const aboard = trip?.state === "in_progress";
    if (from && !aboard) m.push({ id: "pickup", at: from, kind: trip ? "pickup" : "me", tag: trip ? pickupTag : undefined });
    if (to && !coming) m.push({ id: "dropoff", at: to, kind: "dropoff", tag: trip ? undefined : dropLabel });
    if (riderAt) m.push({ id: "rider", at: riderAt, kind: "rider", tag: rider?.vestNumber ?? "" });
    return m;
  }, [from?.lat, from?.lng, to?.lat, to?.lng, riderAt?.lat, riderAt?.lng, rider?.vestNumber, trip === null, dropLabel, searching, trip?.state, tracked?.etaSeconds]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- sheet ---------------------------------------------------------------------------
  // Each stage is its own panel. When the stage changes, the old panel fades
  // down and out, the new one rises in, and the sheet eases to its height.
  let stage: string;
  let body;
  if (bookedAhead) {
    stage = "booked";
    body = (
      <View style={styles.booked}>
        <Ticket
          id={bookedAhead.id}
          kind={bookedAhead.kind}
          when={bookedAhead.when}
          from={pickupLabel}
          to={dropLabel}
          vehicle={selected}
          amountRwf={bookedAhead.amountRwf}
        />
        <Txt v="label" tone="muted">
          {bookedAhead.detail}
        </Txt>
        <Button label="See upcoming rides" onPress={() => router.replace("/activity")} />
        <Button label="Done" variant="quiet" compact onPress={() => router.replace("/")} />
      </View>
    );
  } else if (!trip) {
    stage = "choose";
    body = (
      <Choose
        mode={mode}
        later={later}
        onLater={setLater}
        regular={regular}
        onRegular={setRegular}
        destination={dropLabel}
        pickupLabel={pickupLabel}
        quotes={quotes}
        selected={selected}
        onSelect={setSelected}
        pickupNote={pickupNote}
        onPickupNote={setPickupNote}
        durationS={road?.durationS ?? null}
        busy={busy}
        error={pickup ? error : "We need your location to send a rider. Turn on location and try again."}
        canBook={!!pickup}
        onBook={book}
        nearby={nearby}
        onChangePickup={changePickup}
        samePlace={samePlace}
        onChangeDestination={changeDestination}
        promoChoice={promoChoice}
        onPromoChoice={(next) => {
          // The old prices go at once: Book must not take a quote that still
          // carries the code the passenger just turned off.
          setQuotes({});
          setPromoChoice(next);
          setQuoteRound((r) => r + 1);
        }}
      />
    );
  } else if (trip.state === "requested" || trip.state === "offered") {
    stage = "searching";
    body = <Searching onCancel={cancel} busy={busy} vehicle={selected} from={trip.pickupLabel} to={trip.dropoffLabel} />;
  } else if (live) {
    stage = "live";
    body = (
      <Assigned
        trip={trip}
        rider={rider}
        riderAt={tracked}
        pin={pin}
        wait={wait}
        now={now}
        busy={busy}
        onCall={call}
        onMessage={() => setChatOpen(true)}
        unread={chat.unread}
        onSos={sos}
        onCancel={cancel}
        onRider={() => setRiderSheet(true)}
        events={events}
      />
    );
  } else if (trip.state === "completed") {
    stage = "completed";
    body = (
      <Completed
        total={total}
        quoted={trip.quotedAmountRwf !== null ? trip.quotedAmountRwf - trip.promoDiscountRwf : null}
        riderName={rider?.firstName ?? "your rider"}
        destination={trip.dropoffLabel}
        rated={rated}
        onRate={async (stars, comment) => {
          try {
            await rateTrip(supabase, trip.id, stars, comment || undefined);
            setRated(true);
          } catch {
            setError("Could not save your rating.");
          }
        }}
        onDone={() => router.replace("/")}
      />
    );
  } else {
    stage = `ended-${trip.state}`;
    body = <Ended state={trip.state} onAgain={() => router.replace("/")} />;
  }

  return (
    <View style={styles.root}>
      <NovaMap
        center={from ?? loc.KIGALI_FALLBACK}
        markers={markers}
        route={
          from && to && (!trip || trip.state === "requested" || trip.state === "offered")
            ? road && road.path.length > 1
              ? road.path
              : [from, to]
            : ahead?.path
        }
        routeIsRoad={ahead ? true : undefined}
        fit={markers.length > 1}
        topInset={insets.top + 56}
        bottomInset={folded ? PAPER_PEEK : paperH}
      />
      {!trip || !live ? (
        <FloatButton
          icon={trip ? "close" : "arrow-back"}
          label={trip ? "Close" : "Back"}
          onPress={() => (trip ? router.replace("/") : goBack(router))}
          style={[styles.back, { top: insets.top + space.sm }]}
        />
      ) : null}
      {/* box-none: folded, the sheet slides down inside this box, and the
          empty part of the box must let the map be touched. */}
      <View style={styles.sheet} onLayout={onPaperLayout} pointerEvents="box-none">
        <Paper foldable foldKey={stage} onFold={setFolded}>
          {/* Booking ahead adds a day and time picker; on a short phone the
              sheet would push the Book button off the screen without this. */}
          <ScrollView
            ref={sheetScroll}
            style={{ maxHeight: height * 0.74 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            bounces={false}
          >
            <Swap id={stage}>{body}</Swap>
          </ScrollView>
        </Paper>
      </View>

      <ChatSheet
        visible={chatOpen}
        onClose={() => setChatOpen(false)}
        name={rider?.firstName ?? "Your rider"}
        lines={chat.lines}
        quickReplies={QUICK_REPLIES.passenger}
        onSend={(t) => void chat.send(t).catch(() => overlay.toast({ message: "Couldn't send that. Try again.", tone: "bad" }))}
        sending={chat.sending}
        open={live && !!trip?.riderId}
      />

      <ReasonSheet
        visible={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancel this trip?"
        message={
          trip?.riderId
            ? `${rider?.firstName ?? "Your rider"} is already on the way to you. Tell us why, so we can put it right.`
            : "We'll stop looking for a rider. Tell us why."
        }
        reasons={PASSENGER_CANCEL_REASONS}
        confirmLabel="Cancel trip"
        keepLabel="Keep my ride"
        busy={busy}
        onConfirm={(reason) => {
          setCancelOpen(false);
          void cancelWith(reason);
        }}
      />

      <ModalSheet visible={riderSheet && !!rider} onClose={() => setRiderSheet(false)}>
        {rider ? (
          <View style={styles.profile}>
            <View style={styles.profileHead}>
              {rider.vestNumber ? <VestPatch value={rider.vestNumber} size="xl" label={`Vest ${rider.vestNumber}`} /> : null}
              <View style={styles.flex}>
                <Txt v="title">{rider.firstName}</Txt>
                {rider.rating ? (
                  <View style={styles.ratingPill}>
                    <Ionicons name="star" size={13} color={c.onHighlight} />
                    <Txt v="label" tone="onHighlight" style={styles.ratingText}>
                      {rider.rating.toFixed(1)}
                    </Txt>
                    <Txt v="label" tone="onHighlight">
                      from passengers
                    </Txt>
                  </View>
                ) : (
                  <Txt v="label" tone="muted">
                    New to Nova
                  </Txt>
                )}
              </View>
            </View>

            {/* The vehicle as it looks, with the plate set like a plate. */}
            <View style={styles.vehicleCard}>
              <VehicleArt kind={rider.vehicleClass} size={96} />
              <View style={styles.flex}>
                <Txt v="section">{VEHICLE_NAME[rider.vehicleClass as VehicleKind] ?? "Vehicle"}</Txt>
                <Txt v="caption" tone="muted">
                  Nova company vehicle
                </Txt>
                {rider.plate ? (
                  <View style={styles.plateBig}>
                    <Txt v="bodyStrong" style={styles.plateBigText}>
                      {rider.plate}
                    </Txt>
                  </View>
                ) : null}
              </View>
            </View>

            <View style={styles.checks}>
              <Txt v="section">Before you get on</Txt>
              {[
                { icon: "shirt" as const, text: rider.vestNumber ? `The vest says ${rider.vestNumber}` : "The vest number matches this screen" },
                { icon: "card" as const, text: rider.plate ? `The plate is ${rider.plate}` : "The plate matches this screen" },
                { icon: "keypad" as const, text: "Give your PIN to this rider only" },
              ].map((x) => (
                <View key={x.text} style={styles.checkRow}>
                  <View style={styles.checkIcon}>
                    <Ionicons name={x.icon} size={16} color={c.accent} />
                  </View>
                  <Txt v="body" style={styles.flex}>
                    {x.text}
                  </Txt>
                  <Ionicons name="checkmark-circle" size={20} color={c.success} />
                </View>
              ))}
            </View>

            <View style={styles.sheetActions}>
              <Button label="Message" icon="chatbubble" variant="secondary" style={styles.flex} onPress={() => { setRiderSheet(false); setChatOpen(true); }} />
              <Button label="Call" icon="call" variant="secondary" style={styles.flex} onPress={() => { setRiderSheet(false); void call(); }} />
            </View>
            <Button label="Report a problem" icon="flag" variant="quiet" compact onPress={() => { setRiderSheet(false); router.push({ pathname: "/report", params: { trip: trip?.id ?? "", to: trip?.dropoffLabel ?? "", kind: "complaint" } }); }} />
          </View>
        ) : null}
      </ModalSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  root: { flex: 1, backgroundColor: c.surface },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0 },
  booked: { gap: space.md },
  back: { position: "absolute", left: space.md },
  profile: { gap: space.md },
  profileHead: { flexDirection: "row", alignItems: "center", gap: space.lg },
  ratingPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    marginTop: 4,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: c.highlight,
  },
  ratingText: { fontWeight: "700" },
  vehicleCard: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderRadius: 20, backgroundColor: c.tintBlue },
  plateBig: {
    alignSelf: "flex-start",
    marginTop: space.sm,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: c.textStrong,
    backgroundColor: c.surfaceRaised,
  },
  plateBigText: { letterSpacing: 1 },
  checks: { gap: space.sm },
  checkRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  checkIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: c.tintBlue, alignItems: "center", justifyContent: "center" },
  sheetActions: { flexDirection: "row", gap: space.sm },
});
