import { StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  Button,
  Chip,
  Enter,
  Odometer,
  PinPatches,
  Press,
  Pulse,
  QuickAction,
  QuickActions,
  RouteRail,
  TripProgress,
  Txt,
  VEHICLE_NAME,
  VehicleGlyph,
  VestPatch,
  Well,
  c,
  money,
  radius,
  space,
  type IconName,
  type VehicleKind,
} from "@gera/kit";
import { waitingChargeFor } from "@gera/core";
import type { RiderCard, RiderPosition, TripSnapshot, WaitStatus } from "@gera/data";

function minutes(seconds: number | null | undefined): string {
  if (!seconds || seconds < 60) return "1";
  return String(Math.round(seconds / 60));
}

function clock(total: number): string {
  const s = Math.max(0, Math.floor(total));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const STEPS = ["Rider on the way", "Rider at pickup", "On your trip"];

export function Searching({
  onCancel,
  busy,
  vehicle,
  from,
  to,
}: {
  readonly onCancel: () => void;
  readonly busy: boolean;
  readonly vehicle: string;
  readonly from: string;
  readonly to: string;
}) {
  return (
    <View style={styles.stack}>
      <View style={styles.searching}>
        <Pulse size={132}>
          <VehicleGlyph kind={vehicle} size={30} colour={c.onAccent} />
        </Pulse>
        <Txt v="title" align="center">
          Finding you a rider
        </Txt>
        <Txt v="body" tone="muted" align="center">
          Usually under a minute. We ask the closest riders one at a time.
        </Txt>
      </View>
      <View style={styles.summary}>
        <RouteRail dense from={{ label: from }} to={{ label: to }} />
      </View>
      <Button label="Cancel request" variant="quiet" onPress={onCancel} disabled={busy} compact />
    </View>
  );
}

/**
 * Who is coming, how soon, and the PIN. The PIN is set in vest patches, the same
 * numerals the rider wears on their back: the two numbers that prove to each
 * of them that the other is the right person.
 *
 * The first time a rider appears is the one orchestrated moment in the
 * passenger app: the vest patch turns to the rider's number, then their name
 * and plate arrive after it.
 */
export function Assigned({
  trip,
  rider,
  riderAt,
  pin,
  wait,
  now,
  busy,
  onCall,
  onShare,
  onSos,
  onCancel,
  onRider,
}: {
  readonly trip: TripSnapshot;
  readonly rider: RiderCard | null;
  readonly riderAt: RiderPosition | null;
  readonly pin: string | null;
  readonly wait: { status: WaitStatus; readAt: number } | null;
  readonly now: number;
  readonly busy: boolean;
  readonly onCall: () => void;
  readonly onShare: () => void;
  readonly onSos: () => void;
  readonly onCancel: () => void;
  readonly onRider: () => void;
}) {
  const name = rider?.firstName ?? "Your rider";
  const arrived = trip.state === "arrived";
  const moving = trip.state === "in_progress";
  const step = moving ? 2 : arrived ? 1 : 0;

  let headline: string;
  let sub: string | null = null;
  if (moving) {
    headline = `On the way to ${trip.dropoffLabel}`;
    sub = riderAt ? "Arriving in about" : null;
  } else if (arrived) {
    headline = `${name} is here`;
    // Pickup labels are often "Near X" already; "At Near X" reads as a typo.
    sub = trip.pickupLabel.startsWith("Near ") ? trip.pickupLabel : `At ${trip.pickupLabel}`;
  } else {
    headline = `${name} is on the way`;
    sub = "Heading to your pickup";
  }

  const s = wait?.status;
  const waited = s ? s.waitedSeconds + Math.floor((now - wait!.readAt) / 1000) : 0;
  const grace = s?.graceSeconds ?? 300;
  const freeLeft = Math.max(0, grace - waited);
  const charge = s ? waitingChargeFor(waited, grace, s.perMinuteRwf) : 0;
  const showEta = !arrived && riderAt;

  return (
    <View style={styles.stack}>
      <TripProgress steps={STEPS} current={step} />

      <View style={styles.headRow}>
        <View style={styles.flex}>
          <Txt v="title" lines={2}>
            {headline}
          </Txt>
          {sub ? (
            <Txt v="label" tone="muted">
              {sub}
            </Txt>
          ) : null}
        </View>
        {showEta ? (
          <View style={styles.eta} accessibilityLabel={`${minutes(riderAt.etaSeconds)} minutes`}>
            <Odometer value={minutes(riderAt.etaSeconds)} v="display" />
            <Txt v="caption" tone="muted">
              min
            </Txt>
          </View>
        ) : null}
      </View>

      {rider ? (
        <Press onPress={onRider} scaleTo={0.985} style={styles.rider} accessibilityRole="button" accessibilityLabel={`${rider.firstName}, vest ${rider.vestNumber ?? "unknown"}, plate ${rider.plate ?? "unknown"}. More about your rider`}>
          {rider.vestNumber ? <VestPatch value={rider.vestNumber} size="md" roll label={`Vest ${rider.vestNumber}`} /> : null}
          <Enter i={3} style={styles.flex}>
            <Txt v="heading">{rider.firstName}</Txt>
            <View style={styles.riderMeta}>
              <VehicleGlyph kind={rider.vehicleClass} size={15} colour={c.textMuted} />
              <Txt v="label" tone="muted">
                {VEHICLE_NAME[rider.vehicleClass as VehicleKind] ?? "Vehicle"}
              </Txt>
              {rider.rating ? (
                <>
                  <Ionicons name="star" size={12} color={c.warning} />
                  <Txt v="label" tone="muted">
                    {rider.rating.toFixed(1)}
                  </Txt>
                </>
              ) : null}
            </View>
          </Enter>
          {rider.plate ? (
            <Enter i={5} style={styles.plate}>
              <Txt v="figure" tabularNums style={styles.plateText}>
                {rider.plate}
              </Txt>
            </Enter>
          ) : null}
        </Press>
      ) : null}

      {pin && !moving ? (
        <Enter i={2} style={styles.pin}>
          <View style={styles.flex}>
            <Txt v="bodyStrong">Your PIN</Txt>
            <Txt v="label" tone="muted">
              {arrived ? `Tell ${name} these numbers to start` : "Tell your rider when they arrive"}
            </Txt>
          </View>
          <PinPatches pin={pin} size="sm" roll />
        </Enter>
      ) : null}

      {arrived && s ? (
        <View style={[styles.waitRow, freeLeft === 0 && styles.waitRowCharged]}>
          <Ionicons name="time" size={18} color={freeLeft > 0 ? c.textMuted : c.warning} />
          {freeLeft > 0 ? (
            <Txt v="label" tone="muted" style={styles.flex}>
              {name} waits free for{" "}
              <Txt v="label" tone="strong" tabularNums>
                {clock(freeLeft)}
              </Txt>{" "}
              more
            </Txt>
          ) : (
            <Txt v="label" tone="warn" style={styles.flex}>
              Waiting is now charged: {money(charge)} RWF so far
            </Txt>
          )}
        </View>
      ) : null}

      <QuickActions>
        <QuickAction icon="call" label="Call" onPress={onCall} />
        <QuickAction icon="share-social" label="Share trip" onPress={onShare} />
        <QuickAction icon="shield-half" label="Safety" onPress={onSos} tone="bad" />
        {!moving ? <QuickAction icon="close" label="Cancel" onPress={onCancel} disabled={busy} /> : null}
      </QuickActions>
    </View>
  );
}

const ENDED: Record<string, { title: string; body: string; icon: IconName; tone: "neutral" | "warn" }> = {
  no_riders: { title: "No riders free nearby", body: "Everyone close by is on a trip. Try again in a few minutes.", icon: "people", tone: "neutral" },
  expired: { title: "That request timed out", body: "Nobody accepted in time. Try again - it's usually quicker the second time.", icon: "hourglass", tone: "neutral" },
  cancelled_by_rider: { title: "Your rider cancelled", body: "You haven't been charged. Book again and we'll find someone else.", icon: "close-circle", tone: "neutral" },
  cancelled_by_passenger: { title: "Trip cancelled", body: "You haven't been charged.", icon: "close-circle", tone: "neutral" },
  no_show: {
    title: "Your rider couldn't find you",
    body: "They waited at the pickup and have left. Book again when you're ready - adding a note helps them find you.",
    icon: "location",
    tone: "warn",
  },
};

export function Ended({ state, onAgain }: { readonly state: string; readonly onAgain: () => void }) {
  const t = ENDED[state] ?? { title: "Trip ended", body: "", icon: "flag" as IconName, tone: "neutral" as const };
  return (
    <View style={styles.stack}>
      <View style={styles.endedHead}>
        <Well icon={t.icon} tone={t.tone} size={48} />
        <Chip label={state === "no_show" ? "No-show recorded" : "Not charged"} tone={state === "no_show" ? "warn" : "neutral"} />
      </View>
      <Txt v="title">{t.title}</Txt>
      <Txt v="body" tone="muted">
        {t.body}
      </Txt>
      <Button label="Book again" onPress={onAgain} />
    </View>
  );
}

export function vehicleName(kind: string): string {
  return VEHICLE_NAME[kind as VehicleKind] ?? "Ride";
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  stack: { gap: space.md },
  searching: { alignItems: "center", gap: space.sm, paddingTop: space.xs },
  summary: { padding: space.md, borderRadius: radius.lg, backgroundColor: c.surfaceHigh },
  headRow: { flexDirection: "row", alignItems: "flex-start", gap: space.md },
  eta: { alignItems: "center", minWidth: 48 },
  rider: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.sm,
    paddingRight: space.md,
    borderRadius: radius.lg,
    backgroundColor: c.surfaceHigh,
  },
  riderMeta: { flexDirection: "row", alignItems: "center", gap: 5 },
  // The plate is what the passenger scans the kerb for, so it is set like one.
  plate: {
    paddingHorizontal: space.sm,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: c.textStrong,
    backgroundColor: c.surfaceRaised,
  },
  plateText: { fontSize: 20, lineHeight: 24, letterSpacing: 1 },
  pin: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: c.accentSoft,
  },
  waitRow: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.xs },
  waitRowCharged: { backgroundColor: c.warningSoft, borderRadius: radius.md, padding: space.sm },
  endedHead: { flexDirection: "row", alignItems: "center", gap: space.md },
});
