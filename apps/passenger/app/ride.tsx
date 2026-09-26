import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Linking, Pressable, ScrollView, Share, StyleSheet, View, useWindowDimensions } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Button, GeraMap, Paper, Txt, c, notify, shadow, space, type MapMarker } from "@gera/kit";
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
  nearestLandmark,
  pickupLabelFor,
  raiseSos,
  rateTrip,
  requestQuote,
  shareTripText,
  watchTrip,
  distanceBetween,
  type QuoteResult,
  type RiderCard,
  type RiderPosition,
  type TripPoints,
  type TripSnapshot,
  type TripTotal,
  type WaitStatus,
} from "@gera/data";
import { supabase } from "../src/lib/supabase";
import { goBack } from "../src/lib/nav";
import * as loc from "../src/lib/location";
import { CLASSES, Choose, type VehicleClass } from "../src/ride/Choose";
import { Assigned, Ended, Searching } from "../src/ride/Live";
import { Completed } from "../src/ride/Completed";
import { endDateOf, type BookingMode, type LaterPlan, type RegularPlan } from "../src/ride/When";

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
  const [bookedAhead, setBookedAhead] = useState<{ title: string; detail: string } | null>(null);

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
  const [pickupNote, setPickupNote] = useState("");

  const [road, setRoad] = useState<{ distanceM: number; durationS: number } | null>(null);
  const [quotes, setQuotes] = useState<Partial<Record<VehicleClass, QuoteResult>>>({});
  const [selected, setSelected] = useState<VehicleClass>("moto");

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
  const [paperH, setPaperH] = useState(420);

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
      nearestLandmark(supabase, at)
        .then((l) => active && setPickupLabel(pickupLabelFor(l)))
        .catch(() => {});
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
    if (trip || !pickup || !dropoff || distanceM <= 0) return;
    let active = true;
    setError(null);
    Promise.all(
      CLASSES.map((k) =>
        requestQuote(supabase, { vehicleClass: k.id, distanceM, durationS })
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
  }, [trip, distanceM, durationS]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- the live trip ---------------------------------------------------------------
  const live = trip ? isTripLive(trip.state) : false;

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
        await scheduleTrip(supabase, { ...args, scheduledFor: at });
        notify("success");
        setBookedAhead({
          title: `Booked for ${whenLabel(at.toISOString()).toLowerCase()}`,
          detail: `We'll start finding your rider ten minutes before. The price is locked at ${quote.amountRwf.toLocaleString("en-US")} RWF.`,
        });
      } else if (mode === "regular" && regular.time) {
        await createRecurringSchedule(supabase, {
          ...args,
          days: regular.days,
          time: regular.time,
          startDate: regular.startDate,
          endDate: endDateOf(regular),
        });
        notify("success");
        setBookedAhead({
          title: `${daysLabel(regular.days)} at ${regular.time}`,
          detail: `Each ride is booked a week ahead and shows in Activity, where you can skip a day or cancel the lot. Every ride is ${quote.amountRwf.toLocaleString("en-US")} RWF.`,
        });
      } else {
        const created = await createTripFromQuote(supabase, args);
        setTrip(await getTrip(supabase, created.id));
      }
    } catch (e) {
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
        Alert.alert("Not available", "You can call your rider once they've accepted.");
        return;
      }
      await Linking.openURL(`tel:${contact.phone}`);
    } catch {
      Alert.alert("Could not call", "Try again in a moment.");
    }
  };

  const cancel = () => {
    if (!trip) return;
    Alert.alert("Cancel this trip?", trip.riderId ? "Your rider is already on the way." : "", [
      { text: "Keep it", style: "cancel" },
      {
        text: "Cancel trip",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          try {
            await cancelTrip(supabase, trip.id, "passenger");
            setTrip(await getTrip(supabase, trip.id));
          } catch (e) {
            setError(e instanceof Error ? e.message : "Could not cancel.");
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
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
          etaSeconds: riderAt?.etaSeconds ?? null,
        }),
      });
    } catch {
      // The passenger dismissed the share sheet.
    }
  };

  const sos = () => {
    Alert.alert("Safety", `We'll record where you are and who you're with. If you're in danger, call ${EMERGENCY_NUMBER}.`, [
      { text: "Close", style: "cancel" },
      {
        text: "Record alert",
        onPress: async () => {
          try {
            await raiseSos(supabase, {
              ...(trip ? { tripId: trip.id } : {}),
              ...(riderAt ? { at: { lng: riderAt.lng, lat: riderAt.lat } } : {}),
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

  // ---- map -------------------------------------------------------------------------
  const from = points?.pickup ?? pickup;
  const to = points?.dropoff ?? dropoff;
  const markers = useMemo(() => {
    const m: MapMarker[] = [];
    if (from) m.push({ id: "pickup", at: from, kind: trip ? "pickup" : "me", tag: trip ? "Pickup" : undefined });
    if (to) m.push({ id: "dropoff", at: to, kind: "dropoff", tag: trip ? undefined : dropLabel });
    if (riderAt) m.push({ id: "rider", at: riderAt, kind: "rider", tag: rider?.vestNumber ?? "" });
    return m;
  }, [from?.lat, from?.lng, to?.lat, to?.lng, riderAt?.lat, riderAt?.lng, rider?.vestNumber, trip === null, dropLabel]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- sheet ---------------------------------------------------------------------------
  let body;
  if (bookedAhead) {
    body = (
      <View style={styles.booked}>
        <Txt v="label" tone="good">
          {mode === "regular" ? "Schedule set" : "Ride booked"}
        </Txt>
        <Txt v="title">{bookedAhead.title}</Txt>
        <Txt v="body" tone="muted">
          To {dropLabel}. {bookedAhead.detail}
        </Txt>
        <Button label="See upcoming rides" onPress={() => router.replace("/activity")} />
        <Button label="Done" variant="quiet" compact onPress={() => router.replace("/")} />
      </View>
    );
  } else if (!trip) {
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
      />
    );
  } else if (trip.state === "requested" || trip.state === "offered") {
    body = <Searching onCancel={cancel} busy={busy} />;
  } else if (live) {
    body = (
      <Assigned
        trip={trip}
        rider={rider}
        riderAt={riderAt}
        pin={pin}
        wait={wait}
        now={now}
        busy={busy}
        onCall={call}
        onShare={share}
        onSos={sos}
        onCancel={cancel}
      />
    );
  } else if (trip.state === "completed") {
    body = (
      <Completed
        total={total}
        quoted={trip.quotedAmountRwf}
        riderName={rider?.firstName ?? "your rider"}
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
    body = <Ended state={trip.state} onAgain={() => router.replace("/")} />;
  }

  return (
    <View style={styles.root}>
      <GeraMap
        center={from ?? loc.KIGALI_FALLBACK}
        markers={markers}
        route={from && to && (!trip || trip.state === "requested" || trip.state === "offered") ? [from, to] : undefined}
        fit={markers.length > 1}
        topInset={insets.top + 56}
        bottomInset={paperH}
      />
      {!trip || !live ? (
        <Pressable
          onPress={() => (trip ? router.replace("/") : goBack(router))}
          style={[styles.back, { top: insets.top + space.sm }]}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name={trip ? "close" : "arrow-back"} size={22} color={c.textStrong} />
        </Pressable>
      ) : null}
      <View style={styles.sheet} onLayout={(e) => setPaperH(e.nativeEvent.layout.height)}>
        <Paper>
          {/* Booking ahead adds a day and time picker; on a short phone the
              sheet would push the Book button off the screen without this. */}
          <ScrollView
            style={{ maxHeight: height * 0.74 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            bounces={false}
          >
            {body}
          </ScrollView>
        </Paper>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.surface },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0 },
  booked: { gap: space.md },
  back: {
    position: "absolute",
    left: space.md,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: c.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.float,
  },
});
