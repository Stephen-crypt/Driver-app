import { StyleSheet, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { Ionicons } from "@expo/vector-icons";
import { Odometer, RouteRail, SuccessMark, Txt, VEHICLE_NAME, VehicleGlyph, ZigzagEdge, c, money, radius, space, tokens, type VehicleKind } from "@nova/kit";

/** A short, sayable booking reference from the trip's id. */
export function referenceFor(id: string): string {
  return `NV-${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

/**
 * A booked-ahead ride as a ticket: the confirmation a passenger screenshots
 * for whoever they are meeting, and shows to anyone who asks about it. The QR
 * code carries the trip's id, so support or an inspector can open the exact
 * booking rather than search for it.
 */
export function Ticket({
  id,
  kind,
  when,
  from,
  to,
  vehicle,
  amountRwf,
}: {
  readonly id: string;
  readonly kind: "ride" | "regular";
  /** "Tomorrow, 07:30" or "Mon, Wed and Fri at 07:30". */
  readonly when: string;
  readonly from: string;
  readonly to: string;
  readonly vehicle: string;
  readonly amountRwf: number | null;
}) {
  const reference = referenceFor(id);
  return (
    <View accessibilityLabel={`Booking confirmed. ${when}, ${from} to ${to}.${kind === "ride" ? ` Reference ${reference}.` : ""}`}>
      <View style={styles.ticket}>
        <View style={styles.head}>
          <SuccessMark size={44} />
          <View style={styles.flex}>
            <Txt v="label" tone="good">
              {kind === "regular" ? "Regular trip set up" : "Booking confirmed"}
            </Txt>
            <Txt v="h2" lines={2}>
              {when}
            </Txt>
          </View>
        </View>

        {kind === "ride" ? (
          <View style={styles.code}>
            <View style={styles.qr}>
              <QRCode value={`NOVA-T-${id}`} size={124} color={tokens.palette.ink} backgroundColor="#FFFFFF" ecl="M" />
            </View>
            <View style={styles.reference}>
              <Txt v="caption" tone="muted">
                Booking reference
              </Txt>
              <Txt v="figure" tabularNums lines={1}>
                {reference}
              </Txt>
              <Txt v="caption" tone="muted" style={styles.refNote}>
                Show this if anyone asks about your ride.
              </Txt>
            </View>
          </View>
        ) : null}

        <RouteRail dense from={{ label: from, note: "Pickup" }} to={{ label: to, note: "Drop-off" }} />

        <View style={styles.foot}>
          <View style={styles.vehicle}>
            <VehicleGlyph kind={vehicle} size={18} colour={c.textMuted} />
            <Txt v="label" tone="muted">
              {VEHICLE_NAME[vehicle as VehicleKind] ?? "Ride"}
            </Txt>
          </View>
          {amountRwf !== null ? (
            <View style={styles.price}>
              <Odometer value={money(amountRwf)} v="figure" delay={200} />
              <Txt v="label" tone="muted">
                RWF{kind === "regular" ? " each" : ""}
              </Txt>
            </View>
          ) : null}
        </View>
        <View style={styles.locked}>
          <Ionicons name="lock-closed" size={13} color={c.success} />
          <Txt v="caption" tone="muted">
            The price is locked. Pay your rider in cash at the end.
          </Txt>
        </View>
      </View>
      <ZigzagEdge colour={c.surfaceRaised} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  ticket: {
    backgroundColor: c.surfaceRaised,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: space.md,
    gap: space.md,
  },
  head: { flexDirection: "row", alignItems: "center", gap: space.md },
  code: { flexDirection: "row", alignItems: "center", gap: space.md },
  qr: { padding: 8, borderRadius: radius.md, backgroundColor: "#FFFFFF", borderWidth: StyleSheet.hairlineWidth, borderColor: c.border },
  reference: { flex: 1, minWidth: 0, gap: 2 },
  refNote: { marginTop: 4 },
  foot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
  vehicle: { flexDirection: "row", alignItems: "center", gap: 6 },
  price: { flexDirection: "row", alignItems: "baseline", gap: 4 },
  locked: { flexDirection: "row", alignItems: "center", gap: 6 },
});
