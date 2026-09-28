import { useCallback, useState } from "react";
import { Linking, StyleSheet, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import Constants from "expo-constants";
import { Ionicons } from "@expo/vector-icons";
import {
  Button,
  Chip,
  Divider,
  Group,
  Press,
  Row,
  Screen,
  Skeleton,
  Txt,
  VehicleTile,
  VestPatch,
  c,
  radius,
  shadow,
  space,
  useOverlay,
} from "@gera/kit";
import { EMERGENCY_NUMBER, getOpenShift, getRiderProfile, type RiderProfile, type Shift } from "@gera/data";
import { supabase } from "../../src/lib/supabase";
import { useSession } from "../../src/lib/session";

const CLASS_NAME: Record<string, string> = { moto: "Moto", cab: "Cab", cab_xl: "Cab XL" };
const INSET = space.md + 38 + space.md;

export default function Me() {
  const router = useRouter();
  const overlay = useOverlay();
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

  const signOut = async () => {
    const ok = await overlay.confirm({
      title: "Sign out?",
      message: shift ? "Your shift is still open. End it first if you're done for the day." : undefined,
      confirmLabel: "Sign out",
      cancelLabel: "Stay",
      tone: "danger",
    });
    if (!ok) return;
    await supabase.auth.signOut();
    router.replace("/welcome");
  };

  return (
    <Screen gap={space.lg}>
      {/* The rider's badge: the vest number is who they are to a passenger. */}
      <View key="badge" style={styles.badge}>
        {profile ? (
          <>
            {vest ? <VestPatch value={vest} size="lg" label={`Vest number ${vest}`} roll /> : null}
            <View style={styles.flex}>
              <Txt v="title" lines={1}>
                {profile.firstName}
              </Txt>
              <Txt v="label" tone="muted">
                {profile.phone ?? ""}
              </Txt>
              <View style={styles.chips}>
                {profile.rating ? (
                  <View style={styles.rating} accessibilityLabel={`Rated ${profile.rating.toFixed(1)} from ${profile.ratingCount} ratings`}>
                    <Ionicons name="star" size={13} color={c.warning} />
                    <Txt v="caption" tone="strong" tabularNums>
                      {profile.rating.toFixed(1)}
                    </Txt>
                    <Txt v="caption" tone="muted">
                      ({profile.ratingCount})
                    </Txt>
                  </View>
                ) : (
                  <Chip label="No ratings yet" />
                )}
                {profile.verification === "verified" ? <Chip label="Verified" tone="good" icon="checkmark" /> : null}
              </View>
            </View>
          </>
        ) : (
          <>
            <Skeleton width={72} height={74} r={14} />
            <View style={[styles.flex, styles.skText]}>
              <Skeleton width="60%" height={28} r={8} />
              <Skeleton width="45%" height={14} />
            </View>
          </>
        )}
      </View>

      <Press key="qr" onPress={() => router.push("/qr")} style={styles.qr} accessibilityRole="button" accessibilityLabel="Show your QR code to an inspector">
        <View style={styles.qrIcon}>
          <Ionicons name="qr-code" size={24} color={c.onAccent} />
        </View>
        <View style={styles.flex}>
          <Txt v="bodyStrong" tone="inverse">
            Show your QR code
          </Txt>
          <Txt v="label" tone="inverse" style={styles.soft}>
            For a Gera inspector at a checkpoint
          </Txt>
        </View>
        <Ionicons name="chevron-forward" size={20} color={c.onAccent} />
      </Press>

      <Group key="vehicle" title="Your vehicle">
        {profile?.vehicle ? (
          <Row
            title={profile.vehicle.plate}
            subtitle={`${CLASS_NAME[profile.vehicle.vehicleClass] ?? "Vehicle"}, company vehicle`}
            leading={<VehicleTile kind={profile.vehicle.vehicleClass} size={38} onGrey />}
            value={vest ? String(vest) : undefined}
            valueNote={vest ? "vest" : undefined}
          />
        ) : (
          <Row title="No vehicle assigned" subtitle="The fleet office assigns one before your first shift." icon="alert-circle" iconTone="neutral" />
        )}
      </Group>

      <Group key="work" title="Work">
        {shift ? (
          <Row title="End shift" subtitle="Report the vehicle's condition and hand over" icon="flag" onPress={() => router.push("/shift/end")} />
        ) : (
          <Row title="Start shift" subtitle="Safety checks, then you can go online" icon="shield-checkmark" onPress={() => router.push("/shift/start")} />
        )}
        <Divider inset={INSET} />
        <Row title="Report a problem" subtitle="Vehicle, safety, an accident" icon="construct" iconTone="warn" onPress={() => router.push("/report")} />
        <Divider inset={INSET} />
        <Row title="Your reports" subtitle="What you reported and the office's answer" icon="documents" onPress={() => router.push("/reports")} />
        <Divider inset={INSET} />
        <Row title="My documents" subtitle="Driving licence and national ID" icon="document-text" onPress={() => router.push({ pathname: "/onboarding/documents", params: { from: "me" } })} />
      </Group>

      <Group key="safety" title="Safety">
        <Row title="Riding safely" subtitle="Helmets, passengers, cash and night rides" icon="shield-half" iconTone="good" onPress={() => router.push("/safety")} />
        <Divider inset={INSET} />
        <Row
          title={`Call ${EMERGENCY_NUMBER}`}
          subtitle="Police, ambulance and fire"
          icon="call"
          iconTone="bad"
          onPress={() => void Linking.openURL(`tel:${EMERGENCY_NUMBER}`)}
        />
      </Group>

      <View key="out" style={styles.out}>
        <Button label="Sign out" variant="quiet" onPress={() => void signOut()} />
        <Txt v="caption" tone="muted" align="center">
          Gera Rider {Constants.expoConfig?.version ?? ""}
        </Txt>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.md,
    marginTop: space.md,
    borderRadius: radius.lg,
    backgroundColor: c.surfaceRaised,
    minHeight: 116,
  },
  skText: { gap: space.sm },
  chips: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.sm, flexWrap: "wrap" },
  rating: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: c.warningSoft,
  },
  qr: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: c.accentDeep,
    ...shadow.float,
  },
  qrIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.14)",
    alignItems: "center",
    justifyContent: "center",
  },
  soft: { opacity: 0.8 },
  out: { gap: space.xs },
});
