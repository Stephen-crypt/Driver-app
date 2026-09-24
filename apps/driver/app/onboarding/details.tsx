import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { lightTheme, tokens } from "@gera/ui";
import { VEHICLE_CLASSES, type VehicleClass } from "@gera/core";
import { supabase } from "../../src/lib/supabase";

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

    const { error: profileError } = await supabase.from("profiles").insert({
      id: auth.user.id,
      role: "driver",
      first_name: name.trim(),
      phone: auth.user.phone ?? "",
    });
    if (profileError) return setError(profileError.message);

    const { error: driverError } = await supabase.from("drivers").insert({
      id: auth.user.id,
      licence_number: licence.trim(),
      verification: "submitted",
    });
    if (driverError) return setError(driverError.message);

    const { error: vehicleError } = await supabase.from("vehicles").insert({
      driver_id: auth.user.id,
      class: vehicleClass,
      plate: plate.trim().toUpperCase(),
      vest_number: vest.trim() || null,
      is_active: false,
    });
    if (vehicleError) return setError(vehicleError.message);

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
