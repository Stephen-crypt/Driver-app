import { useState } from "react";
import { Linking, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  Banner,
  Button,
  ChoiceRow,
  Divider,
  Group,
  Odometer,
  Screen,
  SuccessMark,
  TextArea,
  Txt,
  notify,
  space,
  type IconName,
} from "@nova/kit";
import { EMERGENCY_NUMBER, PASSENGER_CASE_KINDS, openCase, type MyCase, type PassengerCaseKind } from "@nova/data";
import { supabase } from "../src/lib/supabase";
import { goBack } from "../src/lib/nav";

const ICON: Record<PassengerCaseKind, IconName> = {
  lost_property: "bag-handle",
  complaint: "chatbox-ellipses",
  incident: "shield",
  other: "document-text",
};

/**
 * NOVA §51, §53, §54. Reached from a past trip (so the trip - and with it the
 * rider and the vehicle - is attached without the passenger having to know
 * any of it) or from Account with no trip.
 */
export default function Report() {
  const router = useRouter();
  const params = useLocalSearchParams<{ trip?: string; to?: string; kind?: PassengerCaseKind }>();
  const tripId = params.trip || null;
  const [kind, setKind] = useState<PassengerCaseKind>(params.kind ?? "lost_property");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<MyCase | null>(null);

  const chosen = PASSENGER_CASE_KINDS.find((k) => k.kind === kind)!;

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      setSent(await openCase(supabase, kind, tripId, text.trim()));
      notify("success");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send that.");
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
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
          <Txt v="caption" tone="muted">
            Report number
          </Txt>
          <Odometer value={String(sent.number)} v="hero" delay={260} />
          <Txt v="heading" align="center">
            {kind === "lost_property" ? "We'll ask your rider to look for it" : "Our support team has it"}
          </Txt>
          <Txt v="body" tone="muted" align="center">
            You'll get a notification when there's an answer. Quote the number if you call us.
          </Txt>
        </View>
        {kind === "incident" ? (
          <Banner tone="bad" icon="call" action={{ label: `Call ${EMERGENCY_NUMBER}`, onPress: () => void Linking.openURL(`tel:${EMERGENCY_NUMBER}`) }}>
            If you're in danger now, call {EMERGENCY_NUMBER}. A report is not an emergency call.
          </Banner>
        ) : null}
      </Screen>
    );
  }

  return (
    <Screen
      title="Tell us what happened"
      subtitle={params.to ? `Your trip to ${params.to} is attached.` : undefined}
      onBack={() => goBack(router)}
      footer={
        <View style={styles.footer}>
          {error ? (
            <Banner tone="bad" icon="alert-circle">
              {error}
            </Banner>
          ) : null}
          <Button label="Send report" onPress={send} loading={busy} disabled={text.trim().length < 10} />
        </View>
      }
    >
      <View style={styles.stack}>
        <Group>
          {PASSENGER_CASE_KINDS.map((k, i) => (
            <View key={k.kind}>
              {i > 0 ? <Divider inset={space.md + 38 + space.md} /> : null}
              <ChoiceRow kind="radio" icon={ICON[k.kind]} on={kind === k.kind} onPress={() => setKind(k.kind)} title={k.label} hint={k.hint} />
            </View>
          ))}
        </Group>

        <TextArea
          value={text}
          onChangeText={setText}
          placeholder={chosen.prompt}
          maxLength={1000}
          accessibilityLabel="What happened"
        />
        <Txt v="caption" tone="muted" align="right" tabularNums>
          {text.trim().length < 10 ? `${10 - text.trim().length} more characters` : `${text.length} / 1000`}
        </Txt>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.md },
  footer: { gap: space.sm },
  sent: { alignItems: "center", gap: space.sm, paddingVertical: space.xl },
});
