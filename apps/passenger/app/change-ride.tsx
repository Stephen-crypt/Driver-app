import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Banner, Button, Screen, Txt, notify, space } from "@nova/kit";
import { changeRideTime, dateLabel, kigaliTime, timeSlots } from "@nova/data";
import { supabase } from "../src/lib/supabase";
import { goBack } from "../src/lib/nav";
import { Times } from "../src/ride/When";

/** NOVA §12: move one booked ride. Same day, same price, the rest untouched. */
export default function ChangeRide() {
  const router = useRouter();
  const p = useLocalSearchParams<{ trip: string; at: string; to: string; regular?: string }>();
  const date = useMemo(
    () => new Date(p.at).toLocaleDateString("en-CA", { timeZone: "Africa/Kigali" }),
    [p.at],
  );
  const current = kigaliTime(p.at);
  const slots = useMemo(() => timeSlots(date).filter((t) => t !== current), [date, current]);
  const [time, setTime] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!time) return;
    setBusy(true);
    setError(null);
    try {
      await changeRideTime(supabase, p.trip, time);
      notify("success");
      goBack(router);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't change the time.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      title="Change the time"
      subtitle={`${dateLabel(date)}, to ${p.to}. Now ${current}.`}
      onBack={() => goBack(router)}
      footer={
        <View style={styles.footer}>
          {error ? (
            <Banner tone="bad" icon="alert-circle">
              {error}
            </Banner>
          ) : null}
          <Button label={time ? `Move to ${time}` : "Pick a time"} onPress={save} loading={busy} disabled={!time} />
        </View>
      }
    >
      <View style={styles.stack}>
        <Times slots={slots} time={time} onTime={setTime} />
        <Txt v="label" tone="muted">
          {p.regular
            ? "Only this ride moves. Your other regular rides keep their time, and the price stays the same."
            : "The price stays the same."}
        </Txt>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  footer: { gap: space.sm },
});
