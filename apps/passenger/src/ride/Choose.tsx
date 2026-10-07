import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  Banner,
  Button,
  Enter,
  Field,
  Odometer,
  Press,
  Skeleton,
  Txt,
  VehicleArt,
  c,
  font,
  money,
  radius,
  selection,
  space,
} from "@nova/kit";
import { dateLabel, daysLabel, pickupMinutes, type NearbyRiders, type QuoteResult } from "@nova/data";
import {
  LaterPicker,
  RegularPicker,
  endDateOf,
  firstRideDate,
  type BookingMode,
  type LaterPlan,
  type RegularPlan,
} from "./When";

export type VehicleClass = "moto" | "cab" | "cab_xl";

// Moto first and default: it is the dominant mode in Kigali. Ordering it second
// would import a Western assumption about what a ride normally is.
export const CLASSES: readonly { id: VehicleClass; label: string; blurb: string; seats: number }[] = [
  { id: "moto", label: "Moto", blurb: "Fastest through traffic", seats: 1 },
  { id: "cab", label: "Cab", blurb: "Covered, out of the rain", seats: 3 },
  { id: "cab_xl", label: "Cab XL", blurb: "Room for luggage", seats: 6 },
];

export function Choose({
  mode,
  later,
  onLater,
  regular,
  onRegular,
  destination,
  pickupLabel,
  quotes,
  selected,
  onSelect,
  pickupNote,
  onPickupNote,
  durationS,
  busy,
  error,
  canBook,
  onBook,
  nearby,
  onChangePickup,
}: {
  readonly mode: BookingMode;
  readonly later: LaterPlan;
  readonly onLater: (p: LaterPlan) => void;
  readonly regular: RegularPlan;
  readonly onRegular: (p: RegularPlan) => void;
  readonly destination: string;
  readonly pickupLabel: string;
  readonly quotes: Partial<Record<VehicleClass, QuoteResult>>;
  readonly selected: VehicleClass;
  readonly onSelect: (v: VehicleClass) => void;
  readonly pickupNote: string;
  readonly onPickupNote: (s: string) => void;
  readonly durationS: number | null;
  readonly busy: boolean;
  readonly error: string | null;
  readonly canBook: boolean;
  readonly onBook: () => void;
  /** Set the pickup somewhere other than where the phone is. */
  readonly onChangePickup?: () => void;
  /** Free riders near the pickup, per vehicle; null until known. */
  readonly nearby?: readonly NearbyRiders[] | null;
}) {
  const router = useRouter();
  const quote = quotes[selected];
  const minutes = durationS ? Math.max(1, Math.round(durationS / 60)) : null;
  const vehicle = CLASSES.find((k) => k.id === selected)?.label.toLowerCase() ?? "ride";

  // What is still missing before this can be booked, said as the button's
  // label - a disabled button with no reason is a dead end.
  const first = mode === "regular" ? firstRideDate(regular) : null;
  const missing =
    mode === "later" && !later.time
      ? "Pick a time"
      : mode === "regular" && regular.days.length === 0
        ? "Pick at least one day"
        : mode === "regular" && !regular.time
          ? "Pick a time"
          : null;
  const label =
    missing ??
    (mode === "later" ? `Schedule ${vehicle}` : mode === "regular" ? "Set up schedule" : `Book ${vehicle}`);

  return (
    <View style={styles.stack}>
      {/* The map above draws the route; here it is one line, so the vehicles
          and the Book button fit on a small phone without scrolling. */}
      <Enter i={0} style={styles.head}>
        <View style={styles.flex}>
          <Txt v="h2">{mode === "later" ? "Book ahead" : mode === "regular" ? "Regular trip" : "Choose your ride"}</Txt>
          <Txt v="label" tone="muted" lines={1}>
            {pickupLabel} to {destination}
          </Txt>
          {onChangePickup ? (
            <Press onPress={onChangePickup} style={styles.change} accessibilityRole="button" accessibilityLabel="Change pickup">
              <Ionicons name="locate" size={13} color={c.accent} />
              <Txt v="label" tone="accent" style={styles.changeText}>
                Change pickup
              </Txt>
            </Press>
          ) : null}
        </View>
        {minutes ? (
          <View style={styles.eta}>
            <Ionicons name="time" size={13} color={c.accent} />
            <Txt v="caption" tone="accent" style={styles.etaText}>
              {minutes} min
            </Txt>
          </View>
        ) : null}
      </Enter>

      <View style={styles.options} accessibilityRole="radiogroup" accessibilityLabel="Vehicle">
        {CLASSES.map((k, i) => {
          const on = selected === k.id;
          const q = quotes[k.id];
          return (
            <Enter key={k.id} i={i + 1}>
              <Press
                onPress={() => {
                  if (on) return;
                  selection();
                  onSelect(k.id);
                }}
                scaleTo={0.985}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${k.label}, ${q ? `${money(q.amountRwf)} Rwandan francs` : "price loading"}`}
                style={[styles.option, on && styles.optionOn]}
              >
                <View style={[styles.artBox, on && styles.artBoxOn]}>
                  <VehicleArt kind={k.id} size={56} />
                </View>
                <View style={styles.flex}>
                  <View style={styles.meta}>
                    <Txt v="section">{k.label}</Txt>
                    <View style={styles.seats}>
                      <Ionicons name="person" size={11} color={c.textMuted} />
                      <Txt v="caption" tone="muted">
                        {k.seats}
                      </Txt>
                    </View>
                  </View>
                  {/* Booking now, how soon one can come says more than the
                      blurb; booking ahead, it means nothing. */}
                  {nearby && mode === "now" ? (
                    <Away nearby={nearby} kind={k.id} />
                  ) : (
                    <Txt v="label" tone="muted" lines={1}>
                      {k.blurb}
                    </Txt>
                  )}
                </View>
                {/* Every option shows its price, not just the chosen one: a
                    passenger comparing a moto to a cab is comparing prices. */}
                {q ? (
                  <View style={styles.price}>
                    <Odometer value={money(q.amountRwf)} v="figure" delay={i * 60} />
                    <Txt v="caption" tone="muted">
                      RWF
                    </Txt>
                  </View>
                ) : (
                  <Skeleton width={64} height={22} r={6} />
                )}
              </Press>
            </Enter>
          );
        })}
      </View>

      {mode === "later" ? (
        <Enter i={4} style={styles.when}>
          <Txt v="heading">When?</Txt>
          <LaterPicker plan={later} onChange={onLater} />
        </Enter>
      ) : null}
      {mode === "regular" ? (
        <Enter i={4} style={styles.when}>
          <Txt v="heading">Which days?</Txt>
          <RegularPicker plan={regular} onChange={onRegular} />
          {regular.time && first ? (
            <Txt v="label" tone="muted">
              {daysLabel(regular.days)} at {regular.time}, first ride {dateLabel(first)}, until{" "}
              {dateLabel(endDateOf(regular))}. The price stays {quote ? `${money(quote.amountRwf)} RWF` : "fixed"} for every ride.
            </Txt>
          ) : null}
        </Enter>
      ) : null}

      <Enter i={5}>
        <Field
          value={pickupNote}
          onChangeText={onPickupNote}
          placeholder="Note for your rider - where to find you"
          onPaper
          accessibilityLabel="Note for your rider"
        />
      </Enter>

      <Enter i={6}>
        <Press onPress={() => router.push("/payment")} scaleTo={0.985} style={styles.pay} accessibilityRole="button" accessibilityLabel="Payment: cash, paid to your rider at the end">
          <View style={styles.cash}>
            <Ionicons name="cash" size={17} color={c.success} />
          </View>
          <View style={styles.flex}>
            <Txt v="bodyStrong">Cash</Txt>
            <Txt v="caption" tone="muted">
              Pay your rider at the end
            </Txt>
          </View>
          <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
        </Press>
      </Enter>

      {error ? <Banner tone="bad" icon="alert-circle">{error}</Banner> : null}

      <Button
        variant="highlight"
        label={label}
        trailing={quote && !missing ? money(quote.amountRwf) : undefined}
        onPress={onBook}
        loading={busy}
        disabled={!quote || !canBook || missing !== null}
      />
    </View>
  );
}

/** "3 min away" in green, or that none are free: said before booking, not after. */
function Away({ nearby, kind }: { readonly nearby: readonly NearbyRiders[]; readonly kind: VehicleClass }) {
  const n = nearby.find((r) => r.vehicleClass === kind);
  return (
    <View style={[styles.away, !n && styles.awayNone]}>
      <Ionicons name={n ? "time" : "remove-circle-outline"} size={11} color={n ? c.success : c.textMuted} />
      <Txt v="caption" tone={n ? "good" : "muted"} style={styles.awayText}>
        {n ? `${pickupMinutes(n.nearestM)} min away` : "None free"}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  change: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", paddingTop: 4, paddingBottom: 2 },
  changeText: { fontFamily: font.semibold },
  away: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 3,
    marginTop: 3,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: c.successSoft,
  },
  awayNone: { backgroundColor: c.surfaceHigh },
  awayText: { fontFamily: font.semibold },
  flex: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1 },
  stack: { gap: space.md },
  head: { flexDirection: "row", alignItems: "center", gap: space.sm },
  eta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: c.tintBlue,
  },
  etaText: { fontFamily: font.semibold },
  when: { gap: space.sm },
  options: { gap: space.sm },
  // A picked vehicle lights up in the brand's yellow, the colour of "go".
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.sm,
    paddingRight: space.md,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: c.border,
    backgroundColor: c.surfaceRaised,
  },
  optionOn: { borderColor: c.highlight, backgroundColor: c.tintYellow },
  artBox: { width: 64, height: 54, borderRadius: radius.md, backgroundColor: c.surfaceHigh, alignItems: "center", justifyContent: "center" },
  artBoxOn: { backgroundColor: c.surfaceRaised },
  meta: { flexDirection: "row", alignItems: "center", gap: space.sm },
  seats: { flexDirection: "row", alignItems: "center", gap: 2 },
  price: { alignItems: "flex-end" },
  pay: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingVertical: space.xs,
  },
  cash: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: c.successSoft,
    alignItems: "center",
    justifyContent: "center",
  },
});
