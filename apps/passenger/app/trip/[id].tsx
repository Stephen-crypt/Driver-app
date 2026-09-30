import { useEffect, useState } from "react";
import { Share, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  Chip,
  Divider,
  Enter,
  Group,
  ImigongoBand,
  Odometer,
  RouteRail,
  Row,
  Screen,
  Skeleton,
  Timeline,
  Txt,
  VEHICLE_NAME,
  VehicleGlyph,
  VestPatch,
  ZigzagEdge,
  c,
  money,
  radius,
  space,
  type VehicleKind,
} from "@nova/kit";
import { statusFor } from "@nova/ui";
import {
  getRiderCard,
  getTripDetail,
  getTripEvents,
  getTripPoints,
  getTripTotal,
  type RiderCard,
  type TripDetail,
  type TripEvent,
  type TripPoints,
  whenLabel,
  type TripTotal,
} from "@nova/data";
import { supabase } from "../../src/lib/supabase";
import { goBack } from "../../src/lib/nav";
import { Ticket, referenceFor } from "../../src/ride/Ticket";

const EVENT_LABEL: Record<string, string> = {
  requested: "Booked",
  scheduled: "Booked ahead",
  offered: "Looking for a rider",
  accepted: "Rider accepted",
  arrived: "Rider at the pickup",
  in_progress: "Trip started",
  completed: "Arrived",
  cancelled_by_passenger: "You cancelled",
  cancelled_by_rider: "Rider cancelled",
  no_riders: "No riders were free",
  expired: "Timed out",
  no_show: "Rider couldn't find you",
};
const BAD_STATES = new Set(["cancelled_by_passenger", "cancelled_by_rider", "no_riders", "expired", "no_show"]);
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/**
 * A past trip as a receipt: where, when, what it cost, who took you - and the
 * three things people come back to a finished trip for: a thing left on the
 * seat, a problem with the ride, or the same trip again.
 */
