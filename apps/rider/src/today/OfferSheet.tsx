import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import {
  Button,
  Chip,
  CountdownRing,
  GeraMap,
  Odometer,
  Paper,
  Press,
  RouteRail,
  Txt,
  VEHICLE_NAME,
  VehicleGlyph,
  c,
  dur,
  ease,
  fadeIn,
  money,
  notify,
  radius,
  space,
  tap,
  tokens,
  type VehicleKind,
} from "@gera/kit";
import {
  distanceBetween,
  distanceLabel,
  etaLabel,
  getTripPoints,
  whenLabel,
  secondsLeft,
  type LiveOffer,
  type TripPoints,
} from "@gera/data";
import { supabase } from "../lib/supabase";
import type { Coords } from "../lib/location";
import { PassengerNote, useDrain } from "./parts";
import { useNow } from "./useNow";

const OFFER_SECONDS = 15;

/**
 * An offer takes the whole screen. It has fifteen seconds, and in that time the
 * rider needs exactly three things: how much, how far to the pickup, and where
 * it ends. Everything else on the phone waits.
 *
 * The time left is shown twice, because it is read two ways: the ring for a
 * glance from the mount, and the Accept button itself draining, so the rider's
 * thumb is on the clock.
 */
export function OfferSheet({
  offer,
  here,
  busy,
  onAccept,
  onPass,
}: {
  readonly offer: LiveOffer | null;
  readonly here: Coords | null;
  readonly busy: boolean;
  readonly onAccept: () => void;
  readonly onPass: () => void;
}) {
  const insets = useSafeAreaInsets();
  const reduce = useReducedMotion();
  const now = useNow(250, offer !== null);
  const [points, setPoints] = useState<TripPoints | null>(null);
  // The panel rises into place; the map fades in behind it once it has points.
  const rise = useSharedValue(1);

  useEffect(() => {
    setPoints(null);
    if (!offer) return;
    // The strongest buzz the phone has. An offer missed because the phone was
    // in a mount and the screen changed silently is fifteen seconds wasted.
    notify("warning");
    rise.set(1);
    rise.set(reduce ? 0 : withTiming(0, { duration: dur.sheet + 60, easing: ease.sheet }));
    let active = true;
    getTripPoints(supabase, offer.tripId)
      .then((p) => active && setPoints(p))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [offer?.offerId]); // eslint-disable-line react-hooks/exhaustive-deps

  const panel = useAnimatedStyle(() => ({ transform: [{ translateY: rise.get() * 520 }] }));

  if (!offer) return null;
  const left = secondsLeft(offer.expiresAt, now);
  const toPickup = points && here ? distanceBetween(here, points.pickup) : null;
  const tripLength = points ? distanceBetween(points.pickup, points.dropoff) : null;
  const kind = (offer.vehicleClass in VEHICLE_NAME ? offer.vehicleClass : "moto") as VehicleKind;
  const pickupNote = [
    toPickup !== null ? `${distanceLabel(toPickup)} from you` : null,
    offer.etaSeconds ? `about ${etaLabel(offer.etaSeconds)} away` : null,
  ]
    .filter(Boolean)
    .join(", ");

  const markers = [
    ...(here ? [{ id: "me", at: here, kind: "me" as const }] : []),
    ...(points
      ? [
          { id: "pickup", at: points.pickup, kind: "pickup" as const, tag: "Pickup" },
          { id: "dropoff", at: points.dropoff, kind: "dropoff" as const, tag: "Drop-off" },
        ]
      : []),
  ];

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onPass} statusBarTranslucent>
      <View style={styles.root}>
        <View style={styles.mapArea}>
          {points ? (
            <Animated.View entering={fadeIn} style={StyleSheet.absoluteFill}>
              <GeraMap
                center={points.pickup}
                markers={markers}
                route={[points.pickup, points.dropoff]}
                fit
                topInset={insets.top + 64}
                bottomInset={radius.xl + space.md}
              />
            </Animated.View>
          ) : null}
          <View style={[styles.badge, { top: insets.top + space.md }]} accessibilityRole="header">
            <VehicleGlyph kind={kind} size={18} colour={c.onAccent} />
            <Txt v="label" tone="inverse">
              New {VEHICLE_NAME[kind]} trip
            </Txt>
          </View>
        </View>

        <Animated.View style={[styles.panel, panel]}>
          <Paper>
            <View style={styles.content}>
              <View style={styles.head}>
                <View style={styles.flex}>
                  {/* A booked ride is released ten minutes early. Without the
                      time, a rider would race to a passenger who is still
                      finishing breakfast. */}
                  {offer.scheduledFor ? (
                    <Chip label={`Booked for ${whenLabel(offer.scheduledFor)}`} tone="warn" icon="calendar" />
                  ) : (
                    <Txt v="label" tone="muted">
                      Cash fare
                    </Txt>
                  )}
                  <View style={styles.fare}>
                    {offer.fareRwf === null ? (
                      <Txt v="hero">-</Txt>
                    ) : (
                      <Odometer value={money(offer.fareRwf)} v="hero" delay={140} accessibilityLabel={`${money(offer.fareRwf)} Rwandan francs`} />
                    )}
                    <Txt v="heading" tone="muted" style={styles.unit}>
                      RWF
                    </Txt>
                  </View>
                </View>
                <CountdownRing total={OFFER_SECONDS} remaining={left} size={76} />
              </View>

              <RouteRail
                from={{ label: offer.pickupLabel, note: pickupNote || undefined }}
                to={{ label: offer.dropoffLabel, note: tripLength !== null ? `${distanceLabel(tripLength)} trip` : undefined }}
              />
              {offer.pickupNote ? <PassengerNote text={offer.pickupNote} /> : null}

              <View style={styles.buttons}>
                <AcceptButton
                  endsAt={new Date(offer.expiresAt).getTime()}
                  onPress={onAccept}
                  loading={busy}
                  disabled={left === 0}
                />
                <Button label="Pass" variant="quiet" onPress={onPass} disabled={busy} compact />
              </View>
            </View>
          </Paper>
        </Animated.View>
      </View>
    </Modal>
  );
}

