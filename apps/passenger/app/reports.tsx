import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Button, CaseCard, EmptyState, Enter, Screen, SkeletonRows, space } from "@nova/kit";
import { caseStatusLabel, caseTitle, listMyCases, type MyCase } from "@nova/data";
import { supabase } from "../src/lib/supabase";
import { useSession } from "../src/lib/session";
import { goBack } from "../src/lib/nav";

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function Reports() {
  const router = useRouter();
  const { userId } = useSession();
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
      footer={<Button label="Report something" variant="secondary" onPress={() => router.push("/report")} />}
    >
      {cases === null ? (
        <SkeletonRows count={3} />
      ) : cases.length === 0 ? (
        <EmptyState icon="document-text" title="Nothing reported" body="Left something on a trip, or something went wrong? Open the trip in Activity, or report it here." />
      ) : (
        <View style={styles.stack}>
          {cases.map((k, i) => (
            <Enter key={k.id} i={i}>
              <CaseCard
                number={k.number}
                title={caseTitle(k)}
                status={k.status}
                statusLabel={caseStatusLabel(k.status)}
                when={when(k.createdAt)}
                description={k.description}
                resolution={k.resolution}
              />
            </Enter>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.md },
});