export default function TripReceipt() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [trip, setTrip] = useState<TripDetail | null | undefined>(undefined);
  const [total, setTotal] = useState<TripTotal | null>(null);
  const [rider, setRider] = useState<RiderCard | null>(null);
  const [points, setPoints] = useState<TripPoints | null>(null);
  const [events, setEvents] = useState<TripEvent[]>([]);

  useEffect(() => {
    if (!id) return;
    let active = true;
    getTripDetail(supabase, id)
      .then((t) => {
        if (!active) return;
        setTrip(t);
        if (!t) return;
        if (t.state === "completed") getTripTotal(supabase, t.id).then((x) => active && setTotal(x)).catch(() => {});
        if (t.riderId) getRiderCard(supabase, t.id).then((r) => active && setRider(r)).catch(() => {});
        getTripPoints(supabase, t.id).then((p) => active && setPoints(p)).catch(() => {});
        getTripEvents(supabase, t.id).then((e) => active && setEvents(e)).catch(() => {});
      })
      .catch(() => active && setTrip(null));
    return () => {
      active = false;
    };
  }, [id]);

  if (trip === undefined) {
    return (
      <Screen onBack={() => goBack(router)} stagger={false}>
        <View style={styles.stack}>
          <Skeleton width="60%" height={30} r={8} />
          <Skeleton height={180} r={20} />
          <Skeleton height={120} r={20} />
        </View>
      </Screen>
    );
  }

  if (trip === null) {
    return (
      <Screen title="Trip not found" onBack={() => goBack(router)}>
        <Txt v="body" tone="muted">
          It may have been removed, or it belongs to another account.
        </Txt>
      </Screen>
    );
  }

  const done = trip.state === "completed";
  const status = statusFor(trip.state);
  const paid = total?.totalRwf ?? trip.quotedAmountRwf ?? 0;
  const at = trip.scheduledFor ?? trip.createdAt;
  // A receipt a passenger can send on: to an employer, to whoever paid.
  const share = () =>
    void Share.share({
      message: [
        `Nova trip, ${when(at)}`,
        `${trip.pickupLabel} to ${trip.dropoffLabel}`,
        done ? `Paid ${paid.toLocaleString("en-US")} RWF in cash` : status.label,
        `Reference ${referenceFor(trip.id)}`,
      ].join("\n"),
    }).catch(() => {});

  const report = (kind: "lost_property" | "complaint") =>
    router.push({ pathname: "/report", params: { trip: trip.id, to: trip.dropoffLabel, kind } });

  return (
    <Screen title={trip.dropoffLabel} subtitle={when(at)} onBack={() => goBack(router)}>
      <View style={styles.stack}>
        {trip.state === "scheduled" ? (
          <Ticket
            id={trip.id}
            kind="ride"
            when={trip.scheduledFor ? whenLabel(trip.scheduledFor) : when(at)}
            from={trip.pickupLabel}
            to={trip.dropoffLabel}
            vehicle={trip.vehicleClass}
            amountRwf={trip.quotedAmountRwf}
          />
        ) : (
          <View>
            <View style={styles.receipt}>
              <View style={styles.receiptHead}>
                <Chip label={status.label} tone={done ? "good" : "neutral"} dot={done} />
                <View style={styles.vehicle}>
                  <VehicleGlyph kind={trip.vehicleClass} size={17} colour={c.textMuted} />
                  <Txt v="label" tone="muted">
                    {VEHICLE_NAME[trip.vehicleClass as VehicleKind] ?? "Ride"}
                  </Txt>
                </View>
              </View>
  
              <RouteRail
                from={{ label: trip.pickupLabel, note: trip.pickupNote ?? "Pickup" }}
                to={{ label: trip.dropoffLabel, note: "Drop-off" }}
              />
  
              <Divider />
  
              {done ? (
                <View style={styles.money}>
                  <Txt v="label" tone="muted">
                    Paid in cash
                  </Txt>
                  <View style={styles.total}>
                    <Odometer value={money(paid)} v="display" />
                    <Txt v="bodyStrong" tone="muted">
                      RWF
                    </Txt>
                  </View>
                  {total && total.waitingChargeRwf > 0 ? (
                    <View style={styles.lines}>
                      <Line label="Trip" value={total.fareRwf} />
                      <Line label="Waiting time" value={total.waitingChargeRwf} />
                    </View>
                  ) : null}
                </View>
              ) : (
                <View style={styles.notCharged}>
                  <Ionicons name="checkmark-circle" size={18} color={c.success} />
                  <Txt v="label" tone="muted">
                    You weren't charged for this trip.
                  </Txt>
                </View>
              )}
  
              <ImigongoBand height={16} opacity={0.14} style={styles.band} />
            </View>
            <ZigzagEdge />
          </View>
        )}

        {events.length > 1 ? (
          <Enter i={1}>
            <Group title="What happened">
              <View style={styles.timeline}>
                <Timeline
                  items={events.map((e) => ({
                    label: EVENT_LABEL[e.to] ?? e.to,
                    time: time(e.at),
                    tone: BAD_STATES.has(e.to) ? ("bad" as const) : ("done" as const),
                    ...(e.reason && e.to === "cancelled_by_passenger" ? { note: e.reason } : {}),
                  }))}
                />
              </View>
            </Group>
          </Enter>
        ) : null}

        {rider ? (
          <Enter i={1}>
            <Group title="Your rider">
              <View style={styles.rider}>
                {rider.vestNumber ? <VestPatch value={rider.vestNumber} size="sm" /> : null}
                <View style={styles.flex}>
                  <Txt v="bodyStrong">{rider.firstName}</Txt>
                  <Txt v="label" tone="muted">
                    {rider.plate ? `Plate ${rider.plate}` : "Company vehicle"}
                  </Txt>
                </View>
                {rider.rating ? (
                  <View style={styles.rating}>
                    <Ionicons name="star" size={13} color={c.warning} />
                    <Txt v="label" tabularNums>
                      {rider.rating.toFixed(1)}
                    </Txt>
                  </View>
                ) : null}
              </View>
            </Group>
          </Enter>
        ) : null}

        <Enter i={2}>
          <Group title="Need something?">
            {done ? (
              <>
                <Row title="Share this receipt" subtitle="The route, the price and the reference" icon="share-social" iconTone="good" onPress={share} />
                <Divider inset={70} />
                <Row title="I left something behind" subtitle="A phone, a bag, keys" icon="bag-handle" onPress={() => report("lost_property")} />
                <Divider inset={70} />
              </>
            ) : null}
            <Row title="Report a problem" subtitle="The price, the route, how the ride went" icon="flag" iconTone="warn" onPress={() => report("complaint")} />
            {points ? (
              <>
                <Divider inset={70} />
                <Row
                  title="Book this trip again"
                  subtitle={`To ${trip.dropoffLabel}`}
                  icon="refresh"
                  onPress={() =>
                    router.push({
                      pathname: "/ride",
                      params: {
                        lat: String(points.dropoff.lat),
                        lng: String(points.dropoff.lng),
                        label: trip.dropoffLabel,
                        plat: String(points.pickup.lat),
                        plng: String(points.pickup.lng),
                        plabel: trip.pickupLabel,
                      },
                    })
                  }
                />
              </>
            ) : null}
          </Group>
        </Enter>
      </View>
    </Screen>
  );
}

function Line({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <View style={styles.line}>
      <Txt v="label" tone="muted">
        {label}
      </Txt>
      <Txt v="label" tabularNums>
        {money(value)}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  stack: { gap: space.lg },
  receipt: {
    backgroundColor: c.surfaceRaised,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: space.md,
    paddingBottom: 0,
    gap: space.md,
  },
  receiptHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  vehicle: { flexDirection: "row", alignItems: "center", gap: 6 },
  money: { gap: 2 },
  total: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  lines: { marginTop: space.xs, gap: 2 },
  line: { flexDirection: "row", justifyContent: "space-between" },
  notCharged: { flexDirection: "row", alignItems: "center", gap: space.sm },
  band: { marginHorizontal: -space.md, marginTop: space.xs },
  rider: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md },
  timeline: { paddingHorizontal: space.md, paddingVertical: space.sm },
  rating: { flexDirection: "row", alignItems: "center", gap: 4 },
});
