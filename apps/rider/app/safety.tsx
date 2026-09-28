import { Linking, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { goBack } from "../src/lib/nav";
import { Button, Group, Row, Divider, Screen, Txt, Well, c, radius, space, type IconName } from "@gera/kit";
import { EMERGENCY_NUMBER } from "@gera/data";

const RULES: readonly { icon: IconName; title: string; body: string }[] = [
  {
    icon: "shield-checkmark",
    title: "Two helmets, both fastened",
    body: "Yours and your passenger's. Don't set off until theirs is clipped - it is the law, and it is the difference in a fall.",
  },
  {
    icon: "keypad",
    title: "Check the PIN every time",
    body: "The PIN proves the person on the back is the person who booked. Never start a trip without it, even for a regular.",
  },
  {
    icon: "cash",
    title: "The fare is on the screen",
    body: "Collect exactly what the app shows. If a passenger disputes it, show them the receipt and report it - never argue at the kerb.",
  },
  {
    icon: "moon",
    title: "At night, stay on lit roads",
    body: "Take the main road even if it is longer. Your passenger can see your route, and so can we.",
  },
  {
    icon: "wallet",
    title: "Don't carry more cash than you need",
    body: "Hand in at the depot when you can. Above the limit, the app stops offering you trips until you do.",
  },
];

export default function Safety() {
  const router = useRouter();
  return (
    <Screen title="Riding safely" subtitle="Five rules that keep you and your passenger safe." onBack={() => goBack(router)} gap={space.lg}>
      <Group key="rules">
        {RULES.map((r, i) => (
          <View key={r.title}>
            {i > 0 ? <Divider inset={space.md + 38 + space.md} /> : null}
            <Row title={r.title} subtitle={r.body} icon={r.icon} iconTone="good" full />
          </View>
        ))}
      </Group>
      <View key="sos" style={styles.sos}>
        <View style={styles.sosHead}>
          <Well icon="warning" tone="bad" />
          <Txt v="heading" style={styles.flex}>
            In an emergency
          </Txt>
        </View>
        <Txt v="body" tone="muted">
          Use the red button on the Today screen. It records where you are and who you're carrying. If anyone is hurt, call{" "}
          {EMERGENCY_NUMBER} first.
        </Txt>
        <Button label={`Call ${EMERGENCY_NUMBER}`} icon="call" variant="danger" onPress={() => void Linking.openURL(`tel:${EMERGENCY_NUMBER}`)} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  sos: { gap: space.md, padding: space.md, borderRadius: radius.lg, backgroundColor: c.surfaceRaised },
  sosHead: { flexDirection: "row", alignItems: "center", gap: space.md },
});