function AcceptButton({
  endsAt,
  onPress,
  loading,
  disabled,
}: {
  readonly endsAt: number;
  readonly onPress: () => void;
  readonly loading: boolean;
  readonly disabled: boolean;
}) {
  const p = useDrain(endsAt, OFFER_SECONDS * 1000);
  const fill = useAnimatedStyle(() => ({ transform: [{ scaleX: p.get() }] }));
  const off = disabled || loading;
  return (
    <Press
      onPress={() => {
        tap("medium");
        onPress();
      }}
      disabled={off}
      scaleTo={0.97}
      style={[styles.accept, disabled && styles.acceptGone]}
      accessibilityRole="button"
      accessibilityLabel="Accept trip"
      accessibilityState={{ disabled: off, busy: loading }}
    >
      <Animated.View style={[styles.acceptFill, fill]} />
      {loading ? (
        <ActivityIndicator color={c.onAccent} />
      ) : (
        <View style={styles.acceptLabel}>
          <Ionicons name="checkmark-circle" size={22} color={c.onAccent} />
          <Txt v="heading" tone="inverse">
            {disabled ? "Offer ended" : "Accept"}
          </Txt>
        </View>
      )}
    </Press>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  root: { flex: 1, backgroundColor: c.surfaceHigh },
  mapArea: { flex: 1, marginBottom: -radius.xl },
  badge: {
    position: "absolute",
    left: space.md,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    backgroundColor: c.textStrong,
  },
  panel: {},
  // Inside the paper, not on it: Paper lays its children out in an inner
  // frame that eases to their height, so a gap on the paper never reaches them.
  content: { gap: space.lg },
  head: { flexDirection: "row", alignItems: "center", gap: space.md },
  fare: { flexDirection: "row", alignItems: "baseline", gap: 6, marginTop: space.xs },
  unit: { marginBottom: 6 },
  buttons: { gap: space.xs },
  accept: {
    minHeight: tokens.MIN_TOUCH_TARGET + 12,
    borderRadius: radius.pill,
    backgroundColor: c.accentDeep,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  acceptGone: { opacity: 0.45 },
  acceptFill: { ...StyleSheet.absoluteFill, backgroundColor: c.accent, transformOrigin: "left" },
  acceptLabel: { flexDirection: "row", alignItems: "center", gap: space.sm },
});
