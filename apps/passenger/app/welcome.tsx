import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Button, ModalSheet, PinPatches, Txt, WelcomePager, c, space } from "@nova/kit";
import { useDarkStatusBar } from "../src/lib/statusBar";

/**
 * The picture, then the three things a first-time passenger needs to know,
 * one at a time on the night: the price is agreed first, there is a PIN, and
 * it is cash. The PIN is shown the way it will look on the trip screen - the
 * one piece of Nova nobody has seen before.
 */
export default function Welcome() {
  const router = useRouter();
  const [riderInfo, setRiderInfo] = useState(false);
  useDarkStatusBar();

  return (
    <>
      <WelcomePager
        picture={require("../assets/welcome-hero.jpg")}
        pictureLabel="A moto carrying a passenger along a winding road through terraced green hills"
        focus={0.66}
        logo={require("../assets/icon.png")}
        name="Nova"
        slides={[
          {
            icon: "pricetag",
            title: "The price before you go",
            body: "Motos and cabs across Kigali. You agree the fare when you book: no meter, no argument at the end.",
          },
          {
            icon: "keypad",
            title: "A PIN on every trip",
            body: "Your rider can't start until you give them your four numbers. It's how you both know it's the right ride.",
            extra: <PinPatches pin="4821" size="sm" roll />,
          },
          {
            icon: "cash",
            title: "Pay in cash, at the end",
            body: "Hand it to your rider when you arrive. Mobile money is coming.",
          },
        ]}
        primary={{ label: "Create an account", onPress: () => router.push({ pathname: "/onboarding/phone", params: { mode: "signup" } }) }}
        secondary={{ label: "I already have an account", onPress: () => router.push({ pathname: "/onboarding/phone", params: { mode: "login" } }) }}
        tertiary={{ label: "Want to ride for Nova?", onPress: () => setRiderInfo(true) }}
      />

      <ModalSheet visible={riderInfo} onClose={() => setRiderInfo(false)} title="Ride for Nova">
        <View style={styles.sheet}>
          <View style={styles.fact}>
            <Ionicons name="key" size={18} color={c.accent} />
            <Txt v="body" tone="muted" style={styles.flex}>
              Riders use a separate app, Nova Rider. We provide the vehicle: you don't buy it, fuel it or fix it.
            </Txt>
          </View>
          <View style={styles.fact}>
            <Ionicons name="wallet" size={18} color={c.accent} />
            <Txt v="body" tone="muted" style={styles.flex}>
              You collect fares in cash and hand them in. Your share of every trip is paid to you on a fixed schedule.
            </Txt>
          </View>
          <View style={styles.fact}>
            <Ionicons name="document-text" size={18} color={c.accent} />
            <Txt v="body" tone="muted" style={styles.flex}>
              You'll need a valid driving licence and a national ID.
            </Txt>
          </View>
          <Button label="Got it" onPress={() => setRiderInfo(false)} />
        </View>
      </ModalSheet>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  sheet: { gap: space.md },
  fact: { flexDirection: "row", gap: space.md, alignItems: "flex-start" },
});
