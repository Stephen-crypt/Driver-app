import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { lightTheme, tokens } from "@gera/ui";
import {
  requestQuote,
  createTripFromQuote,
  getTrip,
  getDriverCard,
  getRoute,
  getTripContact,
  cancelTrip,
  rateTrip,
  isTripLive,
  type QuoteResult,
  type TripSnapshot,
  type DriverCard,
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
  const [driver, setDriver] = useState<DriverCard | null>(null);
  const [rating, setRating] = useState(0);
  const [rated, setRated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Straight-line until the server answers with a real road route. Kigali is
  // built on ridges: two points 2km apart across a valley can be a 5km drive,
  // so the straight line under-reads badly and the driver would be paid for a
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

  // Poll while the trip is live. Realtime streaming arrives in a later phase;
  // polling is the honest version of "we do not have push yet".
  useEffect(() => {
    if (!trip || !isTripLive(trip.state)) return;
    const id = setInterval(() => {
      getTrip(supabase, trip.id)
        .then(setTrip)
        .catch(() => {
          // A dropped poll is not a failed trip. The next tick retries.
        });
    }, 3000);
    return () => clearInterval(id);
  }, [trip]);

  // Fetch the driver card once, when a driver is first assigned. It does not
  // change for the life of the trip, so re-fetching it on every poll would be
  // three requests a second for a name and a plate.
  useEffect(() => {
    if (!trip?.driverId || driver) return;
    let active = true;
    getDriverCard(supabase, trip.id)
      .then((d) => {
        if (active) setDriver(d);
      })
      .catch(() => {
        // The card is a convenience. Losing it must not break the trip screen.
      });
    return () => {
      active = false;
    };
  }, [trip?.driverId, trip?.id, driver]);

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
        Alert.alert("Not available", "You can call your driver once they've accepted.");
        return;
      }
      await Linking.openURL(`tel:${contact.phone}`);
    } catch {
      Alert.alert("Could not call", "Try again in a moment.");
    }
  }, [trip]);

  const onCancel = useCallback(() => {
    if (!trip) return;
    Alert.alert("Cancel this trip?", "Your driver is on the way.", [
      { text: "Keep it", style: "cancel" },
      {
        text: "Cancel trip",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          try {
            await cancelTrip(supabase, trip.id, "rider");
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

  const state = trip?.state ?? (quote ? "quoted" : "idle");
  // Cancellable exactly where trip_transition_rules says it is, so the button
  // never appears for a transition the server would refuse.
  const cancellable =
    trip !== null &&
    ["requested", "offered", "accepted", "arrived"].includes(trip.state);

  const markers: MapMarker[] = [
    { id: "p", at: PICKUP, label: "Pickup", kind: "pickup" },
    ...(haveDropoff ? [{ id: "d", at: { lat, lng }, label, kind: "dropoff" as const }] : []),
  ];

  return (
    <View style={styles.root}>
      <TripMap center={PICKUP} markers={markers} />

      <Sheet state={state}>
        {trip ? (
          <View style={styles.flex}>
            <Text style={styles.route}>
              {trip.pickupLabel} → {trip.dropoffLabel}
            </Text>
            {trip.quotedAmountRwf !== null ? (
              <Text style={styles.fare}>{money(trip.quotedAmountRwf)} RWF</Text>
            ) : null}
            <Text style={styles.payNote}>
              {trip.state === "completed"
                ? "Pay your driver in cash now."
                : "Pay your driver in cash at the end."}
            </Text>

            {/* What the rider needs at the kerb: who to look for, and which
                vehicle is theirs. Nothing here identifies the driver further. */}
            {driver ? (
              <View style={styles.driverCard}>
                <View style={styles.flex}>
                  <Text style={styles.driverName}>{driver.firstName}</Text>
                  <Text style={styles.driverMeta}>
                    {driver.vehicleClass === "moto"
                      ? "Moto"
                      : driver.vehicleClass === "cab_xl"
                        ? "Cab XL"
                        : "Cab"}
                    {driver.vestNumber ? ` · vest ${driver.vestNumber}` : ""}
                  </Text>
                </View>
                {driver.plate ? <Text style={styles.plate}>{driver.plate}</Text> : null}
              </View>
            ) : null}

            {driver && isTripLive(trip.state) ? (
              <Pressable style={styles.callButton} onPress={onCall} accessibilityRole="button">
                <Text style={styles.callText}>Call {driver.firstName}</Text>
              </Pressable>
            ) : null}

            {/* Rating lives on the completed sheet, not a separate screen: the
                moment the rider is most willing to give one is right now. */}
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

            {trip.state === "no_drivers" ? (
              <Text style={styles.sorry}>
                Nobody is free near you right now. Try again in a few minutes.
              </Text>
            ) : null}

            {isTripLive(trip.state) ? (
              <>
                <ActivityIndicator style={styles.spin} color={lightTheme.accent} />
                {cancellable ? (
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
  root: { flex: 1, backgroundColor: lightTheme.surface },
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
  cardActive: { borderColor: lightTheme.accent, backgroundColor: lightTheme.surface },
  cardLabel: {
    fontSize: tokens.type.body.size,
    fontWeight: "700",
    color: lightTheme.textStrong,
  },
  cardBlurb: { fontSize: tokens.type.label.size, color: lightTheme.textMuted },
  cardPrice: {
    fontSize: tokens.type.title.size,
    fontWeight: "700",
    color: lightTheme.textStrong,
  },
  route: { fontSize: tokens.type.body.size, color: lightTheme.textMuted },
  fare: {
    fontSize: tokens.type.display.size,
    fontWeight: "700",
    color: lightTheme.textStrong,
    marginTop: tokens.space.sm,
  },
  payNote: {
    fontSize: tokens.type.label.size,
    color: lightTheme.textMuted,
    marginTop: tokens.space.xs,
  },
  driverCard: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: tokens.space.md,
    padding: tokens.space.md,
    borderRadius: tokens.radius.md,
    backgroundColor: lightTheme.surface,
    borderWidth: 2,
    borderColor: lightTheme.accent,
  },
  driverName: {
    fontSize: tokens.type.title.size,
    fontWeight: "700",
    color: lightTheme.textStrong,
  },
  driverMeta: { fontSize: tokens.type.label.size, color: lightTheme.textMuted },
  // The plate is what the rider scans the kerb for, so it is set like a plate.
  plate: {
    fontSize: tokens.type.title.size,
    fontWeight: "700",
    letterSpacing: 1,
    color: lightTheme.textStrong,
  },
  sorry: {
    marginTop: tokens.space.md,
    fontSize: tokens.type.body.size,
    color: lightTheme.textMuted,
  },
  callButton: {
    marginTop: tokens.space.md,
    minHeight: tokens.MIN_TOUCH_TARGET,
    borderRadius: tokens.radius.md,
    borderWidth: 2,
    borderColor: lightTheme.textStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  callText: {
    fontSize: tokens.type.body.size,
    fontWeight: "700",
    color: lightTheme.textStrong,
  },
  cancel: {
    marginTop: "auto",
    minHeight: tokens.MIN_TOUCH_TARGET,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: { fontSize: tokens.type.body.size, color: lightTheme.danger },
  rateBlock: { marginTop: tokens.space.lg },
  rateLabel: { fontSize: tokens.type.body.size, color: lightTheme.textMuted },
  stars: { flexDirection: "row", marginTop: tokens.space.sm },
  star: {
    minWidth: tokens.MIN_TOUCH_TARGET,
    minHeight: tokens.MIN_TOUCH_TARGET,
    alignItems: "center",
    justifyContent: "center",
  },
  starGlyph: { fontSize: 34, color: lightTheme.textMuted, opacity: 0.35 },
  starOn: { color: lightTheme.accent, opacity: 1 },
  spin: { marginTop: tokens.space.lg },
  error: {
    color: lightTheme.danger,
    marginBottom: tokens.space.sm,
    fontSize: tokens.type.body.size,
  },
  cta: {
    marginTop: "auto",
    minHeight: tokens.MIN_TOUCH_TARGET,
    backgroundColor: lightTheme.accent,
    borderRadius: tokens.radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaDisabled: { opacity: 0.5 },
  ctaText: {
    fontSize: tokens.type.body.size,
    fontWeight: "700",
    color: lightTheme.onAccent,
  },
});
