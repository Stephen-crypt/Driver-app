import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { lightTheme, tokens } from "@gera/ui";
import {
  requestQuote,
  createTripFromQuote,
  getTrip,
  isTripLive,
  type QuoteResult,
  type TripSnapshot,
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const distanceM = haveDropoff ? haversineM(PICKUP, { lat, lng }) : 0;
  // ~27 km/h through Kigali traffic, in metres per second.
  const durationS = Math.max(60, Math.round(distanceM / 7.5));

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

  const state = trip?.state ?? (quote ? "quoted" : "idle");

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
            <Text style={styles.payNote}>Pay your driver in cash at the end.</Text>

            {isTripLive(trip.state) ? (
              <ActivityIndicator style={styles.spin} color={lightTheme.accent} />
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
