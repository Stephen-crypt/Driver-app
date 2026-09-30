import { useEffect, useRef, useState } from "react";
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
  type LatLng,
} from "@nova/kit";
import { distanceBetween, distanceLabel, landmarksNear, listSavedPlaces, savePlace, searchLandmarks, type NearPlace, type Place, type SavedPlace } from "@nova/data";
import { supabase } from "../src/lib/supabase";
import { useSession } from "../src/lib/session";
import { goBack } from "../src/lib/nav";
import * as loc from "../src/lib/location";
import { useLightStatusBar } from "../src/lib/statusBar";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function placeIcon(label: string): "home" | "briefcase" | "bookmark" {
  return /home|urugo/i.test(label) ? "home" : /work|office|akazi/i.test(label) ? "briefcase" : "bookmark";
}

/**
 * Spec 3.7: saved places, then the landmark gazetteer, then a pin. Kigali
 * addresses are landmarks - "the blue gate opposite the pharmacy" - so a pin
 * always asks how to find you.
 */
export default function Destination() {
  useLightStatusBar();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const overlay = useOverlay();
  const { userId } = useSession();
  const params = useLocalSearchParams<Record<string, string | string[]>>();

  const pickup = {
    plat: one(params.plat),
    plng: one(params.plng),
    plabel: one(params.plabel),
  };
  const mode = one(params.mode);
  const vehicle = one(params.vehicle);

  const [query, setQuery] = useState(one(params.q) ?? "");
  const [results, setResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedPlace[]>([]);
  const [near, setNear] = useState<NearPlace[]>([]);
  // Account opens this straight onto the map to save a new place.
  const [mapMode, setMapMode] = useState(one(params.map) === "1");
  const [pin, setPin] = useState<LatLng | null>(null);
  const [note, setNote] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    // Debounced: mobile data in Kigali is bought in bundles.
    setSearching(true);
    timer.current = setTimeout(() => {
      setError(null);
      searchLandmarks(supabase, query)
        .then(setResults)
        .catch(() => setError("Could not search just now. Check your connection."))
        .finally(() => setSearching(false));
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query]);

  const choose = (lng: number, lat: number, dest: string, destNote?: string) => {
    router.replace({
      pathname: "/ride",
      params: {
        lng: String(lng),
        lat: String(lat),
        label: dest,
        ...(destNote ? { note: destNote } : {}),
        ...(pickup.plat ? { plat: pickup.plat } : {}),
        ...(pickup.plng ? { plng: pickup.plng } : {}),
        ...(pickup.plabel ? { plabel: pickup.plabel } : {}),
        ...(mode ? { mode } : {}),
        ...(vehicle ? { vehicle } : {}),
      },
    });
  };

  const here: LatLng | null =
    pickup.plat && pickup.plng ? { lat: Number(pickup.plat), lng: Number(pickup.plng) } : null;

  // Before they type: the landmarks closest to them, which is usually where
  // a short trip goes.
  useEffect(() => {
    if (!here) return;
    landmarksNear(supabase, here, 5).then(setNear).catch(() => {});
  }, [pickup.plat, pickup.plng]); // eslint-disable-line react-hooks/exhaustive-deps

  if (mapMode) {
    return (
      <View style={styles.root}>
        <NovaMap
          center={pin ?? here ?? loc.KIGALI_FALLBACK}
          markers={[
            ...(here ? [{ id: "me", at: here, kind: "me" as const }] : []),
            ...(pin ? [{ id: "pin", at: pin, kind: "dropoff" as const, tag: "Drop-off" }] : []),
          ]}
          onPressMap={setPin}
          bottomInset={pin ? 360 : 140}
        />
        <FloatButton icon="arrow-back" label="Back to search" onPress={() => setMapMode(false)} style={[styles.back, { top: insets.top + space.sm }]} />
        <View style={styles.sheet}>
          <Paper>
            {pin ? (
              <Swap id="pinned" style={styles.stack}>
                <Txt v="h2">Drop-off pinned</Txt>
                <Field
                  label="How will your rider find it?"
                  value={note}
                  onChangeText={setNote}
                  placeholder="Blue gate opposite the pharmacy"
                  onPaper
                />
                {userId ? (
                  <View style={styles.saveRow}>
                    <View style={styles.flex}>
                      <Field value={label} onChangeText={setLabel} placeholder="Save as - Home, Work, Mum's" onPaper />
                    </View>
                    <Button
                      label="Save"
                      variant="secondary"
                      compact
                      loading={saving}
                      disabled={!label.trim()}
                      onPress={async () => {
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
                <Button label="Go here" onPress={() => choose(pin.lng, pin.lat, label.trim() || "Pinned location", note.trim())} />
              </Swap>
            ) : (
              <Swap id="tap" style={styles.stack}>
                <View style={styles.tapHead}>
                  <View style={styles.tapIcon}>
                    <Ionicons name="hand-left" size={20} color={c.accent} />
                  </View>
                  <View style={styles.flex}>
                    <Txt v="h2">Tap the map</Txt>
                    <Txt v="body" tone="muted">
                      Put the pin where your rider should drop you.
                    </Txt>
                  </View>
                </View>
              </Swap>
            )}
          </Paper>
        </View>
      </View>
    );
  }

  const showingResults = query.trim().length > 0;

  return (
    <View style={styles.root}>
      <Hero style={styles.hero}>
        <View style={styles.heroTop}>
          <View style={styles.backDisc}>
            <IconButton icon="arrow-back" label="Back" onPress={() => goBack(router)} size={44} tone="onDark" />
          </View>
          <Txt v="section" tone="onHero">
            {mode === "later" ? "Book ahead" : mode === "regular" ? "Regular trip" : "Plan your ride"}
          </Txt>
        </View>
        {/* The same route drawing as everywhere else: the ring is where you
            are, the square is what you are typing. */}
        <View style={styles.route}>
          <View style={styles.rail} pointerEvents="none">
            <View style={styles.ring} />
            <View style={styles.railLine} />
            <View style={styles.square} />
          </View>
          <View style={styles.flex}>
            <View style={styles.fromRow}>
              <Txt v="label" tone="muted" lines={1} style={styles.flex}>
                {pickup.plabel ?? "Current location"}
              </Txt>
            </View>
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                value={query}
                onChangeText={setQuery}
                placeholder="Where to?"
                placeholderTextColor={c.textMuted}
                autoFocus
                returnKeyType="search"
                accessibilityLabel="Where to?"
              />
              {query ? (
                <IconButton icon="close-circle" label="Clear the search" onPress={() => setQuery("")} size={34} />
              ) : null}
            </View>
          </View>
        </View>
      </Hero>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.list}>
        {error ? <Banner tone="bad" icon="alert-circle">{error}</Banner> : null}

        <Enter i={0}>
          <Press onPress={() => setMapMode(true)} scaleTo={0.985} style={styles.mapRow} accessibilityRole="button" accessibilityLabel="Choose on the map">
            <View style={styles.mapIcon}>
              <Ionicons name="map" size={20} color={c.onHighlight} />
            </View>
            <View style={styles.flex}>
              <Txt v="bodyStrong">Choose on the map</Txt>
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
                    onPress={() => choose(p.lng, p.lat, p.label, p.note ?? undefined)}
                  />
                </View>
              ))}
            </Group>
          </Enter>
        ) : null}

        {!showingResults && near.length > 0 ? (
          <Enter i={2}>
            <Group title="Close to you">
              {near.map((p, i) => (
                <View key={p.id}>
                  {i > 0 ? <Divider inset={70} /> : null}
                  <Row
                    title={p.name}
                    subtitle={p.sector ?? undefined}
                    icon="navigate-circle"
                    iconTone="neutral"
                    valueNote={distanceLabel(p.distanceM)}
                    onPress={() => choose(p.lng, p.lat, p.name)}
                  />
                </View>
              ))}
            </Group>
          </Enter>
        ) : null}

        {!showingResults && saved.length === 0 ? (
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
                  title="No landmark by that name"
                  subtitle="Try a nearby market, school or church - or drop a pin"
                  icon="help"
                  iconTone="neutral"
                  onPress={() => setMapMode(true)}
                />
              ) : (
                results.map((p, i) => (
                  <Enter key={p.id} i={i}>
                    {i > 0 ? <Divider inset={70} /> : null}
                    <Row
                      title={p.name}
                      subtitle={p.sector ?? undefined}
                      icon="location"
                      iconTone="neutral"
                      valueNote={here ? distanceLabel(distanceBetween(here, p)) : undefined}
                      onPress={() => choose(p.lng, p.lat, p.name)}
                    />
                  </Enter>
                ))
              )}
            </Group>
          )
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
  fromRow: { minHeight: 34, justifyContent: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border, marginRight: space.sm },
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
  list: { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.xxl, gap: space.lg },
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
  tip: { flexDirection: "row", gap: space.sm, paddingHorizontal: space.xs },
  back: { position: "absolute", left: space.md },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0 },
  stack: { gap: space.md },
  tapHead: { flexDirection: "row", alignItems: "center", gap: space.md },
  tapIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: c.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  saveRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
});
