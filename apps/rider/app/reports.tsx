import { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Button, CaseCard, Screen, Txt, c, space } from "@gera/kit";
import { caseStatusLabel, caseTitle, listMyCases, type MyCase } from "@gera/data";
import { supabase } from "../src/lib/supabase";
import { useSession } from "../src/lib/session";
import { goBack } from "../src/lib/nav";

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function Reports() {
  const router = useRouter();
  const { riderId: userId } = useSession();
  const [cases, setCases] = useState<MyCase[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      let active = true;
      listMyCases(supabase, userId)
        .then((r) => active && setCases(r))
        .catch(() => active && setCases([]));
      return () => {
        active = false;
      };
    }, [userId]),
  );

  return (
    <Screen
      title="Your reports"
      onBack={() => goBack(router)}
      footer={<Button label="Report a problem" variant="secondary" onPress={() => router.push("/report")} />}
    >
      {cases === null ? (
        <ActivityIndicator color={c.accent} />
      ) : cases.length === 0 ? (
        <View style={styles.empty}>
          <Txt v="heading">Nothing reported</Txt>
          <Txt v="body" tone="muted">
            Vehicle problems, safety issues and accidents you report show up here, with the fleet office's answer.
          </Txt>
        </View>
      ) : (
        <View style={styles.stack}>
          {cases.map((k) => (
            <CaseCard
              key={k.id}
              number={k.number}
              title={caseTitle(k)}
              status={k.status}
              statusLabel={caseStatusLabel(k.status)}
              when={when(k.createdAt)}
              description={k.description}
              resolution={k.resolution}
            />
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.md },
  empty: { gap: space.sm, paddingVertical: space.xl },
});
