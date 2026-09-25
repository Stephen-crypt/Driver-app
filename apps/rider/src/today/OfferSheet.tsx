import { useEffect, useState } from "react";
import { Modal, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Button,
  Chip,
  CountdownRing,
  GeraMap,
  Paper,
  Txt,
  c,
  money,
  notify,
  space,
} from "@gera/kit";
import {
  distanceBetween,
  distanceLabel,
  etaLabel,
  getTripPoints,
  secondsLeft,
  type LiveOffer,
  type TripPoints,
} from "@gera/data";
import { supabase } from "../lib/supabase";
import type { Coords } from "../lib/location";
import { useNow } from "./useNow";

const OFFER_SECONDS = 15;

/**
 * An offer takes the whole screen. It has fifteen seconds, and in that time the
 * rider needs exactly three things: how much, how far to the pickup, and where
 * it ends. Everything else on the phone waits.
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
  const now = useNow(250, offer !== null);
  const [points, setPoints] = useState<TripPoints | null>(null);

  useEffect(() => {
    setPoints(null);
    if (!offer) return;
    // The strongest buzz the phone has. An offer missed because the phone was
    // in a mount and the screen changed silently is fifteen seconds wasted.
    notify("warning");
    let active = true;
    getTripPoints(supabase, offer.tripId)
      .then((p) => active && setPoints(p))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [offer?.offerId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!offer) return null;
  const left = secondsLeft(offer.expiresAt, now);
  const toPickup = points && here ? distanceBetween(here, points.pickup) : null;
  const tripLength = points ? distanceBetween(points.pickup, points.dropoff) : null;

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
    <Modal visible animationType="slide" onRequestClose={onPass} statusBarTranslucent>
      <View style={styles.root}>
        <View style={styles.mapArea}>
          {points ? (
            <GeraMap
              center={points.pickup}
              markers={markers}
              route={[points.pickup, points.dropoff]}
              fit
              topInset={insets.top}
            />
          ) : null}
        </View>

        <Paper style={styles.paper}>
          <View style={styles.head}>
            <View style={styles.flex}>
              <Chip label={`New trip · ${offer.vehicleClass === "moto" ? "Moto" : "Cab"}`} tone="accent" />
              <View style={styles.fare}>
                <Txt v="hero" tabularNums>
                  {offer.fareRwf === null ? "—" : money(offer.fareRwf)}
                </Txt>
                <Txt v="heading" tone="muted" style={styles.unit}>
                  RWF
                </Txt>
              </View>
            </View>
            <CountdownRing total={OFFER_SECONDS} remaining={left} />
          </View>

          <View style={styles.legs}>
            <Leg
              kind="pickup"
              title={offer.pickupLabel}
              detail={[
                toPickup !== null ? `${distanceLabel(toPickup)} from you` : null,
                offer.etaSeconds ? `about ${etaLabel(offer.etaSeconds)}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              note={offer.pickupNote}
            />
            <Leg
              kind="dropoff"
              title={offer.dropoffLabel}
              detail={tripLength !== null ? `${distanceLabel(tripLength)} trip` : ""}
            />
          </View>

          <Button label="Accept" onPress={onAccept} loading={busy} disabled={left === 0} />
          <Button label="Pass" variant="quiet" onPress={onPass} disabled={busy} />
        </Paper>
      </View>
    </Modal>
  );
}

export function Leg({
  kind,
  title,
  detail,
  note,
}: {
  readonly kind: "pickup" | "dropoff";
  readonly title: string;
  readonly detail?: string;
  readonly note?: string | null;
}) {
  return (
    <View style={styles.leg}>
      <View style={[styles.legMark, kind === "dropoff" ? styles.legDrop : styles.legPick]} />
      <View style={styles.flex}>
        <Txt v="heading" lines={1}>
          {title}
        </Txt>
        {detail ? (
          <Txt v="label" tone="muted">
            {detail}
          </Txt>
        ) : null}
        {note ? (
          <View style={styles.note}>
            <Txt v="label" tone="default">
              “{note}”
            </Txt>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  root: { flex: 1, backgroundColor: c.surface },
  mapArea: { flex: 1 },
  paper: { gap: space.md },
  head: { flexDirection: "row", alignItems: "center", gap: space.md },
  fare: { flexDirection: "row", alignItems: "baseline", gap: 6, marginTop: space.xs },
  unit: { marginBottom: 6 },
  legs: { gap: space.md, paddingVertical: space.xs },
  leg: { flexDirection: "row", gap: space.md },
  legMark: { width: 12, height: 12, marginTop: 6, borderRadius: 6 },
  legPick: { backgroundColor: c.textStrong },
  legDrop: { backgroundColor: c.destination, borderRadius: 3 },
  note: {
    marginTop: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: c.surfaceHigh,
    alignSelf: "flex-start",
  },
});
