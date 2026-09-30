import { StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  Avatar,
  Banner,
  Button,
  Odometer,
  QuickAction,
  QuickActions,
  RouteRail,
  SlideToConfirm,
  TripProgress,
  Txt,
  c,
  money,
  radius,
  space,
} from "@nova/kit";
import {
  distanceBetween,
  distanceLabel,
  type ActiveTrip,
  type TripPoints,
  type WaitStatus,
  kigaliTime,
} from "@nova/data";
import { waitingChargeFor } from "@nova/core";
import type { Coords } from "../lib/location";
import { DrainBar, PassengerNote } from "./parts";
import { clock } from "./useNow";

const STEPS = ["Heading to pickup", "At the pickup", "On the trip"] as const;

export interface TripPanelProps {
  readonly trip: ActiveTrip;
  readonly points: TripPoints | null;
  readonly here: Coords | null;
  readonly passengerName: string;
  /** Server wait status plus when it was read, so the clock can run locally. */
  readonly wait: { status: WaitStatus; readAt: number } | null;
  readonly now: number;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onArrive: () => void;
  readonly onOpenPin: () => void;
  readonly onFinish: () => void;
  readonly onNoShow: () => void;
  readonly onCall: () => void;
  readonly onMessage: () => void;
  readonly unread: number;
  readonly onNavigate: (to: Coords) => void;
  readonly onCancel: () => void;
}

/**
 * The trip in hand, one step at a time. Each step shows only what that step
 * needs - where to go, who to wait for, what to collect - and ends in the one
 * action that moves it on.
 */
