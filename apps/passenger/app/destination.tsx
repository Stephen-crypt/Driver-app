import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import {
  Banner,
  Button,
  Divider,
  Field,
  GeraMap,
  Group,
  Paper,
  Row,
  Txt,
  c,
  font,
  radius,
  space,
  type LatLng,
} from "@gera/kit";
import { listSavedPlaces, savePlace, searchLandmarks, type Place, type SavedPlace } from "@gera/data";
import { supabase } from "../src/lib/supabase";
import { useSession } from "../src/lib/session";
import { goBack } from "../src/lib/nav";
import * as loc from "../src/lib/location";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Spec 3.7: saved places, then the landmark gazetteer, then a pin. Kigali
 * addresses are landmarks - "the blue gate opposite the pharmacy" - so a pin
 * always asks how to find you.
 */
export default function Destination() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { userId } = useSession();
  const params = useLocalSearchParams<Record<string, string | string[]>>();

  const pickup = {
    plat: one(params.plat),
    plng: one(params.plng),
    plabel: one(params.plabel),
  };

  const [query, setQuery] = useState(one(params.q) ?? "");
  const [results, setResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedPlace[]>([]);
  const [mapMode, setMapMode] = useState(false);
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
    timer.current = setTimeout(() => {
      setSearching(true);
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
      },
    });
  };

  const here: LatLng | null =
    pickup.plat && pickup.plng ? { lat: Number(pickup.plat), lng: Number(pickup.plng) } : null;

  if (mapMode) {
    return (
      <View style={styles.root}>
        <GeraMap
          center={pin ?? here ?? loc.KIGALI_FALLBACK}
          markers={[
            ...(here ? [{ id: "me", at: here, kind: "me" as const }] : []),
            ...(pin ? [{ id: "pin", at: pin, kind: "dropoff" as const, tag: "Drop-off" }] : []),
          ]}
          onPressMap={setPin}
          bottomInset={pin ? 360 : 140}
        />
        <Pressable
          onPress={() => setMapMode(false)}
          style={[styles.back, { top: insets.top + space.sm }]}
          accessibilityRole="button"
          accessibilityLabel="Back to search"
        >
          <Ionicons name="arrow-back" size={22} color={c.textStrong} />
        </Pressable>
        <View style={styles.sheet}>
          <Paper>
            {pin ? (
              <View style={styles.stack}>
                <Txt v="title">Drop-off pinned</Txt>
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
                          setLabel("");
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
                  label="Go here"
                  onPress={() => choose(pin.lng, pin.lat, label.trim() || "Pinned location", note.trim())}
                />
              </View>
            ) : (
              <View style={styles.stack}>
                <Txt v="title">Tap the map</Txt>
                <Txt v="body" tone="muted">
                  Put the pin where your rider should drop you.
                </Txt>
              </View>
            )}
          </Paper>
        </View>
      </View>
    );
  }

  const showingResults = query.trim().length > 0;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack(router)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={24} color={c.textStrong} />
        </Pressable>
        <View style={styles.route}>
          <View style={styles.routeRow}>
            <View style={styles.dotPick} />
            <Txt v="label" tone="muted" lines={1} style={styles.flex}>
              {pickup.plabel ?? "Current location"}
            </Txt>
          </View>
          <View style={styles.routeRow}>
            <View style={styles.dotDrop} />
            <TextInput
              style={styles.input}
              value={query}
              onChangeText={setQuery}
              placeholder="Where to?"
              placeholderTextColor={c.textMuted}
              autoFocus
              returnKeyType="search"
            />
            {query ? (
              <Pressable onPress={() => setQuery("")} hitSlop={10} accessibilityLabel="Clear">
                <Ionicons name="close-circle" size={20} color={c.textMuted} />
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.list}>
        {error ? <Banner tone="bad" icon="alert-circle">{error}</Banner> : null}

        <Group>
          <Row title="Choose on the map" subtitle="For anywhere without a name" icon="map" onPress={() => setMapMode(true)} />
        </Group>

        {!showingResults && saved.length > 0 ? (
          <Group title="Saved">
            {saved.map((p, i) => (
              <View key={p.id}>
                {i > 0 ? <Divider inset={70} /> : null}
                <Row
                  title={p.label}
                  subtitle={p.note ?? undefined}
                  icon={/home/i.test(p.label) ? "home" : /work|office/i.test(p.label) ? "briefcase" : "bookmark"}
                  onPress={() => choose(p.lng, p.lat, p.label, p.note ?? undefined)}
                />
              </View>
            ))}
          </Group>
        ) : null}

        {showingResults ? (
          <Group title="Places in Kigali">
            {searching && results.length === 0 ? (
              <ActivityIndicator color={c.accent} style={styles.spin} />
            ) : results.length === 0 ? (
              <Row
                title="No landmark by that name"
                subtitle="Try a nearby market, school or church - or drop a pin"
                icon="help"
                iconTone="neutral"
              />
            ) : (
              results.map((p, i) => (
                <View key={p.id}>
                  {i > 0 ? <Divider inset={70} /> : null}
                  <Row
                    title={p.name}
                    subtitle={p.sector ?? undefined}
                    icon="location"
                    iconTone="neutral"
                    onPress={() => choose(p.lng, p.lat, p.name)}
                  />
                </View>
              ))
            )}
          </Group>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  root: { flex: 1, backgroundColor: c.surface },
  header: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md },
  route: {
    flex: 1,
    backgroundColor: c.surfaceRaised,
    borderRadius: radius.lg,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    gap: 2,
  },
  routeRow: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 36 },
  dotPick: { width: 10, height: 10, borderRadius: 5, backgroundColor: c.textStrong },
  dotDrop: { width: 10, height: 10, borderRadius: 2, backgroundColor: c.destination },
  input: { flex: 1, minWidth: 0, fontFamily: font.num, fontSize: 22, color: c.textStrong, paddingVertical: 4 },
  list: { paddingHorizontal: space.lg, paddingBottom: space.xxl, gap: space.lg },
  spin: { margin: space.lg },
  back: {
    position: "absolute",
    left: space.md,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: c.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0 },
  stack: { gap: space.md },
  saveRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
});
