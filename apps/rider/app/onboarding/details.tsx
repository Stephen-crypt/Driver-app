import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Banner, Button, Field, Screen, Txt, c, radius, space, tap } from "@gera/kit";
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

const CLASS_LABEL: Record<VehicleClass, string> = { moto: "Moto", cab: "Cab", cab_xl: "Cab XL" };

export default function DetailsScreen() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [licence, setLicence] = useState("");
  const [plate, setPlate] = useState("");
  const [vest, setVest] = useState("");
  // moto is first and default: it is the dominant mode in Kigali.
  const [vehicleClass, setVehicleClass] = useState<VehicleClass>("moto");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ready = Boolean(name.trim() && licence.trim() && plate.trim());

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        setError("Session expired. Start again.");
        return;
      }

      // Supabase Auth stores the phone digits-only (250788123456), but
      // profiles.phone is E.164 by contract and its unique constraint cannot see
      // that the two spellings are the same person.
      const phone = normalisePhone(auth.user.phone);
      if (!phone) {
        setError("We could not read your phone number. Start again.");
        return;
      }

      // One atomic call. Three separate inserts were not a transaction: a
      // failure after the first one left the rider wedged.
      const { error: registerError } = await supabase.rpc("register_rider", {
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

      // Documents before the waiting room: a rider parked on "pending" with
      // nothing uploaded is waiting for a review that can never happen.
      router.replace("/onboarding/documents");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title="About you"
      subtitle="As it appears on your licence."
      footer={<Button label="Continue" onPress={submit} loading={busy} disabled={!ready} />}
    >
      <View style={styles.stack}>
        <Field label="First name" value={name} onChangeText={setName} autoCapitalize="words" />
        <Field label="Driving licence number" value={licence} onChangeText={setLicence} autoCapitalize="characters" />

        <View style={styles.group}>
          <Txt v="label" tone="muted" style={styles.label}>
            What you ride
          </Txt>
          <View style={styles.segments}>
            {VEHICLE_CLASSES.map((k) => {
              const on = vehicleClass === k;
              return (
                <Pressable
                  key={k}
                  onPress={() => {
                    tap();
                    setVehicleClass(k);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  style={[styles.segment, on && styles.segmentOn]}
                >
                  <Txt v="bodyStrong" tone={on ? "inverse" : "strong"}>
                    {CLASS_LABEL[k]}
                  </Txt>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Field
          label="Plate"
          value={plate}
          onChangeText={setPlate}
          placeholder="RAD 123 B"
          autoCapitalize="characters"
        />
        {vehicleClass === "moto" ? (
          <Field
            label="Vest number"
            value={vest}
            onChangeText={setVest}
            keyboardType="number-pad"
            hint="The number on the back of your vest. Passengers look for it."
          />
        ) : null}

        {error ? <Banner tone="bad" icon="alert-circle">{error}</Banner> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.md },
  group: { gap: 6 },
  label: { marginLeft: space.xs },
  segments: { flexDirection: "row", gap: space.sm },
  segment: {
    flex: 1,
    minHeight: 52,
    borderRadius: radius.md,
    backgroundColor: c.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentOn: { backgroundColor: c.textStrong },
});