export function TripPanel(p: TripPanelProps) {
  const { trip, points, here } = p;
  const error = p.error ? (
    <Banner tone="bad" icon="alert-circle">
      {p.error}
    </Banner>
  ) : null;

  if (trip.state === "accepted") {
    const away = points && here ? distanceBetween(here, points.pickup) : null;
    return (
      <View style={styles.panel}>
        <TripProgress steps={STEPS} current={0} note={away !== null ? `${distanceLabel(away)} away` : undefined} />
        <Who label="Pick up" name={p.passengerName} />
        {trip.scheduledFor && new Date(trip.scheduledFor).getTime() > p.now ? (
          <Banner tone="warn" icon="calendar">
            {`Booked for ${kigaliTime(trip.scheduledFor)}. Be there on time. Waiting isn't charged before then.`}
          </Banner>
        ) : null}
        <RouteRail dense from={{ label: trip.pickupLabel, note: "Pickup" }} to={{ label: trip.dropoffLabel, note: "Drop-off" }} />
        {trip.pickupNote ? <PassengerNote text={trip.pickupNote} /> : null}
        <QuickActions>
          <QuickAction icon="navigate" label="Navigate" tone="accent" onPress={() => points && p.onNavigate(points.pickup)} disabled={!points} />
          <QuickAction icon="call" label="Call" onPress={p.onCall} />
          <QuickAction icon="chatbubble" label="Message" onPress={p.onMessage} badge={p.unread > 0} />
          <QuickAction icon="close" label="Cancel" onPress={p.onCancel} disabled={p.busy} />
        </QuickActions>
        {error}
        <SlideToConfirm label="Slide when you've arrived" onConfirm={p.onArrive} disabled={p.busy} icon="flag" />
      </View>
    );
  }

  if (trip.state === "arrived") {
    const s = p.wait?.status;
    const waited = s ? s.waitedSeconds + Math.floor((p.now - p.wait!.readAt) / 1000) : 0;
    const grace = s?.graceSeconds ?? 300;
    const freeLeft = Math.max(0, grace - waited);
    const charge = s ? waitingChargeFor(waited, grace, s.perMinuteRwf) : 0;
    // When the free wait runs out, as a moment in time: the bar drains towards
    // it without being re-told every second.
    const freeEndsAt = s && p.wait ? p.wait.readAt + (grace - s.waitedSeconds) * 1000 : 0;
    const charging = s != null && freeLeft === 0;
    return (
      <View style={styles.panel}>
        <TripProgress steps={STEPS} current={1} />
        <Who label="Waiting for" name={p.passengerName} />
        <View style={[styles.wait, charging && styles.waitCharged]}>
          <View style={styles.waitHead}>
            <Ionicons name={charging ? "cash" : "time"} size={20} color={charging ? c.warning : c.textMuted} />
            <View style={styles.flex}>
              <Txt v="bodyStrong" tone={charging ? "warn" : "strong"}>
                {charging ? "Waiting is now charged" : "Free waiting"}
              </Txt>
              <Txt v="label" tone="muted">
                {charging ? `+${money(charge)} RWF on the fare so far` : `Charged after ${Math.round(grace / 60)} minutes`}
              </Txt>
            </View>
            <Txt v="figure" tone={charging ? "warn" : "strong"} tabularNums>
              {s ? clock(charging ? waited - grace : freeLeft) : "-"}
            </Txt>
          </View>
          {s && !charging ? <DrainBar endsAt={freeEndsAt} totalMs={grace * 1000} /> : null}
        </View>
        <QuickActions>
          <QuickAction icon="call" label="Call" onPress={p.onCall} />
          <QuickAction icon="chatbubble" label="Message" onPress={p.onMessage} badge={p.unread > 0} />
          <QuickAction icon="navigate" label="Map" onPress={() => points && p.onNavigate(points.pickup)} disabled={!points} />
          {charging ? (
            <QuickAction icon="person-remove" label="Didn't come" tone="bad" onPress={p.onNoShow} disabled={p.busy} />
          ) : (
            <QuickAction icon="close" label="Cancel" onPress={p.onCancel} disabled={p.busy} />
          )}
        </QuickActions>
        {error}
        <Button label="Enter PIN to start" icon="keypad" onPress={p.onOpenPin} disabled={p.busy} />
      </View>
    );
  }

  // in_progress
  return (
    <View style={styles.panel}>
      <TripProgress steps={STEPS} current={2} />
      <Txt v="h2" lines={2}>
        Drop off at {trip.dropoffLabel}
      </Txt>
      <View style={styles.collect}>
        <View style={styles.flex}>
          <Txt v="label" tone="muted">
            To collect at the end
          </Txt>
          <Txt v="caption" tone="muted">
            Cash, plus any waiting charge
          </Txt>
        </View>
        <View style={styles.amount}>
          {trip.fareRwf === null ? (
            <Txt v="figure">-</Txt>
          ) : (
            <Odometer value={money(trip.fareRwf)} v="figure" accessibilityLabel={`${money(trip.fareRwf)} Rwandan francs`} />
          )}
          <Txt v="label" tone="muted">
            RWF
          </Txt>
        </View>
      </View>
      <QuickActions>
        <QuickAction icon="navigate" label="Navigate" tone="accent" onPress={() => points && p.onNavigate(points.dropoff)} disabled={!points} />
        <QuickAction icon="call" label="Call" onPress={p.onCall} />
        <QuickAction icon="chatbubble" label="Message" onPress={p.onMessage} badge={p.unread > 0} />
      </QuickActions>
      {error}
      <SlideToConfirm label="Slide to finish trip" tone="good" onConfirm={p.onFinish} disabled={p.busy} icon="checkmark" />
    </View>
  );
}

/** Who the trip is for: their initial in the yellow, and their first name. */
function Who({ label, name }: { readonly label: string; readonly name: string }) {
  return (
    <View style={styles.who}>
      <Avatar name={name} size={48} tone="highlight" />
      <View style={styles.flex}>
        <Txt v="caption" tone="muted">
          {label}
        </Txt>
        <Txt v="h2" lines={1}>
          {name}
        </Txt>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  who: { flexDirection: "row", alignItems: "center", gap: space.md },
  flex: { flex: 1, minWidth: 0 },
  panel: { gap: space.md },
  wait: { gap: space.sm, padding: space.md, borderRadius: radius.lg, backgroundColor: c.surfaceHigh },
  waitCharged: { backgroundColor: c.warningSoft },
  waitHead: { flexDirection: "row", alignItems: "center", gap: space.md },
  collect: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: c.surfaceHigh,
  },
  amount: { flexDirection: "row", alignItems: "baseline", gap: 4 },
});
