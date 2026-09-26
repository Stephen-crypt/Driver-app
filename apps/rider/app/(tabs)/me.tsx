import { useCallback, useState } from "react";
import { Alert, Linking, StyleSheet, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Button, Chip, Divider, Group, Row, Screen, Txt, VestPatch, space } from "@gera/kit";
import { EMERGENCY_NUMBER, getOpenShift, getRiderProfile, type RiderProfile, type Shift } from "@gera/data";
import { supabase } from "../../src/lib/supabase";
import { useSession } from "../../src/lib/session";

const CLASS_NAME: Record<string, string> = { moto: "Moto", cab: "Cab", cab_xl: "Cab XL" };

export default function Me() {
  const router = useRouter();
  const { riderId } = useSession();
  const [profile, setProfile] = useState<RiderProfile | null>(null);
  const [shift, setShift] = useState<Shift | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!riderId) return;
      let active = true;
      Promise.all([getRiderProfile(supabase, riderId), getOpenShift(supabase, riderId)])
        .then(([p, s]) => {
          if (!active) return;
          setProfile(p);
          setShift(s);
        })
        .catch(() => {});
      return () => {
        active = false;
      };
    }, [riderId]),
  );

  const vest = profile?.vehicle?.vestNumber;

  return (
    <Screen>
      <View style={styles.identity}>
        {vest ? <VestPatch value={vest} size="xl" label={`Vest number ${vest}`} /> : null}
        <View style={styles.flex}>
          <Txt v="title" lines={1}>
            {profile?.firstName ?? " "}
          </Txt>
          <Txt v="body" tone="muted">
            {profile?.phone ?? ""}
          </Txt>
          <View style={styles.chips}>
            {profile?.rating ? (
              <Chip label={`★ ${profile.rating.toFixed(1)} · ${profile.ratingCount} ratings`} tone="accent" />
            ) : (
              <Chip label="No ratings yet" />
            )}
            {profile?.verification === "verified" ? <Chip label="Verified" tone="good" icon="checkmark" /> : null}
          </View>
        </View>
      </View>

      <View style={styles.stack}>
        <Group title="Your vehicle">
          {profile?.vehicle ? (
            <Row
              title={profile.vehicle.plate}
              subtitle={`${CLASS_NAME[profile.vehicle.vehicleClass] ?? "Vehicle"}${vest ? ` · vest ${vest}` : ""} · company vehicle`}
              icon="bicycle"
            />
          ) : (
            <Row title="No vehicle assigned" subtitle="The fleet office assigns one before your first shift." icon="bicycle" iconTone="neutral" />
          )}
        </Group>

        <Group title="Work">
          {shift ? (
            <Row title="End shift" subtitle="Report the vehicle's condition and hand over" icon="flag" onPress={() => router.push("/shift/end")} />
          ) : (
            <Row title="Start shift" subtitle="Safety checks, then you can go online" icon="shield-checkmark" onPress={() => router.push("/shift/start")} />
          )}
          <Divider inset={70} />
          <Row title="Report a problem" subtitle="Vehicle, safety, an accident" icon="construct" iconTone="warn" onPress={() => router.push("/report")} />
          <Divider inset={70} />
          <Row title="Your reports" subtitle="What you reported and the office's answer" icon="documents" onPress={() => router.push("/reports")} />
          <Divider inset={70} />
          <Row title="My documents" subtitle="Driving licence and national ID" icon="document-text" onPress={() => router.push("/onboarding/documents")} />
        </Group>

        <Group title="Safety">
          <Row title="Riding safely" subtitle="Helmets, passengers, cash and night rides" icon="shield-half" iconTone="good" onPress={() => router.push("/safety")} />
          <Divider inset={70} />
          <Row
            title={`Call ${EMERGENCY_NUMBER}`}
            subtitle="Police, ambulance and fire"
            icon="call"
            iconTone="bad"
            onPress={() => void Linking.openURL(`tel:${EMERGENCY_NUMBER}`)}
          />
        </Group>

        <Button
          label="Sign out"
          variant="quiet"
          onPress={() =>
            Alert.alert("Sign out?", shift ? "End your shift first if you're done for the day." : "", [
              { text: "Stay", style: "cancel" },
              {
                text: "Sign out",
                style: "destructive",
                onPress: () => void supabase.auth.signOut().then(() => router.replace("/welcome")),
              },
            ])
          }
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  identity: { flexDirection: "row", alignItems: "center", gap: space.md, paddingTop: space.lg, paddingBottom: space.xl },
  chips: { flexDirection: "row", gap: space.xs, marginTop: space.sm, flexWrap: "wrap" },
  stack: { gap: space.lg },
});

