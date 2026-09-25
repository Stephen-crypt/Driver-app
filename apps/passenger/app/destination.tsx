import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme, tokens } from "@gera/ui";
import {
  searchLandmarks,
  listSavedPlaces,
  savePlace,
  type Place,
  type SavedPlace,
} from "@gera/data";
import { supabase } from "../src/lib/supabase";
import { TripMap, type LatLng } from "../src/components/TripMap";

const KIGALI = { lat: -1.9403, lng: 30.1128 };

export default function Destination() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pin, setPin] = useState<LatLng | null>(null);
  const [note, setNote] = useState("");
  const [label, setLabel] = useState("");
  const [saved, setSaved] = useState<SavedPlace[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Spec 3.7 orders the picker saved -> gazetteer -> pin. For most passengers on
  // most days the answer is home or work, and making them type it is the
  // difference between one tap and four.
  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(async ({ data }) => {
      const id = data.user?.id ?? null;
      if (!active) return;
      setUserId(id);
      if (!id) return;
      try {
        const places = await listSavedPlaces(supabase, id);
        if (active) setSaved(places);
      } catch {
        // An empty saved list is the normal first-run case.
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);

    if (query.trim().length === 0) {
      setResults([]);
      setBusy(false);
      return;
    }

    // Debounced: one search per keystroke burns the passenger's data bundle, and
    // mobile data in Kigali is bought in bundles, not billed as overage.
    timer.current = setTimeout(() => {
      setBusy(true);
      setError(null);
      searchLandmarks(supabase, query)
        .then(setResults)
        .catch(() => setError("Could not search just now. Check your connection."))
        .finally(() => setBusy(false));
    }, 250);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query]);

  const choose = useCallback(
    (lng: number, lat: number, label: string, howToFind?: string) => {
      router.push({
        pathname: "/ride",
        params: {
          lng: String(lng),
          lat: String(lat),
          label,
          ...(howToFind && howToFind.trim() ? { note: howToFind.trim() } : {}),
        },
      });
    },
    [router],
  );

  const searching = query.trim().length > 0;

  return (
    <View style={styles.root}>
      <View style={[styles.searchBar, { paddingTop: insets.top + tokens.space.sm }]}>
        <View style={styles.inputWrap}>
          <Ionicons name="search" size={18} color={theme.textMuted} />
          <TextInput
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            placeholder="Kimironko, Simba, airport…"
            placeholderTextColor={theme.textMuted}
            autoFocus
            returnKeyType="search"
          />
        </View>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {searching ? (
        <FlatList
          style={styles.list}
          data={results}
          keyExtractor={(p) => p.id}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            busy ? (
              <ActivityIndicator style={styles.spin} color={theme.accent} />
            ) : (
              <Text style={styles.hint}>
                No landmark matches that. Clear the box to drop a pin on the map instead.
              </Text>
            )
          }
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => choose(item.lng, item.lat, item.name)}
              accessibilityRole="button"
            >
              <View style={styles.rowWell}>
                <Ionicons name="location-outline" size={18} color={theme.accent} />
              </View>
              <View style={styles.flex}>
                <Text style={styles.rowName}>{item.name}</Text>
                {item.sector ? <Text style={styles.rowSector}>{item.sector}</Text> : null}
              </View>
              <Ionicons name="arrow-forward" size={16} color={theme.textMuted} />
            </Pressable>
          )}
        />
      ) : (
        <View style={styles.mapWrap}>
          {saved.length > 0 ? (
            <View style={styles.savedBar}>
              {saved.slice(0, 3).map((pl) => (
                <Pressable
                  key={pl.id}
                  style={styles.savedChip}
                  onPress={() => choose(pl.lng, pl.lat, pl.label, pl.note ?? undefined)}
                  accessibilityRole="button"
                >
                  <Ionicons name="bookmark" size={14} color={theme.accent} />
                  <Text style={styles.savedChipText} numberOfLines={1}>
                    {pl.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <TripMap
            center={KIGALI}
            markers={pin ? [{ id: "pin", at: pin, label: "Drop-off", kind: "dropoff" }] : []}
            onPressMap={setPin}
          />
          {pin ? (
            <View style={styles.pinPanel}>
              <Text style={styles.pinTitle}>Drop-off pinned</Text>
              {/* Spec 3.7: a pin without a landmark name is where pickups fail.
                  The note is shown large to the rider. */}
              <TextInput
                style={styles.noteInput}
                value={note}
                onChangeText={setNote}
                placeholder="How to find you — blue gate opposite the pharmacy"
                placeholderTextColor={theme.textMuted}
              />
              <Pressable
                style={styles.cta}
                onPress={() => choose(pin.lng, pin.lat, "Pinned location", note)}
                accessibilityRole="button"
              >
                <Text style={styles.ctaText}>Use this spot</Text>
              </Pressable>
              {userId ? (
                <View style={styles.saveRow}>
                  {/* The label used to default to "Saved place", so every chip
                      came out identical and none of them told you anything. */}
                  <TextInput
                    style={styles.labelInput}
                    value={label}
                    onChangeText={setLabel}
                    placeholder="Name it — Home, Work, Mum's"
                    placeholderTextColor={theme.textMuted}
                  />
                  <Pressable
                    style={[styles.saveButton, !label.trim() && styles.saveButtonOff]}
                    disabled={!label.trim()}
                    onPress={async () => {
                      try {
                        await savePlace(supabase, userId, {
                          label: label.trim(),
                          lng: pin.lng,
                          lat: pin.lat,
                          ...(note.trim() ? { note: note.trim() } : {}),
                        });
                        setLabel("");
                        setSaved(await listSavedPlaces(supabase, userId));
                      } catch {
                        setError("Could not save that place.");
                      }
                    }}
                    accessibilityRole="button"
                  >
                    <Text style={styles.saveButtonText}>Save</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ) : (
            <Text style={styles.tapHint}>Tap the map to drop a pin</Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.surface },
  searchBar: { padding: tokens.space.lg, paddingBottom: tokens.space.sm },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    paddingHorizontal: tokens.space.md,
    borderRadius: tokens.radius.pill,
    backgroundColor: theme.surfaceRaised,
  },
  input: {
    flex: 1,
    minHeight: tokens.MIN_TOUCH_TARGET,
    fontSize: tokens.type.body.size,
    color: theme.textStrong,
  },
  flex: { flex: 1 },
  list: { flex: 1 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    minHeight: tokens.MIN_TOUCH_TARGET + 6,
    paddingHorizontal: tokens.space.lg,
    paddingVertical: tokens.space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
  },
  rowWell: {
    width: 34,
    height: 34,
    borderRadius: tokens.radius.sm,
    backgroundColor: theme.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  rowName: {
    fontSize: tokens.type.body.size,
    fontWeight: "600",
    color: theme.textStrong,
  },
  rowSector: { fontSize: tokens.type.label.size, color: theme.textMuted },
  hint: {
    padding: tokens.space.lg,
    color: theme.textMuted,
    fontSize: tokens.type.body.size,
  },
  tapHint: {
    position: "absolute",
    top: tokens.space.md,
    alignSelf: "center",
    backgroundColor: theme.surfaceRaised,
    elevation: 4,
    color: theme.textStrong,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
    borderRadius: tokens.radius.pill,
    overflow: "hidden",
    fontSize: tokens.type.label.size,
  },
  spin: { marginTop: tokens.space.xl },
  error: {
    color: theme.danger,
    paddingHorizontal: tokens.space.lg,
    fontSize: tokens.type.body.size,
  },
  mapWrap: { flex: 1 },
  savedBar: {
    position: "absolute",
    top: tokens.space.md,
    left: tokens.space.md,
    right: tokens.space.md,
    zIndex: 2,
    flexDirection: "row",
    gap: tokens.space.sm,
  },
  savedChip: {
    flex: 1,
    flexDirection: "row",
    gap: tokens.space.xs,
    minHeight: tokens.MIN_TOUCH_TARGET,
    paddingHorizontal: tokens.space.md,
    borderRadius: tokens.radius.pill,
    backgroundColor: theme.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
    // elevation is Android only - without the shadow props these chips had no
    // separation from the map on iOS at all.
    elevation: 4,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  savedChipText: {
    fontSize: tokens.type.label.size,
    fontWeight: "700",
    color: theme.textStrong,
  },
  saveRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    marginTop: tokens.space.sm,
  },
  labelInput: {
    flex: 1,
    minHeight: tokens.MIN_TOUCH_TARGET,
    paddingHorizontal: tokens.space.md,
    borderRadius: tokens.radius.md,
    backgroundColor: theme.surfaceHigh,
    color: theme.textStrong,
    fontSize: tokens.type.body.size,
  },
  saveButton: {
    minHeight: tokens.MIN_TOUCH_TARGET,
    paddingHorizontal: tokens.space.lg,
    borderRadius: tokens.radius.pill,
    backgroundColor: theme.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  saveButtonOff: { opacity: 0.4 },
  saveButtonText: {
    fontSize: tokens.type.body.size,
    fontWeight: "700",
    color: theme.accent,
  },
  pinPanel: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.surfaceRaised,
    padding: tokens.space.lg,
    borderTopLeftRadius: tokens.radius.xl,
    borderTopRightRadius: tokens.radius.xl,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
    elevation: 12,
  },
  pinTitle: {
    fontSize: tokens.type.title.size,
    fontWeight: "700",
    color: theme.textStrong,
  },
  noteInput: {
    marginTop: tokens.space.sm,
    minHeight: tokens.MIN_TOUCH_TARGET,
    paddingHorizontal: tokens.space.md,
    borderRadius: tokens.radius.md,
    backgroundColor: theme.surfaceHigh,
    fontSize: tokens.type.body.size,
    color: theme.textStrong,
  },
  cta: {
    marginTop: tokens.space.lg,
    minHeight: tokens.MIN_TOUCH_TARGET + 6,
    backgroundColor: theme.accent,
    borderRadius: tokens.radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: {
    fontSize: tokens.type.body.size,
    fontWeight: "700",
    color: theme.onAccent,
  },
});
