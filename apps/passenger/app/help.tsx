import { Linking, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Disclosure, Divider, Group, Press, Row, Screen, Txt, c, radius, space, type IconName } from "@nova/kit";
import { EMERGENCY_NUMBER } from "@nova/data";
import { goBack } from "../src/lib/nav";

const SAFETY: readonly { icon: IconName; title: string; body: string }[] = [
  {
    icon: "keypad",
    title: "Only give your PIN to your rider",
    body: "Your rider can't start the trip without it. If someone asks for it who isn't on your trip screen, don't get on.",
  },
  {
    icon: "car",
    title: "Check the plate and the vest",
    body: "Both are on your trip screen. If they don't match the vehicle in front of you, don't get in.",
  },
  {
    icon: "share-social",
    title: "Share your trip",
    body: "On any live trip, tap Share. It sends where you're going, who's taking you and their plate.",
  },
  {
    icon: "pricetag",
    title: "The price is agreed before you go",
    body: "What you agreed is what you pay. It only goes up if you kept your rider waiting, or if the ride went well past the route you booked - a stop you asked for, measured by GPS. If a rider asks for more, tell us.",
  },
];

const FAQ = [
  {
    q: "What's the PIN for?",
    a: "It proves to your rider that you're the person who booked. They type it in before the trip starts. It changes every trip.",
  },
  {
    q: "Is waiting charged?",
    a: "Your rider waits five minutes free once they arrive. After that each full minute is charged, and the app shows you the clock so it's never a surprise.",
  },
  {
    q: "Why can't I get past 'Finding you a rider'?",
    a: "There may be nobody free nearby. We ask the closest riders one at a time before telling you. Wait a few minutes and book again.",
  },
  {
    q: "My rider cancelled. Am I charged?",
    a: "No. Nothing is charged until a trip completes, and cash means nothing leaves your pocket until you hand it over.",
  },
  {
    q: "Can I pay with MTN MoMo?",
    a: "Not yet. Cash is the only method that settles today - we'd rather say so than take a payment we can't complete.",
  },
  {
    q: "Where does my money go?",
    a: "You hand the fare to your rider in cash. Nova owns the vehicles, so the rider passes that cash on to us and is paid separately for their work.",
  },
];

export default function Help() {
  const router = useRouter();

  return (
    <Screen title="Help and safety" onBack={() => goBack(router)}>
      <View style={styles.stack}>
        {/* First, because someone opening this screen in a hurry is not here to
            read a FAQ. */}
        <Press
          style={styles.emergency}
          onPress={() => Linking.openURL(`tel:${EMERGENCY_NUMBER}`)}
          scaleTo={0.98}
          accessibilityRole="button"
          accessibilityLabel={`Call ${EMERGENCY_NUMBER}, Rwanda emergency services`}
        >
          <View style={styles.emergencyWell}>
            <Ionicons name="call" size={22} color={c.onAccent} />
          </View>
          <View style={styles.flex}>
            <Txt v="figure" tone="bad">
              Call {EMERGENCY_NUMBER}
            </Txt>
            <Txt v="label" tone="bad">
              Rwanda emergency services
            </Txt>
          </View>
          <Ionicons name="chevron-forward" size={20} color={c.danger} />
        </Press>

        <Group title="Staying safe">
          {SAFETY.map((s, i) => (
            <View key={s.title}>
              {i > 0 ? <Divider inset={70} /> : null}
              <Row title={s.title} subtitle={s.body} icon={s.icon} iconTone="good" full />
            </View>
          ))}
        </Group>

        <Group title="Common questions">
          {FAQ.map((f, i) => (
            <View key={f.q}>
              {i > 0 ? <Divider /> : null}
              <Disclosure title={f.q}>{f.a}</Disclosure>
            </View>
          ))}
        </Group>

        <Group title="Talk to us">
          <Row title="Report a problem" subtitle="Lost property, a trip that went wrong, anything else" icon="flag" iconTone="warn" onPress={() => router.push("/report")} />
          <Divider inset={70} />
          <Row title="Your reports" subtitle="What you've sent us, and our answers" icon="document-text" onPress={() => router.push("/reports")} />
        </Group>

        {/* Said plainly: what happens, and who is on the other end. */}
        <Txt v="label" tone="muted">
          Nova's control room watches every live trip. The Safety button on a trip sends them your location and who
          you're with, and they call you back. If you're in danger, call {EMERGENCY_NUMBER} first.
        </Txt>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  stack: { gap: space.lg },
  emergency: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: c.dangerSoft,
  },
  emergencyWell: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: c.danger,
    alignItems: "center",
    justifyContent: "center",
  },
});
