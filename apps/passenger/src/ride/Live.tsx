import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import {
  Button,
  Chip,
  Enter,
  Odometer,
  PinPatches,
  Press,
  QuickAction,
  QuickActions,
  RouteRail,
  Timeline,
  TripProgress,
  Txt,
  VEHICLE_NAME,
  VehicleArt,
  VestPatch,
  Well,
  c,
  ease,
  font,
  money,
  radius,
  space,
  type IconName,
  type VehicleKind,
} from "@nova/kit";
import { waitingChargeFor } from "@nova/core";
import type { RiderCard, RiderPosition, TripEvent, TripSnapshot, WaitStatus } from "@nova/data";

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
        <View style={styles.flex}>
          <Txt v="h2">Finding your rider</Txt>
          <Txt v="label" tone="muted">
            We ask the closest riders one at a time. It usually takes under a minute.
          </Txt>
        </View>
        <VehicleArt kind={vehicle} size={76} />
      </View>
      <Sweep />
      <View style={styles.summary}>
        <RouteRail dense from={{ label: from, note: "Pickup" }} to={{ label: to, note: "Drop-off" }} />
      </View>
      <Button label="Cancel request" variant="secondary" onPress={onCancel} disabled={busy} />
    </View>
  );
}

/**
 * A bar with the yellow running along it, while nothing is known yet. The map
 * above carries the radar; this says the same thing in the sheet.
 */
