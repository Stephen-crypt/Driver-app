import { useState } from "react";
import { Linking, Pressable, StyleSheet, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Banner, Button, Divider, Group, Screen, Txt, c, notify, radius, space, tap, type IconName } from "@gera/kit";
import { EMERGENCY_NUMBER, PASSENGER_CASE_KINDS, openCase, type MyCase, type PassengerCaseKind } from "@gera/data";
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
  const tripId = params.trip ?? null;
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
          <Txt v="caption" tone="muted">
            Report number
          </Txt>
          <Txt v="hero" tabularNums>
            {sent.number}
          </Txt>
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
          {PASSENGER_CASE_KINDS.map((k, i) => {
            const on = kind === k.kind;
            return (
              <View key={k.kind}>
                {i > 0 ? <Divider inset={space.md + 38 + space.md} /> : null}
                <Pressable
                  onPress={() => {
                    tap();
                    setKind(k.kind);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  style={({ pressed }) => [styles.option, pressed && styles.pressed]}
                >
                  <View style={[styles.well, on && styles.wellOn]}>
                    <Ionicons name={ICON[k.kind]} size={18} color={on ? c.onAccent : c.textMuted} />
                  </View>
                  <View style={styles.flex}>
                    <Txt v="bodyStrong">{k.label}</Txt>
                    <Txt v="label" tone="muted">
                      {k.hint}
                    </Txt>
                  </View>
                  {on ? <Ionicons name="checkmark-circle" size={22} color={c.accent} /> : null}
                </Pressable>
              </View>
            );
          })}
        </Group>

        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder={chosen.prompt}
          placeholderTextColor={c.textMuted}
          multiline
          maxLength={1000}
          accessibilityLabel="What happened"
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  stack: { gap: space.lg },
  footer: { gap: space.sm },
  sent: { alignItems: "center", gap: space.sm, paddingVertical: space.xl },
  option: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, minHeight: 64 },
  pressed: { backgroundColor: c.surfaceHigh },
  well: { width: 38, height: 38, borderRadius: 12, backgroundColor: c.surfaceHigh, alignItems: "center", justifyContent: "center" },
  wellOn: { backgroundColor: c.accent },
  input: {
    minHeight: 130,
    borderRadius: radius.lg,
    backgroundColor: c.surfaceRaised,
    padding: space.md,
    fontSize: 16,
    color: c.textStrong,
    textAlignVertical: "top",
  },
});
