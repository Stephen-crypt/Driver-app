import { useEffect, useState } from "react";
import { Linking, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { goBack } from "../src/lib/nav";
import { Banner, Button, ChoiceRow, Divider, Group, Screen, SuccessMark, TextArea, Txt, notify, space, type IconName } from "@nova/kit";
import { EMERGENCY_NUMBER, REPORT_KINDS, getActiveTrip, reportIssue, type ReportKind } from "@nova/data";
import { supabase } from "../src/lib/supabase";
import { useSession } from "../src/lib/session";
import * as loc from "../src/lib/location";

const ICON: Record<ReportKind, IconName> = {
  vehicle_problem: "construct",
  safety_issue: "warning",
  accident: "medical",
  incident: "document-text",
};

const PROMPT: Record<ReportKind, string> = {
  vehicle_problem: "What's wrong? Rear brake soft, a light out, a flat…",
  safety_issue: "What did you see, and where?",
  accident: "What happened, where, and is anyone hurt?",
  incident: "What happened, and where?",
};

/**
 * NOVA §25 and §29. Filed against the shift and the trip it happened on, with
 * where the rider was standing - the three things someone investigating it
 * later will ask first.
 */
export default function Report() {
  const router = useRouter();
  const { riderId } = useSession();
  const [kind, setKind] = useState<ReportKind>("vehicle_problem");
  const [note, setNote] = useState("");
  const [tripId, setTripId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!riderId) return;
    getActiveTrip(supabase, riderId).then((t) => setTripId(t?.id ?? null)).catch(() => {});
  }, [riderId]);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await reportIssue(supabase, kind, note.trim(), tripId, await loc.getCurrent());
      notify("success");
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the report.");
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    const urgent = kind === "accident" || kind === "safety_issue";
    return (
      <Screen
        footer={
          <View style={styles.footer}>
            <Button label="See your reports" variant="secondary" onPress={() => router.replace("/reports")} />
            <Button label="Done" onPress={() => goBack(router)} />
          </View>
        }
      >
        <View style={styles.sent}>
          <SuccessMark size={72} />
          <Txt v="title" align="center">
            Report sent
          </Txt>
          <Txt v="body" tone="muted" align="center">
            The fleet office has it, with where you are and when{tripId ? ", and the trip you're on" : ""}.
          </Txt>
        </View>
        {urgent ? (
          <Banner tone="bad" icon="call" action={{ label: `Call ${EMERGENCY_NUMBER}`, onPress: () => void Linking.openURL(`tel:${EMERGENCY_NUMBER}`) }}>
            If anyone is hurt or in danger, call {EMERGENCY_NUMBER} now. A report is not an emergency call.
          </Banner>
        ) : null}
      </Screen>
    );
  }

  const length = note.trim().length;

  return (
    <Screen
      title="Report a problem"
      subtitle={tripId ? "Your current trip is attached." : "Sent to the fleet office with your location."}
      onBack={() => goBack(router)}
      gap={space.md}
      footer={
        <View style={styles.footer}>
          {error ? <Banner tone="bad" icon="alert-circle">{error}</Banner> : null}
          <Button label="Send report" onPress={send} loading={busy} disabled={length < 3} />
        </View>
      }
    >
      <Group key="kinds">
        {REPORT_KINDS.map((k, i) => (
          <View key={k.kind}>
            {i > 0 ? <Divider inset={space.md + 38 + space.md} /> : null}
            <ChoiceRow kind="radio" icon={ICON[k.kind]} on={kind === k.kind} onPress={() => setKind(k.kind)} title={k.label} hint={k.hint} />
          </View>
        ))}
      </Group>

      <TextArea
        key="note"
        value={note}
        onChangeText={setNote}
        placeholder={PROMPT[kind]}
        maxLength={1000}
        accessibilityLabel="What happened"
      />
      <Txt key="count" v="caption" tone="muted" align="right" tabularNums>
        {length < 3 ? "A few words is enough" : `${note.length} / 1000`}
      </Txt>
    </Screen>
  );
}

const styles = StyleSheet.create({
  footer: { gap: space.sm },
  sent: { alignItems: "center", gap: space.sm, paddingTop: space.xxl, paddingBottom: space.xl },
});
