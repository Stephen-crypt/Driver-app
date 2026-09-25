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
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pin, setPin] = useState<LatLng | null>(null);
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState<SavedPlace[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Spec 3.7 orders the picker saved -> gazetteer -> pin. For most riders on
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

    // Debounced: one search per keystroke burns the rider's data bundle, and
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
      <View style={styles.searchBar}>
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
              <Text style={styles.rowName}>{item.name}</Text>
              {item.sector ? <Text style={styles.rowSector}>{item.sector}</Text> : null}
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
                  The note is shown large to the driver. */}
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
                <Pressable
                  style={styles.saveLink}
                  onPress={async () => {
                    try {
                      await savePlace(supabase, userId, {
                        label: note.trim() || "Saved place",
                        lng: pin.lng,
                        lat: pin.lat,
                        ...(note.trim() ? { note: note.trim() } : {}),
                      });
                      setSaved(await listSavedPlaces(supabase, userId));
                    } catch {
                      setError("Could not save that place.");
                    }
                  }}
                  accessibilityRole="button"
                >
                  <Text style={styles.saveLinkText}>Save this place</Text>
                </Pressable>
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
  input: {
    minHeight: tokens.MIN_TOUCH_TARGET,
    fontSize: tokens.type.body.size,
    color: theme.textStrong,
    borderWidth: 2,
    borderColor: theme.accent,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.space.md,
  },
  list: { flex: 1 },
  row: {
    minHeight: tokens.MIN_TOUCH_TARGET,
    justifyContent: "center",
    paddingHorizontal: tokens.space.lg,
    paddingVertical: tokens.space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.textMuted,
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
    minHeight: tokens.MIN_TOUCH_TARGET,
    paddingHorizontal: tokens.space.md,
    borderRadius: tokens.radius.pill,
    backgroundColor: theme.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
  },
  savedChipText: {
    fontSize: tokens.type.label.size,
    fontWeight: "700",
    color: theme.textStrong,
  },
  saveLink: {
    minHeight: tokens.MIN_TOUCH_TARGET,
    alignItems: "center",
    justifyContent: "center",
  },
  saveLinkText: { fontSize: tokens.type.body.size, color: theme.textMuted },
  pinPanel: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.surfaceRaised,
    padding: tokens.space.lg,
    borderTopLeftRadius: tokens.radius.lg,
    borderTopRightRadius: tokens.radius.lg,
  },
  pinTitle: {
    fontSize: tokens.type.title.size,
    fontWeight: "700",
    color: theme.textStrong,
  },
  noteInput: {
    marginTop: tokens.space.sm,
    minHeight: tokens.MIN_TOUCH_TARGET,
    fontSize: tokens.type.body.size,
    color: theme.textStrong,
    borderBottomWidth: 2,
    borderBottomColor: theme.accent,
  },
  cta: {
    marginTop: tokens.space.lg,
    minHeight: tokens.MIN_TOUCH_TARGET,
    backgroundColor: theme.accent,
    borderRadius: tokens.radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: {
    fontSize: tokens.type.body.size,
    fontWeight: "700",
    color: theme.onAccent,
  },
});
