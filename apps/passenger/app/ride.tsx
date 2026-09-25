import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme, tokens, ROUTE_DOT, railGeometry } from "@gera/ui";
import {
  requestQuote,
  createTripFromQuote,
  getTrip,
  getRiderCard,
  getRoute,
  getTripContact,
  cancelTrip,
  rateTrip,
  watchTrip,
  getRiderPosition,
  raiseSos,
  shareTripText,
  etaLabel,
  EMERGENCY_NUMBER,
  isTripLive,
  type RiderPosition,
  type QuoteResult,
  type TripSnapshot,
  type RiderCard,
} from "@gera/data";
import { supabase } from "../src/lib/supabase";
import { TripMap, type MapMarker } from "../src/components/TripMap";
import { Sheet } from "../src/components/Sheet";

const PICKUP = { lat: -1.9403, lng: 30.1128 };
const PICKUP_LABEL = "Kimironko Market";

// Moto first and default: it is the dominant mode in Kigali. Ordering it second
// would import a Western assumption about what a ride normally is.
const CLASSES = [
  { id: "moto", label: "Moto", blurb: "Fastest through traffic" },
  { id: "cab", label: "Cab", blurb: "Covered, up to 3 people" },
  { id: "cab_xl", label: "Cab XL", blurb: "More room and luggage" },
] as const;

type VehicleClass = (typeof CLASSES)[number]["id"];

/** Straight-line metres. Real road distance arrives with navigation. */
function haversineM(a: typeof PICKUP, b: typeof PICKUP): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}

const money = (rwf: number) => rwf.toLocaleString("en-US");

