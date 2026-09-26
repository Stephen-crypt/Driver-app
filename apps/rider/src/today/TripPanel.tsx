import { StyleSheet, View } from "react-native";
import {
  Banner,
  Button,
  SlideToConfirm,
  Txt,
  c,
  money,
  space,
} from "@gera/kit";
import {
  distanceBetween,
  distanceLabel,
  type ActiveTrip,
  type TripPoints,
  type WaitStatus,
  kigaliTime,
} from "@gera/data";
import { waitingChargeFor } from "@gera/core";
import type { Coords } from "../lib/location";
import { Leg } from "./OfferSheet";
import { clock } from "./useNow";

const STEPS = ["To pickup", "Passenger", "Drop-off"] as const;

function Steps({ at }: { readonly at: 0 | 1 | 2 }) {
  return (
    <View style={styles.steps} accessibilityLabel={`Step ${at + 1} of 3: ${STEPS[at]}`}>
      {STEPS.map((s, i) => (
        <View key={s} style={styles.step}>
          <View style={[styles.stepBar, i <= at && styles.stepBarOn]} />
          <Txt v="caption" tone={i === at ? "strong" : "muted"}>
            {s}
          </Txt>
        </View>
      ))}
    </View>
  );
}

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
  readonly onNavigate: (to: Coords) => void;
  readonly onCancel: () => void;
}

export function TripPanel(p: TripPanelProps) {
  const { trip, points, here } = p;

  const actions = (to: Coords | undefined) => (
    <View style={styles.actions}>
      <Button
        label="Navigate"
        icon="navigate"
        variant="secondary"
        compact
        style={styles.flex}
        onPress={() => to && p.onNavigate(to)}
        disabled={!to}
      />
      <Button label="Call" icon="call" variant="secondary" compact style={styles.flex} onPress={p.onCall} />
    </View>
  );

  if (trip.state === "accepted") {
    const away = points && here ? distanceBetween(here, points.pickup) : null;
    return (
      <View style={styles.panel}>
        <Steps at={0} />
        <Txt v="title">Pick up {p.passengerName}</Txt>
        {trip.scheduledFor && new Date(trip.scheduledFor).getTime() > p.now ? (
          <Banner tone="warn" icon="calendar">
            {`Booked for ${kigaliTime(trip.scheduledFor)}. Be there on time - waiting isn't charged before then.`}
          </Banner>
        ) : null}
        <Leg
          kind="pickup"
          title={trip.pickupLabel}
          detail={away !== null ? `${distanceLabel(away)} from you` : undefined}
          note={trip.pickupNote}
        />
        {actions(points?.pickup)}
        {p.error ? <Banner tone="bad" icon="alert-circle">{p.error}</Banner> : null}
        <SlideToConfirm label="Slide when you've arrived" onConfirm={p.onArrive} disabled={p.busy} icon="flag" />
        <Button label="Cancel trip" variant="quiet" onPress={p.onCancel} disabled={p.busy} compact />
      </View>
    );
  }

  if (trip.state === "arrived") {
    const s = p.wait?.status;
    const waited = s ? s.waitedSeconds + Math.floor((p.now - p.wait!.readAt) / 1000) : 0;
    const grace = s?.graceSeconds ?? 300;
    const freeLeft = Math.max(0, grace - waited);
    const charge = s ? waitingChargeFor(waited, grace, s.perMinuteRwf) : 0;
    return (
      <View style={styles.panel}>
        <Steps at={1} />
        <View style={styles.waitRow}>
          <View style={styles.flex}>
            <Txt v="title">Waiting for {p.passengerName}</Txt>
            <Txt v="label" tone="muted" lines={1}>
              {trip.pickupLabel}
            </Txt>
          </View>
          <View style={styles.clock}>
            <Txt v="display" tone={freeLeft > 0 ? "strong" : "warn"} tabularNums>
              {clock(freeLeft > 0 ? freeLeft : waited - grace)}
            </Txt>
            <Txt v="caption" tone={freeLeft > 0 ? "muted" : "warn"}>
              {freeLeft > 0 ? "free waiting left" : `waiting · +${money(charge)} RWF`}
            </Txt>
          </View>
        </View>
        {actions(points?.pickup)}
        {p.error ? <Banner tone="bad" icon="alert-circle">{p.error}</Banner> : null}
        <Button label="Enter PIN to start" icon="keypad" onPress={p.onOpenPin} disabled={p.busy} />
        {freeLeft === 0 ? (
          <Button label="Passenger didn't come" variant="danger" compact onPress={p.onNoShow} disabled={p.busy} />
        ) : (
          <Button label="Cancel trip" variant="quiet" onPress={p.onCancel} disabled={p.busy} compact />
        )}
      </View>
    );
  }

  // in_progress
  return (
    <View style={styles.panel}>
      <Steps at={2} />
      <Txt v="title" lines={2}>
        Drop off at {trip.dropoffLabel}
      </Txt>
      <View style={styles.collect}>
        <Txt v="label" tone="muted">
          To collect at the end
        </Txt>
        <Txt v="figure" tabularNums>
          {trip.fareRwf === null ? "—" : `${money(trip.fareRwf)} RWF`}
        </Txt>
      </View>
      {actions(points?.dropoff)}
      {p.error ? <Banner tone="bad" icon="alert-circle">{p.error}</Banner> : null}
      <SlideToConfirm label="Slide to finish trip" tone="good" onConfirm={p.onFinish} disabled={p.busy} icon="checkmark" />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  panel: { gap: space.md },
  steps: { flexDirection: "row", gap: space.sm },
  step: { flex: 1, gap: 5 },
  stepBar: { height: 4, borderRadius: 2, backgroundColor: c.surfaceHigh },
  stepBarOn: { backgroundColor: c.accent },
  actions: { flexDirection: "row", gap: space.sm },
  waitRow: { flexDirection: "row", alignItems: "flex-start", gap: space.md },
  clock: { alignItems: "flex-end" },
  collect: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: space.md,
    borderRadius: 16,
    backgroundColor: c.surfaceHigh,
  },
});
