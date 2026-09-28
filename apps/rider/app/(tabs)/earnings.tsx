import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useFocusEffect } from "expo-router";
import {
  Bars,
  Divider,
  EmptyState,
  Group,
  Odometer,
  Row,
  Screen,
  Segmented,
  Skeleton,
  SkeletonRows,
  Txt,
  Well,
  c,
  money,
  radius,
  space,
} from "@nova/kit";
import {
  dailyEarnings,
  describeLedgerRow,
  getCashHeld,
  getNetOwed,
  listLedger,
  type LedgerRow,
} from "@nova/data";
import { supabase } from "../../src/lib/supabase";
import { useSession } from "../../src/lib/session";

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_SHORT = ["S", "M", "T", "W", "T", "F", "S"];
type Span = "7" | "14";

function when(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return sameDay ? `Today, ${time}` : `${d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}, ${time}`;
}

/**
 * NOVA §28. Two numbers that must never be netted - cash the rider is carrying
 * for the company, and money the company owes the rider - plus what they
 * earned day by day and every line that moved either one.
 */
export default function Earnings() {
  const { riderId } = useSession();
  const [rows, setRows] = useState<LedgerRow[] | null>(null);
  const [cash, setCash] = useState(0);
  const [owed, setOwed] = useState(0);
  const [span, setSpan] = useState<Span>("7");

  useFocusEffect(
    useCallback(() => {
      if (!riderId) return;
      let active = true;
      const since = new Date();
      since.setHours(0, 0, 0, 0);
      since.setDate(since.getDate() - 13);
      Promise.all([listLedger(supabase, riderId, since), getCashHeld(supabase, riderId), getNetOwed(supabase, riderId)])
        .then(([ledger, held, net]) => {
          if (!active) return;
          setRows(ledger);
          setCash(held);
          setOwed(net);
        })
        .catch(() => active && setRows([]));
      return () => {
        active = false;
      };
    }, [riderId]),
  );

  if (rows === null) {
    return (
      <Screen title="Earnings" stagger={false}>
        <View style={styles.stack}>
          <View style={styles.heroSkeleton}>
            <Skeleton width="30%" height={14} />
            <Skeleton width="60%" height={46} r={10} />
            <Skeleton width="45%" height={14} />
          </View>
          <Skeleton height={150} r={radius.lg} />
          <SkeletonRows count={3} />
        </View>
      </Screen>
    );
  }

  const n = Number(span);
  const days = dailyEarnings(rows, n);
  const total = days.reduce((t, d) => t + d.earnedRwf, 0);
  const trips = days.reduce((t, d) => t + d.trips, 0);
  const today = days[days.length - 1];
  const anything = days.some((d) => d.earnedRwf > 0);

  return (
    <Screen title="Earnings" gap={space.lg}>
      <Segmented
        label="Period"
        compact
        value={span}
        onChange={(v) => setSpan(v as Span)}
        options={[
          { value: "7", label: "7 days" },
          { value: "14", label: "14 days" },
        ]}
      />

      <View style={styles.hero}>
        <Txt v="label" tone="muted">
          You earned in the last {n} days
        </Txt>
        <View style={styles.heroFigure}>
          <Odometer key={span} value={money(total)} v="display" accessibilityLabel={`${money(total)} Rwandan francs`} />
          <Txt v="heading" tone="muted">
            RWF
          </Txt>
        </View>
        {trips > 0 ? (
          <Txt v="label" tone="muted">
            {trips} {trips === 1 ? "trip" : "trips"}, {money(today?.earnedRwf ?? 0)} RWF of it today
          </Txt>
        ) : null}
      </View>

      {anything ? (
        <View style={styles.chart}>
          <Bars
            key={span}
            values={days.map((d) => d.earnedRwf)}
            labels={days.map((d) => (n > 7 ? DAY_SHORT : DAY)[d.day.getDay()] ?? "")}
            highlight={days.length - 1}
            format={money}
            height={160}
          />
        </View>
      ) : (
        // A week of nothing is one sentence, not 150 points of empty chart.
        <Txt v="label" tone="muted">
          No trips in the last {n} days. Each day's earnings show here as you ride.
        </Txt>
      )}

      <View style={styles.balances}>
        <Balance
          icon="cash"
          tone={cash > 0 ? "warn" : "neutral"}
          label="Cash to hand in"
          value={cash}
          note={cash > 0 ? "Company money you're carrying" : "Nothing to hand in"}
        />
        <Balance icon="wallet" tone="good" label="Owed to you" value={owed} note="Paid on the fleet's schedule" />
      </View>
      <Txt v="caption" tone="muted">
        Fares you collect belong to the company and are handed in. Your share is paid to you separately. The two are never
        netted against each other.
      </Txt>

      <Group title="Recent activity">
        {rows.length === 0 ? (
          <EmptyState compact icon="receipt" title="Nothing yet" body="Your first completed trip shows here." />
        ) : (
          rows.slice(0, 25).map((r, i) => {
            const d = describeLedgerRow(r);
            return (
              <View key={r.id}>
                {i > 0 ? <Divider inset={space.md + 38 + space.md} /> : null}
                <Row
                  title={d.title}
                  subtitle={when(r.createdAt)}
                  icon={d.affects === "cash" ? "cash-outline" : "wallet-outline"}
                  iconTone={d.affects === "cash" ? "neutral" : d.sign > 0 ? "good" : "warn"}
                  value={`${d.sign > 0 ? "+" : "−"}${money(r.amountRwf)}`}
                  valueTone={d.affects === "cash" ? "default" : d.sign > 0 ? "good" : "strong"}
                  valueNote={d.affects === "cash" ? "cash" : undefined}
                />
              </View>
            );
          })
        )}
      </Group>
    </Screen>
  );
}

function Balance({
  icon,
  tone,
  label,
  value,
  note,
}: {
  readonly icon: "cash" | "wallet";
  readonly tone: "warn" | "good" | "neutral";
  readonly label: string;
  readonly value: number;
  readonly note: string;
}) {
  return (
    <View style={styles.balance} accessible accessibilityLabel={`${label}: ${money(value)} Rwandan francs. ${note}`}>
      <Well icon={icon} tone={tone} size={36} />
      <Txt v="label" tone="muted">
        {label}
      </Txt>
      <View style={styles.heroFigure}>
        <Odometer value={money(value)} v="figure" tone={tone === "warn" ? "warn" : tone === "good" ? "good" : "strong"} delay={200} />
        <Txt v="caption" tone="muted">
          RWF
        </Txt>
      </View>
      <Txt v="caption" tone="muted">
        {note}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  heroSkeleton: { gap: space.sm },
  hero: { gap: 2 },
  heroFigure: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  chart: { paddingTop: space.xs },
  balances: { flexDirection: "row", gap: space.sm },
  balance: {
    flex: 1,
    gap: 4,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: c.surfaceRaised,
  },
});