function Sweep() {
  const reduce = useReducedMotion();
  const t = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    t.set(withRepeat(withTiming(1, { duration: 1500, easing: ease.inOut, reduceMotion: ReduceMotion.Never }), -1, false));
  }, [reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  const bar = useAnimatedStyle(() => ({ left: `${-40 + t.get() * 140}%` }));
  return (
    <View style={styles.sweep} accessibilityRole="progressbar" accessibilityLabel="Looking for a rider">
      <Animated.View style={[styles.sweepBar, reduce ? { left: "30%" } : bar]} />
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
  onMessage,
  unread,
  onSos,
  onCancel,
  onRider,
  events = [],
}: {
  readonly trip: TripSnapshot;
  /** What has happened so far, for the times on the progress card. */
  readonly events?: readonly TripEvent[];
  readonly rider: RiderCard | null;
  readonly riderAt: RiderPosition | null;
  readonly pin: string | null;
  readonly wait: { status: WaitStatus; readAt: number } | null;
  readonly now: number;
  readonly busy: boolean;
  readonly onCall: () => void;
  readonly onMessage: () => void;
  readonly unread: number;
  readonly onSos: () => void;
  readonly onCancel: () => void;
  readonly onRider: () => void;
}) {
  const name = rider?.firstName ?? "Your rider";
  const arrived = trip.state === "arrived";
  const moving = trip.state === "in_progress";
  const step = moving ? 2 : arrived ? 1 : 0;

  // The clock time as well as the minutes: "around 16:23" is what gets
  // passed on to whoever is waiting at the other end.
  const at = riderAt?.etaSeconds
    ? new Date(now + riderAt.etaSeconds * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    : null;
  let headline: string;
  let sub: string | null = null;
  if (moving) {
    headline = `On the way to ${trip.dropoffLabel}`;
    sub = at ? `Drop-off around ${at}` : null;
  } else if (arrived) {
    headline = `${name} is here`;
    // Pickup labels are often "Near X" already; "At Near X" reads as a typo.
    sub = trip.pickupLabel.startsWith("Near ") ? trip.pickupLabel : `At ${trip.pickupLabel}`;
  } else {
    headline = `${name} is on the way`;
    sub = at ? `At your pickup around ${at}` : "Heading to your pickup";
  }

  const s = wait?.status;
  const waited = s ? s.waitedSeconds + Math.floor((now - wait!.readAt) / 1000) : 0;
  const grace = s?.graceSeconds ?? 300;
  const freeLeft = Math.max(0, grace - waited);
  const charge = s ? waitingChargeFor(waited, grace, s.perMinuteRwf) : 0;
  const showEta = !arrived && riderAt;
  const hhmm = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const stamp = (to: string) => {
    const e = events.find((x) => x.to === to);
    return e ? hhmm(e.at) : "";
  };

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
            <Odometer value={minutes(riderAt.etaSeconds)} v="display" tone="onHighlight" />
            <Txt v="caption" tone="onHighlight" style={styles.etaUnit}>
              min
            </Txt>
          </View>
        ) : null}
      </View>

      {rider ? (
        <Press onPress={onRider} scaleTo={0.985} style={[styles.rider, arrived && styles.riderHere]} accessibilityRole="button" accessibilityLabel={`${rider.firstName}, vest ${rider.vestNumber ?? "unknown"}, plate ${rider.plate ?? "unknown"}. More about your rider`}>
          {rider.vestNumber ? <VestPatch value={rider.vestNumber} size="md" roll label={`Vest ${rider.vestNumber}`} /> : null}
          <Enter i={3} style={styles.riderText}>
            {arrived ? (
              <Txt v="caption" tone="warn" style={styles.lookFor}>
                Look for
              </Txt>
            ) : null}
            <View style={styles.nameRow}>
              <Txt v="section" lines={1} style={styles.shrink}>
                {rider.firstName}
              </Txt>
              {rider.rating ? (
                <View style={styles.rating}>
                  <Ionicons name="star" size={11} color={c.onHighlight} />
                  <Txt v="caption" tone="onHighlight" style={styles.ratingText}>
                    {rider.rating.toFixed(1)}
                  </Txt>
                </View>
              ) : null}
            </View>
            <Txt v="caption" tone="muted">
              {VEHICLE_NAME[rider.vehicleClass as VehicleKind] ?? "Vehicle"}
            </Txt>
            {rider.plate ? (
              <View style={styles.plate}>
                <Txt v="label" tabularNums style={styles.plateText}>
                  {rider.plate}
                </Txt>
              </View>
            ) : null}
          </Enter>
          <VehicleArt kind={rider.vehicleClass} size={76} />
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
        <QuickAction icon="chatbubble" label="Message" onPress={onMessage} badge={unread > 0} />
        <QuickAction icon="call" label="Call" onPress={onCall} />
        <QuickAction icon="shield-half" label="Safety" onPress={onSos} tone="bad" />
        {!moving ? <QuickAction icon="close" label="Cancel" onPress={onCancel} disabled={busy} /> : null}
      </QuickActions>

      {/* Every step with its time: what has happened in green, what is
          happening now in the yellow, what is still to come in grey. */}
      <View style={styles.track}>
        <Txt v="section">Your trip</Txt>
        <Timeline
          items={[
            { label: "Rider accepted", time: stamp("accepted") },
            arrived || moving
              ? { label: "Rider at your pickup", time: stamp("arrived") }
              : { label: "Rider coming to your pickup", time: at ? `~${at}` : "", tone: "now" as const, note: "Have your PIN ready" },
            moving
              ? { label: `On the way to ${trip.dropoffLabel}`, time: stamp("in_progress"), tone: "now" as const, note: at ? `Drop-off around ${at}` : undefined }
              : arrived
                ? { label: "Give your PIN, then you're off", time: "", tone: "now" as const }
                : { label: `On the way to ${trip.dropoffLabel}`, time: "", tone: "pending" as const },
            { label: "Arrive and pay in cash", time: moving && at ? `~${at}` : "", tone: "pending" as const },
          ]}
        />
      </View>
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
  shrink: { flexShrink: 1 },
  searching: { flexDirection: "row", alignItems: "center", gap: space.md },
  sweep: { height: 6, borderRadius: 3, backgroundColor: c.surfaceHigh, overflow: "hidden" },
  sweepBar: { position: "absolute", top: 0, bottom: 0, width: "40%", borderRadius: 3, backgroundColor: c.highlight },
  summary: { padding: space.md, borderRadius: radius.lg, backgroundColor: c.surfaceHigh },
  headRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  // How soon, in the yellow: the one figure a waiting passenger keeps checking.
  eta: {
    alignItems: "center",
    justifyContent: "center",
    minWidth: 68,
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
    borderRadius: radius.lg,
    backgroundColor: c.highlight,
  },
  etaUnit: { marginTop: -4, fontFamily: font.semibold },
  rider: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.sm,
    paddingRight: space.xs,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surfaceRaised,
  },
  riderText: { flex: 1, minWidth: 0, gap: 3 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  rating: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
    backgroundColor: c.highlight,
  },
  ratingText: { fontFamily: font.semibold },
  // The plate is what the passenger scans the kerb for, so it is set like one.
  plate: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: c.textStrong,
    backgroundColor: c.surfaceRaised,
  },
  plateText: { fontFamily: font.numBold, letterSpacing: 0.6 },
  riderHere: { borderColor: c.highlight, borderWidth: 2, backgroundColor: c.tintYellow },
  lookFor: { fontFamily: font.semibold },
  track: { gap: space.sm, padding: space.md, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border },
  pin: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: c.tintYellow,
  },
  waitRow: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.xs },
  waitRowCharged: { backgroundColor: c.warningSoft, borderRadius: radius.md, padding: space.sm },
  endedHead: { flexDirection: "row", alignItems: "center", gap: space.md },
});
