import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Banner, Button, Field, Txt, c, money, radius, space, tap, type IconName } from "@gera/kit";
import { dateLabel, daysLabel, type QuoteResult } from "@gera/data";
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
export const CLASSES: readonly { id: VehicleClass; label: string; blurb: string; icon: IconName; seats: string }[] = [
  { id: "moto", label: "Moto", blurb: "Fastest through traffic", icon: "bicycle", seats: "1" },
  { id: "cab", label: "Cab", blurb: "Covered, out of the rain", icon: "car", seats: "3" },
  { id: "cab_xl", label: "Cab XL", blurb: "Room for luggage", icon: "car-sport", seats: "6" },
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
      <View>
        <Txt v="title" lines={1}>
          {destination}
        </Txt>
        <Txt v="label" tone="muted" lines={1}>
          From {pickupLabel}
          {minutes ? ` · about ${minutes} min` : ""}
        </Txt>
      </View>

      <View style={styles.options}>
        {CLASSES.map((k) => {
          const on = selected === k.id;
          const q = quotes[k.id];
          return (
            <Pressable
              key={k.id}
              onPress={() => {
                tap();
                onSelect(k.id);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              style={[styles.option, on && styles.optionOn]}
            >
              <View style={[styles.well, on && styles.wellOn]}>
                <Ionicons name={k.icon} size={22} color={on ? c.onAccent : c.textStrong} />
              </View>
              <View style={styles.flex}>
                <Txt v="bodyStrong">{k.label}</Txt>
                <Txt v="label" tone="muted">
                  {k.blurb} · {k.seats} {k.seats === "1" ? "seat" : "seats"}
                </Txt>
              </View>
              {/* Every option shows its price, not just the chosen one: a
                  passenger comparing a moto to a cab is comparing prices. */}
              <Txt v="figure" tabularNums tone={q ? "strong" : "muted"}>
                {q ? money(q.amountRwf) : "···"}
              </Txt>
            </Pressable>
          );
        })}
      </View>

      {mode === "later" ? (
        <View style={styles.when}>
          <Txt v="heading">When?</Txt>
          <LaterPicker plan={later} onChange={onLater} />
        </View>
      ) : null}
      {mode === "regular" ? (
        <View style={styles.when}>
          <Txt v="heading">Which days?</Txt>
          <RegularPicker plan={regular} onChange={onRegular} />
          {regular.time && first ? (
            <Txt v="label" tone="muted">
              {daysLabel(regular.days)} at {regular.time}, first ride {dateLabel(first)}, until{" "}
              {dateLabel(endDateOf(regular))}. The price stays {quote ? `${money(quote.amountRwf)} RWF` : "fixed"} for every ride.
            </Txt>
          ) : null}
        </View>
      ) : null}

      <Field
        value={pickupNote}
        onChangeText={onPickupNote}
        placeholder="Note for your rider - where to find you"
        onPaper
        accessibilityLabel="Note for your rider"
      />

      <Pressable onPress={() => router.push("/payment")} style={styles.pay} accessibilityRole="button">
        <Ionicons name="cash-outline" size={20} color={c.success} />
        <Txt v="bodyStrong" style={styles.flex}>
          Cash
        </Txt>
        <Txt v="label" tone="muted">
          Pay your rider at the end
        </Txt>
        <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
      </Pressable>

      {error ? <Banner tone="bad" icon="alert-circle">{error}</Banner> : null}

      <Button
        label={label}
        trailing={quote && !missing ? `${money(quote.amountRwf)} RWF` : undefined}
        onPress={onBook}
        loading={busy}
        disabled={!quote || !canBook || missing !== null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  stack: { gap: space.md },
  when: { gap: space.sm },
  options: { gap: space.sm },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.sm,
    paddingRight: space.md,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: "transparent",
    backgroundColor: c.surfaceHigh,
  },
  optionOn: { borderColor: c.accent, backgroundColor: c.accentSoft },
  well: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: c.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  wellOn: { backgroundColor: c.accent },
  pay: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingVertical: space.xs,
    paddingHorizontal: space.xs,
  },
});