export default function Ride() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    lng?: string | string[];
    lat?: string | string[];
    label?: string | string[];
    note?: string | string[];
  }>();
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  const lng = Number(one(params.lng));
  const lat = Number(one(params.lat));
  const label = one(params.label) ?? "Destination";
  const note = one(params.note);
  const haveDropoff = Number.isFinite(lat) && Number.isFinite(lng);

  const [vehicleClass, setVehicleClass] = useState<VehicleClass>("moto");
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [trip, setTrip] = useState<TripSnapshot | null>(null);
  const [rider, setRider] = useState<RiderCard | null>(null);
  const [riderAt, setRiderAt] = useState<RiderPosition | null>(null);
  const [rating, setRating] = useState(0);
  const [rated, setRated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Straight-line until the server answers with a real road route. Kigali is
  // built on ridges: two points 2km apart across a valley can be a 5km drive,
  // so the straight line under-reads badly and the rider would be paid for a
  // trip nobody made. The fallback exists only so a routing outage still
  // produces a quote.
  const fallbackM = haveDropoff ? haversineM(PICKUP, { lat, lng }) : 0;
  const [road, setRoad] = useState<{ distanceM: number; durationS: number } | null>(null);

  const distanceM = road?.distanceM ?? fallbackM;
  // ~27 km/h through Kigali traffic, in metres per second.
  const durationS = road?.durationS ?? Math.max(60, Math.round(fallbackM / 7.5));

  useEffect(() => {
    if (!haveDropoff || trip) return;
    let active = true;
    getRoute(supabase, PICKUP, { lat, lng })
      .then((r) => {
        if (active && r) setRoad(r);
      })
      .catch(() => {
        // getRoute already returns null on failure; this is belt and braces.
      });
    return () => {
      active = false;
    };
  }, [haveDropoff, lat, lng, trip]);

  // Re-quote whenever the class changes, so the price on screen is always the
  // price that gets booked. Spec: the quote is locked, not an estimate.
  useEffect(() => {
    if (trip || !haveDropoff) return;
    let active = true;
    setBusy(true);
    setError(null);
    requestQuote(supabase, { vehicleClass, distanceM, durationS })
      .then((q) => {
        if (active) setQuote(q);
      })
      .catch(() => {
        if (active) setError("Could not get a price just now.");
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [vehicleClass, distanceM, durationS, trip, haveDropoff]);

  // Realtime is the primary signal; the slow poll is a backstop for a dropped
  // websocket, which on a Kigali mobile connection is not rare. Fifteen seconds
  // rather than three: it only has to catch a subscription that died, and a
  // three-second poll was spending a passenger's data bundle on a row that changes
  // four or five times in a whole trip.
  useEffect(() => {
    if (!trip || !isTripLive(trip.state)) return;
    const tripId = trip.id;

    const refresh = () => {
      getTrip(supabase, tripId)
        .then(setTrip)
        .catch(() => {
          // A dropped read is not a failed trip.
        });
    };

    const sub = watchTrip(supabase, tripId, refresh);
    const id = setInterval(refresh, 15000);

    return () => {
      sub.unsubscribe();
      clearInterval(id);
    };
    // Keyed on the id, not the whole trip: re-subscribing on every state change
    // would tear down the channel exactly when it is doing its job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.id, trip !== null && isTripLive(trip.state)]);

  // Follow the rider. This is what turns "Rider on the way" from a spinner
  // into something a passenger can believe: the marker moves, and the ETA counts
  // down. Polled rather than pushed - the track points arrive far faster than
  // the trip row changes, and a re-read every four seconds is cheaper than a
  // second realtime channel per trip.
  useEffect(() => {
    if (!trip?.riderId || !isTripLive(trip.state)) {
      setRiderAt(null);
      return;
    }
    const tripId = trip.id;
    let active = true;

    const read = () => {
      getRiderPosition(supabase, tripId)
        .then((p) => {
          if (active) setRiderAt(p);
        })
        .catch(() => {
          // No fix yet is an ordinary state, not an error.
        });
    };

    read();
    const id = setInterval(read, 4000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [trip?.id, trip?.riderId, trip?.state]);

  // Fetch the rider card once, when a rider is first assigned. It does not
  // change for the life of the trip, so re-fetching it on every poll would be
  // three requests a second for a name and a plate.
  useEffect(() => {
    if (!trip?.riderId || rider) return;
    let active = true;
    getRiderCard(supabase, trip.id)
      .then((d) => {
        if (active) setRider(d);
      })
      .catch(() => {
        // The card is a convenience. Losing it must not break the trip screen.
      });
    return () => {
      active = false;
    };
  }, [trip?.riderId, trip?.id, rider]);

  const book = useCallback(async () => {
    if (!quote) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createTripFromQuote(supabase, {
        quoteId: quote.quoteId,
        pickup: PICKUP,
        pickupLabel: PICKUP_LABEL,
        ...(note ? { pickupNote: note } : {}),
        dropoff: { lng, lat },
        dropoffLabel: label,
      });
      setTrip(await getTrip(supabase, created.id));
    } catch {
      setError("Could not book that ride. Your price may have expired.");
    } finally {
      setBusy(false);
    }
  }, [quote, note, label, lng, lat]);

  const onCall = useCallback(async () => {
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
  }, [trip]);

  const onCancel = useCallback(() => {
    if (!trip) return;
    Alert.alert("Cancel this trip?", "Your rider is on the way.", [
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
  }, [trip]);

  const onRate = useCallback(
    async (stars: number) => {
      if (!trip) return;
      setRating(stars);
      try {
        await rateTrip(supabase, trip.id, stars);
        setRated(true);
      } catch {
        setRating(0);
        setError("Could not save your rating.");
      }
    },
    [trip],
  );

  const onShare = useCallback(async () => {
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
  }, [trip, rider, riderAt]);

  const onSos = useCallback(() => {
    Alert.alert(
      "Emergency",
      "We'll record where you are and who you're with. If you're in danger, call 112.",
      [
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
      ],
    );
  }, [trip, riderAt]);

  const state = trip?.state ?? (quote ? "quoted" : "idle");
  // Cancellable exactly where trip_transition_rules says it is, so the button
  // never appears for a transition the server would refuse.
  const cancellable =
    trip !== null &&
    ["requested", "offered", "accepted", "arrived"].includes(trip.state);

  const markers: MapMarker[] = [
    { id: "p", at: PICKUP, label: "Pickup", kind: "pickup" },
    ...(haveDropoff ? [{ id: "d", at: { lat, lng }, label, kind: "dropoff" as const }] : []),
    ...(riderAt
      ? [
          {
            id: "drv",
            at: { lat: riderAt.lat, lng: riderAt.lng },
            label: rider?.firstName ? `${rider.firstName} · ${etaLabel(riderAt.etaSeconds)}` : "Your rider",
            kind: "rider" as const,
          },
        ]
      : []),
  ];

  return (
    <View style={styles.root}>
      <TripMap center={PICKUP} markers={markers} />

      <Sheet state={state}>
        {trip ? (
          <View style={styles.flex}>
            <View style={styles.routeBlock}>
              <View style={styles.rail}>
                <View style={[styles.dot, styles.dotOrigin]} />
                <View style={styles.railLine} />
                <View style={[styles.dot, styles.dotDestination]} />
              </View>
              <View style={styles.flex}>
                <Text style={styles.leg} numberOfLines={1}>{trip.pickupLabel}</Text>
                <Text style={[styles.leg, styles.legLast]} numberOfLines={1}>
                  {trip.dropoffLabel}
                </Text>
              </View>
            </View>
            {trip.quotedAmountRwf !== null ? (
              <Text style={styles.fare}>{money(trip.quotedAmountRwf)} RWF</Text>
            ) : null}
            {riderAt && trip.state !== "completed" ? (
              <Text style={styles.eta}>
                {trip.state === "in_progress"
                  ? `About ${etaLabel(riderAt.etaSeconds)} to go`
                  : `About ${etaLabel(riderAt.etaSeconds)} away`}
              </Text>
            ) : null}

            <Text style={styles.payNote}>
              {trip.state === "completed"
                ? "Pay your rider in cash now."
                : "Pay your rider in cash at the end."}
            </Text>

            {/* What the passenger needs at the kerb: who to look for, and which
                vehicle is theirs. Nothing here identifies the rider further. */}
            {rider ? (
              <View style={styles.riderCard}>
                <View style={styles.flex}>
                  <Text style={styles.riderName}>{rider.firstName}</Text>
                  <Text style={styles.riderMeta}>
                    {rider.vehicleClass === "moto"
                      ? "Moto"
                      : rider.vehicleClass === "cab_xl"
                        ? "Cab XL"
                        : "Cab"}
                    {rider.vestNumber ? ` · vest ${rider.vestNumber}` : ""}
                  </Text>
                </View>
                {rider.plate ? <Text style={styles.plate}>{rider.plate}</Text> : null}
              </View>
            ) : null}

            {rider && isTripLive(trip.state) ? (
              <View style={styles.actions}>
                <Pressable style={styles.action} onPress={onCall} accessibilityRole="button">
                  <View style={styles.actionCircle}>
                    <Ionicons name="call" size={20} color={theme.textStrong} />
                  </View>
                  <Text style={styles.actionLabel}>Call</Text>
                </Pressable>
                <Pressable style={styles.action} onPress={onShare} accessibilityRole="button">
                  <View style={styles.actionCircle}>
                    <Ionicons name="share-social" size={20} color={theme.textStrong} />
                  </View>
                  <Text style={styles.actionLabel}>Share</Text>
                </Pressable>

                <Pressable style={styles.action} onPress={onSos} accessibilityRole="button">
                  <View style={[styles.actionCircle, styles.actionDanger]}>
                    <Ionicons name="alert" size={20} color={theme.danger} />
                  </View>
                  <Text style={styles.actionLabel}>Help</Text>
                </Pressable>

                {cancellable ? (
                  <Pressable
                    style={styles.action}
                    onPress={onCancel}
                    disabled={busy}
                    accessibilityRole="button"
                  >
                    <View style={styles.actionCircle}>
                      <Ionicons name="close" size={22} color={theme.danger} />
                    </View>
                    <Text style={styles.actionLabel}>Cancel</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {/* Rating lives on the completed sheet, not a separate screen: the
                moment the passenger is most willing to give one is right now. */}
            {trip.state === "completed" ? (
              <View style={styles.rateBlock}>
                <Text style={styles.rateLabel}>
                  {rated ? "Thanks for rating" : "How was your trip?"}
                </Text>
                <View style={styles.stars}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Pressable
                      key={n}
                      onPress={() => onRate(n)}
                      disabled={rated}
                      style={styles.star}
                      accessibilityRole="button"
                      accessibilityLabel={`${n} star${n > 1 ? "s" : ""}`}
                    >
                      <Text style={[styles.starGlyph, n <= rating && styles.starOn]}>★</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            {trip.state === "no_riders" ? (
              <Text style={styles.sorry}>
                Nobody is free near you right now. Try again in a few minutes.
              </Text>
            ) : null}

            {isTripLive(trip.state) ? (
              <>
                <ActivityIndicator style={styles.spin} color={theme.accent} />
                {/* Before a rider is assigned there is no action row, so
                    cancelling needs its own way out. */}
                {cancellable && !rider ? (
                  <Pressable
                    style={styles.cancel}
                    onPress={onCancel}
                    disabled={busy}
                    accessibilityRole="button"
                  >
                    <Text style={styles.cancelText}>Cancel trip</Text>
                  </Pressable>
                ) : null}
              </>
            ) : (
              <Pressable
                style={styles.cta}
                onPress={() => router.replace("/")}
                accessibilityRole="button"
              >
                <Text style={styles.ctaText}>Done</Text>
              </Pressable>
            )}
          </View>
        ) : (
          <View style={styles.flex}>
            {CLASSES.map((c) => {
              const selected = vehicleClass === c.id;
              return (
                <Pressable
                  key={c.id}
                  style={[styles.card, selected && styles.cardActive]}
                  onPress={() => setVehicleClass(c.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                >
                  <View style={styles.flex}>
                    <Text style={styles.cardLabel}>{c.label}</Text>
                    <Text style={styles.cardBlurb}>{c.blurb}</Text>
                  </View>
                  {selected && quote ? (
                    <Text style={styles.cardPrice}>{money(quote.amountRwf)} RWF</Text>
                  ) : null}
                </Pressable>
              );
            })}

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              style={[styles.cta, (!quote || busy) && styles.ctaDisabled]}
              onPress={book}
              disabled={!quote || busy}
              accessibilityRole="button"
            >
              <Text style={styles.ctaText}>
                {busy
                  ? "Just a moment…"
                  : quote
                    ? `Book for ${money(quote.amountRwf)} RWF`
                    : "Getting price…"}
              </Text>
            </Pressable>
          </View>
        )}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.surface },
  flex: { flex: 1 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: tokens.MIN_TOUCH_TARGET,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
    borderRadius: tokens.radius.md,
    borderWidth: 2,
    borderColor: "transparent",
    marginBottom: tokens.space.sm,
  },
  cardActive: { borderColor: theme.accent, backgroundColor: theme.surface },
  cardLabel: {
    fontSize: tokens.type.body.size,
    fontWeight: "700",
    color: theme.textStrong,
  },
  cardBlurb: { fontSize: tokens.type.label.size, color: theme.textMuted },
  cardPrice: {
    fontSize: tokens.type.title.size,
    fontWeight: "700",
    color: theme.textStrong,
  },
  route: { fontSize: tokens.type.body.size, color: theme.textMuted },
  fare: {
    fontSize: tokens.type.display.size,
    fontWeight: "700",
    color: theme.textStrong,
    marginTop: tokens.space.sm,
  },
  payNote: {
    fontSize: tokens.type.label.size,
    color: theme.textMuted,
    marginTop: tokens.space.xs,
  },
  riderCard: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: tokens.space.md,
    padding: tokens.space.md,
    borderRadius: tokens.radius.md,
    backgroundColor: theme.surface,
    borderWidth: 2,
    borderColor: theme.accent,
  },
  riderName: {
    fontSize: tokens.type.title.size,
    fontWeight: "700",
    color: theme.textStrong,
  },
  riderMeta: { fontSize: tokens.type.label.size, color: theme.textMuted },
  // The plate is what the passenger scans the kerb for, so it is set like a plate.
  plate: {
    fontSize: tokens.type.title.size,
    fontWeight: "700",
    letterSpacing: 1,
    color: theme.textStrong,
  },
  sorry: {
    marginTop: tokens.space.md,
    fontSize: tokens.type.body.size,
    color: theme.textMuted,
  },
  routeBlock: { flexDirection: "row", alignItems: "center" },
  rail: { width: ROUTE_DOT.size, alignItems: "center", marginRight: tokens.space.md },
  dot: { width: ROUTE_DOT.size, height: ROUTE_DOT.size, borderRadius: tokens.radius.pill },
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
  actions: {
    flexDirection: "row",
    gap: tokens.space.lg,
    marginTop: tokens.space.md,
  },
  action: { alignItems: "center" },
  actionCircle: {
    width: tokens.MIN_TOUCH_TARGET,
    height: tokens.MIN_TOUCH_TARGET,
    borderRadius: tokens.radius.pill,
    backgroundColor: theme.surfaceHigh,
    alignItems: "center",
    justifyContent: "center",
  },
  actionDanger: { borderWidth: 2, borderColor: theme.danger },
  eta: {
    marginTop: tokens.space.xs,
    fontSize: tokens.type.body.size,
    fontWeight: "700",
    color: theme.accent,
  },
  actionLabel: {
    marginTop: tokens.space.xs,
    fontSize: tokens.type.label.size,
    color: theme.textMuted,
  },
  cancel: {
    marginTop: "auto",
    minHeight: tokens.MIN_TOUCH_TARGET,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: { fontSize: tokens.type.body.size, color: theme.danger },
  rateBlock: { marginTop: tokens.space.lg },
  rateLabel: { fontSize: tokens.type.body.size, color: theme.textMuted },
  stars: { flexDirection: "row", marginTop: tokens.space.sm },
  star: {
    minWidth: tokens.MIN_TOUCH_TARGET,
    minHeight: tokens.MIN_TOUCH_TARGET,
    alignItems: "center",
    justifyContent: "center",
  },
  starGlyph: { fontSize: 34, color: theme.textMuted, opacity: 0.35 },
  starOn: { color: theme.accent, opacity: 1 },
  spin: { marginTop: tokens.space.lg },
  error: {
    color: theme.danger,
    marginBottom: tokens.space.sm,
    fontSize: tokens.type.body.size,
  },
  cta: {
    marginTop: "auto",
    minHeight: tokens.MIN_TOUCH_TARGET + 6,
    backgroundColor: theme.accent,
    borderRadius: tokens.radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaDisabled: { opacity: 0.5 },
  ctaText: {
    fontSize: tokens.type.body.size,
    fontWeight: "700",
    color: theme.onAccent,
  },
});
