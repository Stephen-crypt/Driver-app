import { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Bars, Divider, Group, Row, Screen, Stat, StatRow, Txt, c, money, space } from "@gera/kit";
import {
  dailyEarnings,
  describeLedgerRow,
  getCashHeld,
  getNetOwed,
  listLedger,
  type DayEarnings,
  type LedgerRow,
} from "@gera/data";
import { supabase } from "../../src/lib/supabase";
import { useSession } from "../../src/lib/session";

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function when(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return sameDay ? `Today, ${time}` : `${d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}, ${time}`;
}

/**
 * NOVA §28. Two numbers that must never be netted - cash the rider is carrying
 * for the company, and money the company owes the rider - plus a week of what
 * they earned and every line that moved either one.
 */
export default function Earnings() {
  const { riderId } = useSession();
  const [days, setDays] = useState<DayEarnings[] | null>(null);
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [cash, setCash] = useState(0);
  const [owed, setOwed] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (!riderId) return;
      let active = true;
      const since = new Date();
      since.setHours(0, 0, 0, 0);
      since.setDate(since.getDate() - 13);
      Promise.all([
        listLedger(supabase, riderId, since),
        getCashHeld(supabase, riderId),
        getNetOwed(supabase, riderId),
      ])
        .then(([ledger, held, net]) => {
          if (!active) return;
          setRows(ledger);
          setDays(dailyEarnings(ledger, 7));
          setCash(held);
          setOwed(net);
        })
        .catch(() => active && setDays([]));
      return () => {
        active = false;
      };
    }, [riderId]),
  );

  const week = (days ?? []).reduce((t, d) => t + d.earnedRwf, 0);
  const trips = (days ?? []).reduce((t, d) => t + d.trips, 0);
  const today = days?.[days.length - 1];

  return (
    <Screen title="Earnings">
      {days === null ? (
        <ActivityIndicator color={c.accent} />
      ) : (
        <View style={styles.stack}>
          <View>
            <Txt v="label" tone="muted">
              Last 7 days
            </Txt>
            <View style={styles.hero}>
              <Txt v="display" tabularNums>
                {money(week)}
              </Txt>
              <Txt v="heading" tone="muted">
                RWF
              </Txt>
            </View>
            <Txt v="label" tone="muted">
              {trips} {trips === 1 ? "trip" : "trips"} · {money(today?.earnedRwf ?? 0)} RWF today
            </Txt>
          </View>

          <Bars
            values={days.map((d) => d.earnedRwf)}
            labels={days.map((d) => DAY[d.day.getDay()] ?? "")}
            highlight={days.length - 1}
            format={money}
          />

          <View style={styles.card}>
            <StatRow>
              <Stat label="Cash to hand in" value={money(cash)} unit="RWF" tone={cash > 0 ? "warn" : "strong"} />
              <Stat label="Owed to you" value={money(owed)} unit="RWF" tone="good" />
            </StatRow>
            <Txt v="caption" tone="muted">
              Fares you collect belong to the company and are handed in. Your share is paid to you on
              the fleet's payout schedule. The two are never netted.
            </Txt>
          </View>

          <Group title="Recent activity">
            {rows.length === 0 ? (
              <Row title="Nothing yet" subtitle="Your first completed trip will show here." icon="receipt-outline" iconTone="neutral" />
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
                    />
                  </View>
                );
              })
            )}
          </Group>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  hero: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  card: { backgroundColor: c.surfaceRaised, borderRadius: 20, padding: space.md, gap: space.md },
});
