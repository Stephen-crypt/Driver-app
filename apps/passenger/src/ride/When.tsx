import { useEffect, useMemo, useRef } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Press, Txt, c, radius, selection, space } from "@gera/kit";
import { addDays, dayLabel, isoWeekday, kigaliToday, timeSlots } from "@gera/data";

export type BookingMode = "now" | "later" | "regular";

export interface LaterPlan {
  readonly date: string;
  readonly time: string | null;
}

export interface RegularPlan {
  readonly days: readonly number[];
  readonly time: string | null;
  readonly startDate: string;
  readonly weeks: number;
}

const DAY_LETTER = ["M", "T", "W", "T", "F", "S", "S"];
const DAY_NAME = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DURATIONS = [
  { weeks: 2, label: "2 weeks" },
  { weeks: 4, label: "1 month" },
  { weeks: 13, label: "3 months" },
];

export function Pill({
  label,
  on,
  onPress,
  wide,
  onLayout,
}: {
  readonly label: string;
  readonly on: boolean;
  readonly onPress: () => void;
  readonly wide?: boolean;
  readonly onLayout?: (x: number) => void;
}) {
  return (
    <Press
      onLayout={onLayout ? (e) => onLayout(e.nativeEvent.layout.x) : undefined}
      onPress={() => {
        if (!on) selection();
        onPress();
      }}
      scaleTo={0.95}
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      accessibilityLabel={label}
      style={[styles.pill, wide && styles.pillWide, on && styles.pillOn]}
    >
      <Txt v="label" tone={on ? "inverse" : "strong"} tabularNums>
        {label}
      </Txt>
    </Press>
  );
}

export function Times({
  slots,
  time,
  onTime,
}: {
  readonly slots: readonly string[];
  readonly time: string | null;
  readonly onTime: (t: string) => void;
}) {
  const scroller = useRef<ScrollView>(null);
  if (slots.length === 0) {
    return (
      <Txt v="label" tone="muted">
        No times left today. Pick another day.
      </Txt>
    );
  }
  return (
    <ScrollView ref={scroller} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {slots.map((t) => (
        <Pill
          key={t}
          label={t}
          on={time === t}
          onPress={() => onTime(t)}
          // Opens on the time already chosen rather than at dawn.
          onLayout={time === t ? (x) => scroller.current?.scrollTo({ x: Math.max(0, x - 80), animated: false }) : undefined}
        />
      ))}
    </ScrollView>
  );
}

/** One ride, one day, one time. */
export function LaterPicker({
  plan,
  onChange,
}: {
  readonly plan: LaterPlan;
  readonly onChange: (p: LaterPlan) => void;
}) {
  const today = kigaliToday();
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(today, i)), [today]);
  const slots = useMemo(() => timeSlots(plan.date), [plan.date]);

  // A time chosen for one day may not exist on another (earlier than now,
  // today). Drop it rather than book a time the passenger cannot see.
  useEffect(() => {
    if (plan.time && !slots.includes(plan.time)) onChange({ ...plan, time: null });
  }, [slots]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={styles.block}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {days.map((d) => (
          <Pill key={d} label={dayLabel(d, today)} on={plan.date === d} onPress={() => onChange({ ...plan, date: d })} wide />
        ))}
      </ScrollView>
      <Times slots={slots} time={plan.time} onTime={(t) => onChange({ ...plan, time: t })} />
    </View>
  );
}

/** The same ride on chosen weekdays, for a few weeks. */
export function RegularPicker({
  plan,
  onChange,
}: {
  readonly plan: RegularPlan;
  readonly onChange: (p: RegularPlan) => void;
}) {
  const today = kigaliToday();
  // Every slot of the day is fair game for a schedule: the first occurrence is
  // tomorrow at the earliest.
  const slots = useMemo(() => timeSlots(addDays(today, 1)), [today]);
  const starts = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(today, i + 1)), [today]);

  return (
    <View style={styles.block}>
      <Weekdays days={plan.days} onChange={(days) => onChange({ ...plan, days })} />
      <Times slots={slots} time={plan.time} onTime={(t) => onChange({ ...plan, time: t })} />
      <View style={styles.split}>
        <Txt v="label" tone="muted">
          Starting
        </Txt>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {starts.map((d) => (
            <Pill
              key={d}
              label={dayLabel(d, today)}
              on={plan.startDate === d}
              onPress={() => onChange({ ...plan, startDate: d })}
              wide
            />
          ))}
        </ScrollView>
      </View>
      <View style={styles.split}>
        <Txt v="label" tone="muted">
          For
        </Txt>
        <View style={styles.row}>
          {DURATIONS.map((x) => (
            <Pill key={x.weeks} label={x.label} on={plan.weeks === x.weeks} onPress={() => onChange({ ...plan, weeks: x.weeks })} />
          ))}
        </View>
      </View>
    </View>
  );
}

/** Seven day dots, Monday first. ISO weekdays: 1 is Monday. */
export function Weekdays({
  days,
  onChange,
}: {
  readonly days: readonly number[];
  readonly onChange: (days: number[]) => void;
}) {
  const toggle = (d: number) => onChange(days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort());
  return (
    <View style={styles.week}>
      {DAY_LETTER.map((l, i) => {
        const d = i + 1;
        const on = days.includes(d);
        return (
          <Press
            key={d}
            onPress={() => {
              selection();
              toggle(d);
            }}
            scaleTo={0.92}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            accessibilityLabel={DAY_NAME[i]}
            style={[styles.dayDot, on && styles.pillOn]}
          >
            <Txt v="bodyStrong" tone={on ? "inverse" : "strong"}>
              {l}
            </Txt>
          </Press>
        );
      })}
    </View>
  );
}

/** The schedule's end date, inclusive. */
export function endDateOf(plan: RegularPlan): string {
  return addDays(plan.startDate, plan.weeks * 7 - 1);
}

/** Whether the start date is one of the chosen days - if not, say when the first ride is. */
export function firstRideDate(plan: RegularPlan): string | null {
  for (let i = 0; i < 7; i++) {
    const d = addDays(plan.startDate, i);
    if (plan.days.includes(isoWeekday(d))) return d;
  }
  return null;
}

const styles = StyleSheet.create({
  block: { gap: space.md },
  row: { flexDirection: "row", gap: space.sm, paddingRight: space.sm },
  pill: {
    height: 40,
    minWidth: 64,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: c.surfaceHigh,
    alignItems: "center",
    justifyContent: "center",
  },
  pillWide: { minWidth: 88 },
  pillOn: { backgroundColor: c.textStrong },
  week: { flexDirection: "row", justifyContent: "space-between" },
  dayDot: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: c.surfaceHigh,
    alignItems: "center",
    justifyContent: "center",
  },
  split: { gap: space.sm },
});
