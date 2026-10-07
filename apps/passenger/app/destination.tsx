import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import {
  Banner,
  Button,
  Divider,
  Enter,
  Field,
  FloatButton,
  Hero,
  NovaMap,
  Group,
  IconButton,
  Paper,
  Press,
  Row,
  SkeletonRows,
  Swap,
  Txt,
  c,
  font,
  radius,
  shadow,
  space,
  useOverlay,
  useSettledHeight,
  type LatLng,
} from "@nova/kit";
import {
  describePickup,
  distanceBetween,
  distanceLabel,
  landmarksNear,
  listSavedPlaces,
  savePlace,
  searchPlaces,
  type NearPlace,
  type Place,
  type SavedPlace,
} from "@nova/data";
import { supabase } from "../src/lib/supabase";
import { useSession } from "../src/lib/session";
import { goBack } from "../src/lib/nav";
import * as loc from "../src/lib/location";
import { useLightStatusBar } from "../src/lib/statusBar";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const num = (v: string | string[] | undefined) => {
  const raw = one(v);
  const n = Number(raw);
  return raw !== undefined && raw !== "" && Number.isFinite(n) ? n : null;
};

function placeIcon(label: string): "home" | "briefcase" | "bookmark" {
  return /home|urugo/i.test(label) ? "home" : /work|office|akazi/i.test(label) ? "briefcase" : "bookmark";
}

type End = "pickup" | "dropoff";
interface Spot {
  readonly lat: number;
  readonly lng: number;
  readonly label: string;
}

/**
 * Spec 3.7: saved places, then the landmark gazetteer, then a pin. Kigali
 * addresses are landmarks - "the blue gate opposite the pharmacy" - so a pin
 * always asks how to find you. Typing searches Nova's landmarks and the rest
 * of the map (OpenStreetMap through Geoapify, and Overture) together.
 *
 * Both ends of the trip are set here. The pickup starts as where the phone
 * is; tapping it - here, on the home screen, or "Change pickup" on the ride
 * screen - searches for it instead, or sets it on the map. On the map the pin
 * stays in the middle and the map moves under it, with the name of the place
 * under the pin, as every ride app does: easier to land exactly than a tap
 * on a small map.
 */
