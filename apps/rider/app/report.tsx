import { useEffect, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { goBack } from "../src/lib/nav";
import { Ionicons } from "@expo/vector-icons";
import { Banner, Button, Divider, Group, Screen, Txt, c, notify, space, tap, type IconName } from "@gera/kit";
import { REPORT_KINDS, getActiveTrip, reportIssue, type ReportKind } from "@gera/data";
import { supabase } from "../src/lib/supabase";
import { useSession } from "../src/lib/session";
import * as loc from "../src/lib/location";

const ICON: Record<ReportKind, IconName> = {
  vehicle_problem: "construct",
  safety_issue: "warning",
  accident: "medical",
  incident: "document-text",
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
    return (
      <Screen
        title="Report sent"
        subtitle="The fleet office has it, with where you are and when."
        footer={<Button label="Done" onPress={() => goBack(router)} />}
      >
        {kind === "accident" || kind === "safety_issue" ? (
          <Banner tone="bad" icon="call">
            If anyone is hurt or in danger, call 112 now. A report is not an emergency call.
          </Banner>
        ) : null}
      </Screen>
    );
  }

  return (
    <Screen
      title="Report a problem"
      subtitle={tripId ? "This will be attached to your current trip." : undefined}
      onBack={() => goBack(router)}
      footer={
        <View style={styles.footer}>
          {error ? <Banner tone="bad" icon="alert-circle">{error}</Banner> : null}
          <Button label="Send report" onPress={send} loading={busy} disabled={note.trim().length < 3} />
        </View>
      }
    >
      <View style={styles.stack}>
        <Group>
          {REPORT_KINDS.map((k, i) => {
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
          value={note}
          onChangeText={setNote}
          placeholder="What happened, and where?"
          placeholderTextColor={c.textMuted}
          multiline
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  stack: { gap: space.lg },
  footer: { gap: space.sm },
  option: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, minHeight: 64 },
  pressed: { backgroundColor: c.surfaceHigh },
  well: { width: 38, height: 38, borderRadius: 12, backgroundColor: c.surfaceHigh, alignItems: "center", justifyContent: "center" },
  wellOn: { backgroundColor: c.accent },
  input: {
    minHeight: 120,
    borderRadius: 16,
    backgroundColor: c.surfaceRaised,
    padding: space.md,
    fontSize: 16,
    color: c.textStrong,
    textAlignVertical: "top",
  },
});
