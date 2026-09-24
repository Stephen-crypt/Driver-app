import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { lightTheme, tokens } from "@gera/ui";
import { VEHICLE_CLASSES, type VehicleClass } from "@gera/core";
import { normaliseRwandanPhone } from "@gera/data";
import { supabase } from "../../src/lib/supabase";

function normalisePhone(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    return normaliseRwandanPhone(raw);
  } catch {
    return null;
  }
}

export default function DetailsScreen() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [licence, setLicence] = useState("");
  const [plate, setPlate] = useState("");
  const [vest, setVest] = useState("");
  // moto is first and default: it is the dominant mode in Kigali.
  const [vehicleClass, setVehicleClass] = useState<VehicleClass>("moto");
  const [error, setError] = useState<string | null>(null);

  const ready = name.trim() && licence.trim() && plate.trim();

  async function submit() {
    setError(null);
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      setError("Session expired. Start again.");
      return;
    }

    // Supabase Auth stores the phone digits-only (250788123456), but
    // profiles.phone is E.164 by contract and its unique constraint cannot see
    // that the two spellings are the same person. The old `?? ""` fallback was
    // worse still: it claimed the unique empty-string slot for the first user
    // whose session carried no phone, locking every later one out.
    const phone = normalisePhone(auth.user.phone);
    if (!phone) {
      setError("We could not read your phone number. Start again.");
      return;
    }

    // One atomic call. Three separate inserts were not a transaction: a failure
    // after the first one left the driver wedged, unable to retry and unable to
    // skip the step that had already committed.
    const { error: registerError } = await supabase.rpc("register_driver", {
      p_first_name: name.trim(),
      p_phone: phone,
      p_licence: licence.trim(),
      p_plate: plate.trim().toUpperCase(),
      p_vest: vest.trim() || null,
      p_class: vehicleClass,
    });

    if (registerError) {
      setError(
        registerError.code === "23505"
          ? "Those details are already registered to another account."
          : "We could not submit your details. Check your connection and try again.",
      );
      return;
    }

    router.replace("/onboarding/pending");
  }

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Your details</Text>

      <TextInput style={styles.input} value={name} onChangeText={setName}
        placeholder="First name" placeholderTextColor={lightTheme.textMuted} />
      <TextInput style={styles.input} value={licence} onChangeText={setLicence}
        placeholder="Licence number" placeholderTextColor={lightTheme.textMuted} />
      <TextInput style={styles.input} value={plate} onChangeText={setPlate}
        placeholder="Plate, e.g. RAD 123 B" placeholderTextColor={lightTheme.textMuted}
        autoCapitalize="characters" />
      <TextInput style={styles.input} value={vest} onChangeText={setVest}
        placeholder="Vest number (motos only)" placeholderTextColor={lightTheme.textMuted}
        keyboardType="number-pad" />

      <View style={styles.classRow}>
        {VEHICLE_CLASSES.map((c) => (
          <Pressable
            key={c}
            onPress={() => setVehicleClass(c)}
            style={[styles.chip, vehicleClass === c && styles.chipActive]}
          >
            <Text style={[styles.chipText, vehicleClass === c && styles.chipTextActive]}>
              {c === "cab_xl" ? "Cab XL" : c === "cab" ? "Cab" : "Moto"}
            </Text>
          </Pressable>
        ))}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable style={[styles.cta, !ready && styles.ctaDisabled]} onPress={submit} disabled={!ready}>
        <Text style={styles.ctaText}>Submit for verification</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: lightTheme.surface, padding: tokens.space.lg },
  title: {
    fontSize: tokens.type.title.size, fontWeight: "700",
    color: lightTheme.textStrong, marginTop: tokens.space.xl,
  },
  input: {
    marginTop: tokens.space.md, fontSize: tokens.type.body.size,
    color: lightTheme.textStrong, borderBottomWidth: 1,
    borderBottomColor: lightTheme.textMuted, paddingVertical: tokens.space.sm,
  },
  classRow: { flexDirection: "row", gap: tokens.space.sm, marginTop: tokens.space.lg },
  chip: {
    paddingHorizontal: tokens.space.md, minHeight: tokens.MIN_TOUCH_TARGET,
    justifyContent: "center", borderRadius: tokens.radius.pill,
    borderWidth: 1, borderColor: lightTheme.textMuted,
  },
  chipActive: { backgroundColor: lightTheme.accent, borderColor: lightTheme.accent },
  chipText: { color: lightTheme.text, fontWeight: "600" },
  chipTextActive: { color: lightTheme.onAccent },
  error: { color: lightTheme.danger, marginTop: tokens.space.md },
  cta: {
    marginTop: "auto", marginBottom: tokens.space.xl,
    minHeight: tokens.MIN_TOUCH_TARGET, backgroundColor: lightTheme.accent,
    borderRadius: tokens.radius.lg, alignItems: "center", justifyContent: "center",
  },
  ctaDisabled: { opacity: 0.5 },
  ctaText: { fontSize: tokens.type.body.size, fontWeight: "700", color: lightTheme.onAccent },
});