export default function Destination() {
  useLightStatusBar();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const overlay = useOverlay();
  const { userId } = useSession();
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const mode = one(params.mode);
  const vehicle = one(params.vehicle);

  // Where the rider comes to. From the phone's position unless set here.
  const [pickup, setPickup] = useState<Spot | null>(() => {
    const lat = num(params.plat);
    const lng = num(params.plng);
    return lat !== null && lng !== null ? { lat, lng, label: one(params.plabel) ?? "Current location" } : null;
  });
  const [pickupNote, setPickupNote] = useState(one(params.pnote) ?? "");
  // Arriving from the ride screen to change the pickup, the destination is
  // already chosen: once the pickup is set, it goes straight back.
  const dropLat = num(params.lat);
  const dropLng = num(params.lng);
  const chosenDrop: Spot | null =
    dropLat !== null && dropLng !== null ? { lat: dropLat, lng: dropLng, label: one(params.label) ?? "Destination" } : null;

  const [editing, setEditing] = useState<End>(one(params.edit) === "pickup" ? "pickup" : "dropoff");
  const [query, setQuery] = useState(one(params.q) ?? "");
  const [results, setResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedPlace[]>([]);
  const [near, setNear] = useState<NearPlace[]>([]);
  const [locating, setLocating] = useState(false);
  // Account opens this straight onto the map to save a new place.
  const [mapFor, setMapFor] = useState<End | null>(one(params.map) === "1" ? "dropoff" : null);
  const [pin, setPin] = useState<LatLng | null>(null);
  const [pinName, setPinName] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [sheetH, onSheetLayout] = useSettledHeight(300);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const input = useRef<TextInput>(null);

  useEffect(() => {
    if (!userId) return;
    listSavedPlaces(supabase, userId).then(setSaved).catch(() => {});
  }, [userId]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (query.trim().length === 0) {
      setResults([]);
      setSearching(false);
      return;
    }
    // Debounced: mobile data in Kigali is bought in bundles, and every map
    // search spends from a daily allowance.
    setSearching(true);
    timer.current = setTimeout(() => {
      setError(null);
      searchPlaces(supabase, query, pickup)
        .then(setResults)
        .catch(() => setError("Could not search just now. Check your connection."))
        .finally(() => setSearching(false));
    }, 350);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  // Before they type: the landmarks closest to the pickup, which is usually
  // where a short trip goes - or, setting the pickup, where to stand.
  useEffect(() => {
    if (!pickup) return;
    landmarksNear(supabase, pickup, 5).then(setNear).catch(() => {});
  }, [pickup?.lat, pickup?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () => () => {
      if (pinTimer.current) clearTimeout(pinTimer.current);
    },
    [],
  );

  const goRide = (drop: Spot, dropNote: string | undefined, from: Spot | null, fromNote: string) => {
    router.replace({
      pathname: "/ride",
      params: {
        lng: String(drop.lng),
        lat: String(drop.lat),
        label: drop.label,
        ...(dropNote ? { note: dropNote } : {}),
        ...(from ? { plat: String(from.lat), plng: String(from.lng), plabel: from.label } : {}),
        ...(fromNote.trim() ? { pnote: fromNote.trim() } : {}),
        ...(mode ? { mode } : {}),
        ...(vehicle ? { vehicle } : {}),
      },
    });
  };

  // A place chosen from a list or the map, for whichever end is being set.
  const choose = (spot: Spot, spotNote?: string) => {
    if (editing === "dropoff") {
      goRide(spot, spotNote, pickup, pickupNote);
      return;
    }
    const nextNote = spotNote ?? "";
    setPickup(spot);
    setPickupNote(nextNote);
    if (chosenDrop) {
      goRide(chosenDrop, one(params.note), spot, nextNote);
      return;
    }
    setEditing("dropoff");
    setQuery("");
    setTimeout(() => input.current?.focus(), 50);
  };

  const startEditing = (end: End) => {
    setEditing(end);
    setQuery("");
    setTimeout(() => input.current?.focus(), 50);
  };

  // Setting the pickup back to wherever the phone is now.
  const takeMyLocation = async () => {
    setLocating(true);
    setError(null);
    try {
      if (!(await loc.requestPermission())) {
        setError("Turn on location to use where you are.");
        return;
      }
      const at = await loc.getCurrent(8000);
      if (!at) {
        setError("Could not find where you are. Try again, or set the spot on the map.");
        return;
      }
      choose({ lat: at.lat, lng: at.lng, label: await describePickup(supabase, at) });
    } finally {
      setLocating(false);
    }
  };

  // The map came to rest: name the spot under the pin once the finger stops.
  const onPick = useCallback((at: LatLng) => {
    setPin(at);
    setPinName(null);
    if (pinTimer.current) clearTimeout(pinTimer.current);
    pinTimer.current = setTimeout(() => {
      describePickup(supabase, at)
        .then((name) => setPinName(name === "Current location" ? null : name))
        .catch(() => {});
    }, 450);
  }, []);

  const openMap = (end: End) => {
    setPin(null);
    setPinName(null);
    setNote(end === "pickup" ? pickupNote : "");
    setLabel("");
    setMapFor(end);
  };

  if (mapFor) {
    const forPickup = mapFor === "pickup";
    const start = (forPickup ? pickup : chosenDrop) ?? pickup ?? loc.KIGALI_FALLBACK;
    const pinLabel = pinName ?? (pin ? (forPickup ? "Pinned pickup" : "Pinned location") : "Finding the spot…");
    return (
      <View style={styles.root}>
        <NovaMap
          center={start}
          markers={!forPickup && pickup ? [{ id: "pickup", at: pickup, kind: "me" as const }] : []}
          pick={mapFor}
          onPick={onPick}
          topInset={insets.top + 56}
          bottomInset={sheetH}
        />
        <FloatButton
          icon="arrow-back"
          label="Back to search"
          onPress={() => setMapFor(null)}
          style={[styles.back, { top: insets.top + space.sm }]}
        />
        <View style={styles.sheet} onLayout={onSheetLayout}>
          <Paper>
            <Swap id={mapFor} style={styles.stack}>
              <View>
                <Txt v="h2">{forPickup ? "Set your pickup" : "Set your drop-off"}</Txt>
                <Txt v="label" tone="muted">
                  Move the map so the pin is where your rider should {forPickup ? "meet you" : "drop you"}.
                </Txt>
              </View>
              <View style={styles.pinRow}>
                <View style={[styles.pinWell, forPickup ? styles.pinWellPickup : styles.pinWellDrop]}>
                  <Ionicons name="location" size={18} color={forPickup ? c.accent : c.destination} />
                </View>
                <Txt v="bodyStrong" lines={2} style={styles.flex}>
                  {pinLabel}
                </Txt>
              </View>
              <Field
                label={forPickup ? "How will your rider find you?" : "How will your rider find it?"}
                value={note}
                onChangeText={setNote}
                placeholder="Blue gate opposite the pharmacy"
                onPaper
              />
              {userId && !forPickup ? (
                <View style={styles.saveRow}>
                  <View style={styles.flex}>
                    <Field value={label} onChangeText={setLabel} placeholder="Save as - Home, Work, Mum's" onPaper />
                  </View>
                  <Button
                    label="Save"
                    variant="secondary"
                    compact
                    loading={saving}
                    disabled={!label.trim() || !pin}
                    onPress={async () => {
                      if (!pin) return;
                      setSaving(true);
                      try {
                        await savePlace(supabase, userId, {
                          label: label.trim(),
                          lng: pin.lng,
                          lat: pin.lat,
                          ...(note.trim() ? { note: note.trim() } : {}),
                        });
                        setSaved(await listSavedPlaces(supabase, userId));
                        overlay.toast({ message: `Saved as ${label.trim()}`, tone: "good" });
                      } catch {
                        setError("Could not save that place.");
                      } finally {
                        setSaving(false);
                      }
                    }}
                  />
                </View>
              ) : null}
              <Button
                label={forPickup ? "Set pickup here" : "Go here"}
                disabled={!pin}
                onPress={() => {
                  if (!pin) return;
                  setMapFor(null);
                  choose({ lat: pin.lat, lng: pin.lng, label: label.trim() || pinLabel }, note.trim() || undefined);
                }}
              />
            </Swap>
          </Paper>
        </View>
      </View>
    );
  }

  const showingResults = query.trim().length > 0;
  const fromMap = results.filter((p) => p.source !== "landmark");
  const credit = [
    fromMap.some((p) => p.source === "geoapify") ? "Powered by Geoapify" : null,
    fromMap.some((p) => p.source === "overture") ? "Overture Maps" : null,
  ].filter(Boolean);
  const pickingPickup = editing === "pickup";

  return (
    <View style={styles.root}>
      <Hero style={styles.hero}>
        <View style={styles.heroTop}>
          <View style={styles.backDisc}>
            <IconButton icon="arrow-back" label="Back" onPress={() => goBack(router)} size={44} tone="onDark" />
          </View>
          <Txt v="section" tone="onHero">
            {pickingPickup ? "Set your pickup" : mode === "later" ? "Book ahead" : mode === "regular" ? "Regular trip" : "Plan your ride"}
          </Txt>
        </View>
        {/* The same route drawing as everywhere else: the ring is the pickup,
            the square is where you are going. Tap either line to set it. */}
        <View style={styles.route}>
          <View style={styles.rail} pointerEvents="none">
            <View style={styles.ring} />
            <View style={styles.railLine} />
            <View style={styles.square} />
          </View>
          <View style={styles.flex}>
            {pickingPickup ? (
              <View style={[styles.inputRow, styles.underline]}>
                <TextInput
                  ref={input}
                  style={[styles.input, styles.inputSmall]}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Pickup - a place or street"
                  placeholderTextColor={c.textMuted}
                  autoFocus
                  returnKeyType="search"
                  accessibilityLabel="Pickup"
                />
                {query ? <IconButton icon="close-circle" label="Clear the search" onPress={() => setQuery("")} size={34} /> : null}
              </View>
            ) : (
              <Press
                onPress={() => startEditing("pickup")}
                scaleTo={0.99}
                style={[styles.fromRow, styles.underline]}
                accessibilityRole="button"
                accessibilityLabel={`Pickup: ${pickup?.label ?? "Current location"}. Change pickup`}
              >
                <Txt v="label" tone="muted" lines={1} style={styles.flex}>
                  {pickup?.label ?? "Current location"}
                </Txt>
                <Txt v="label" tone="accent" style={styles.change}>
                  Change
                </Txt>
              </Press>
            )}
            {pickingPickup ? (
              <Press
                onPress={() => startEditing("dropoff")}
                scaleTo={0.99}
                style={styles.toRow}
                accessibilityRole="button"
                accessibilityLabel={chosenDrop ? `Going to ${chosenDrop.label}` : "Where to?"}
              >
                <Txt v="bodyStrong" tone={chosenDrop ? "strong" : "muted"} lines={1} style={styles.flex}>
                  {chosenDrop?.label ?? "Where to?"}
                </Txt>
              </Press>
            ) : (
              <View style={styles.inputRow}>
                <TextInput
                  ref={input}
                  style={styles.input}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Where to?"
                  placeholderTextColor={c.textMuted}
                  autoFocus
                  returnKeyType="search"
                  accessibilityLabel="Where to?"
                />
                {query ? <IconButton icon="close-circle" label="Clear the search" onPress={() => setQuery("")} size={34} /> : null}
              </View>
            )}
          </View>
        </View>
      </Hero>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.list}>
        {error ? <Banner tone="bad" icon="alert-circle">{error}</Banner> : null}

        <Enter i={0} style={styles.quick}>
          {pickingPickup ? (
            <Press
              onPress={() => void takeMyLocation()}
              scaleTo={0.985}
              style={styles.mapRow}
              accessibilityRole="button"
              accessibilityLabel="Use where I am now"
            >
              <View style={[styles.mapIcon, styles.mapIconMidnight]}>
                <Ionicons name="locate" size={20} color={c.highlight} />
              </View>
              <View style={styles.flex}>
                <Txt v="bodyStrong">{locating ? "Finding you…" : "Use where I am now"}</Txt>
                <Txt v="label" tone="muted">
                  Your phone's location
                </Txt>
              </View>
            </Press>
          ) : null}
          <Press
            onPress={() => openMap(editing)}
            scaleTo={0.985}
            style={styles.mapRow}
            accessibilityRole="button"
            accessibilityLabel={pickingPickup ? "Set the pickup on the map" : "Choose on the map"}
          >
            <View style={styles.mapIcon}>
              <Ionicons name="map" size={20} color={c.onHighlight} />
            </View>
            <View style={styles.flex}>
              <Txt v="bodyStrong">{pickingPickup ? "Set the pickup on the map" : "Choose on the map"}</Txt>
              <Txt v="label" tone="muted">
                For anywhere without a name
              </Txt>
            </View>
            <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
          </Press>
        </Enter>

        {!showingResults && saved.length > 0 ? (
          <Enter i={1}>
            <Group title="Saved places">
              {saved.map((p, i) => (
                <View key={p.id}>
                  {i > 0 ? <Divider inset={70} /> : null}
                  <Row
                    title={p.label}
                    subtitle={p.note ?? undefined}
                    icon={placeIcon(p.label)}
                    onPress={() => choose({ lat: p.lat, lng: p.lng, label: p.label }, p.note ?? undefined)}
                  />
                </View>
              ))}
            </Group>
          </Enter>
        ) : null}

        {!showingResults && near.length > 0 ? (
          <Enter i={2}>
            <Group title={pickingPickup ? "Meet at a place nearby" : "Close to you"}>
              {near.map((p, i) => (
                <View key={p.id}>
                  {i > 0 ? <Divider inset={70} /> : null}
                  <Row
                    title={p.name}
                    subtitle={p.sector ?? undefined}
                    icon="navigate-circle"
                    iconTone="neutral"
                    valueNote={distanceLabel(p.distanceM)}
                    onPress={() => choose({ lat: p.lat, lng: p.lng, label: p.name })}
                  />
                </View>
              ))}
            </Group>
          </Enter>
        ) : null}

        {!showingResults && saved.length === 0 && !pickingPickup ? (
          <Enter i={1} style={styles.tip}>
            <Ionicons name="bulb-outline" size={16} color={c.textMuted} />
            <Txt v="label" tone="muted" style={styles.flex}>
              Kigali runs on landmarks. Type a market, school, church or hotel near where you are going.
            </Txt>
          </Enter>
        ) : null}

        {showingResults ? (
          searching && results.length === 0 ? (
            <SkeletonRows count={4} />
          ) : (
            <Group title="Places in Kigali">
              {results.length === 0 ? (
                <Row
                  title="Nothing by that name"
                  subtitle="Try a nearby market, school or church - or set it on the map"
                  icon="help"
                  iconTone="neutral"
                  onPress={() => openMap(editing)}
                />
              ) : (
                results.map((p, i) => (
                  <Enter key={p.id} i={i}>
                    {i > 0 ? <Divider inset={70} /> : null}
                    {/* Names run long - "Nyabugogo International and Long
                        Distance Buses" - and the end is often the part that
                        tells two places apart, so they wrap. */}
                    <Row
                      full
                      title={p.name}
                      subtitle={p.sector ?? undefined}
                      icon="location"
                      iconTone="neutral"
                      valueNote={pickup ? distanceLabel(distanceBetween(pickup, p)) : undefined}
                      onPress={() => choose({ lat: p.lat, lng: p.lng, label: p.name })}
                    />
                  </Enter>
                ))
              )}
            </Group>
          )
        ) : null}
        {/* Geoapify's free plan requires its name wherever its results show. */}
        {showingResults && credit.length > 0 ? (
          <Txt v="label" tone="muted" style={styles.credit}>
            {credit.join(" and ")}. Map data © OpenStreetMap contributors.
          </Txt>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  root: { flex: 1, backgroundColor: c.surface },
  hero: { paddingHorizontal: space.md, gap: space.md },
  heroTop: { flexDirection: "row", alignItems: "center", gap: space.sm },
  backDisc: { borderRadius: 22, backgroundColor: c.heroRaised },
  route: {
    flexDirection: "row",
    gap: space.md,
    backgroundColor: c.surfaceRaised,
    borderRadius: radius.lg,
    paddingLeft: space.md,
    paddingRight: space.xs,
    paddingVertical: space.sm,
  },
  rail: { width: 12, alignItems: "center", paddingTop: 12, paddingBottom: 18 },
  ring: { width: 11, height: 11, borderRadius: 6, borderWidth: 3, borderColor: c.textStrong },
  railLine: { flex: 1, width: 2, borderRadius: 1, backgroundColor: c.border, marginVertical: 3 },
  square: { width: 11, height: 11, borderRadius: 3, backgroundColor: c.destination },
  underline: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border, marginRight: space.sm },
  fromRow: { minHeight: 38, flexDirection: "row", alignItems: "center", gap: space.sm },
  toRow: { minHeight: 46, flexDirection: "row", alignItems: "center" },
  change: { fontFamily: font.semibold },
  inputRow: { flexDirection: "row", alignItems: "center", minHeight: 46 },
  input: {
    flex: 1,
    minWidth: 0,
    fontFamily: font.numBold,
    fontSize: 24,
    color: c.textStrong,
    paddingVertical: 4,
    // The card is the field; the browser's own focus box would sit inside it.
    ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null),
  },
  inputSmall: { fontSize: 19 },
  list: { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.xxl, gap: space.lg },
  quick: { gap: space.md },
  mapRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: c.surfaceRaised,
    ...shadow.card,
  },
  mapIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: c.highlight,
    alignItems: "center",
    justifyContent: "center",
  },
  mapIconMidnight: { backgroundColor: c.hero },
  tip: { flexDirection: "row", gap: space.sm, paddingHorizontal: space.xs },
  credit: { marginTop: -space.sm, paddingHorizontal: space.xs, fontSize: 12 },
  back: { position: "absolute", left: space.md },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0 },
  stack: { gap: space.md },
  pinRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: c.surface,
  },
  pinWell: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  pinWellPickup: { backgroundColor: c.accentSoft },
  pinWellDrop: { backgroundColor: c.tintGreen },
  saveRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
});
