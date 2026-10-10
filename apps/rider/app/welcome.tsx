import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Txt, VestPatch, WelcomePager, space } from "@nova/kit";
import { useDarkStatusBar } from "../src/lib/statusBar";

/**
 * What a rider actually wants to know before they sign up, in the order they
 * ask it: whose vehicle, what do I earn, and what happens to the cash.
 *
 * Nova owns the vehicles. A rider who believes the cash in their pocket is
 * theirs will spend it, so this screen says otherwise before they agree to
 * anything.
 */
export default function RiderWelcome() {
  const router = useRouter();
  useDarkStatusBar();
  return (
    <WelcomePager
      picture={require("../assets/welcome-hero.jpg")}
      pictureLabel="A rider in a yellow vest numbered 24, sitting on their motorbike on a hilltop road and looking out over the valley"
      focus={0.34}
      logo={require("../assets/icon.png")}
      name="Nova Rider"
      slides={[
        {
          icon: "key",
          title: "The vehicle is ours",
          body: "You don't buy it, fuel it or fix it. We hand you a working vehicle, and you ride.",
        },
        {
          icon: "eye",
          title: "See the fare before you accept",
          body: "Pickup, drop-off and the exact amount, before you commit to a trip.",
        },
        {
          icon: "wallet",
          title: "A share of every fare is yours",
          body: "Passengers pay cash and it is handed in. Your share is paid to you on a fixed schedule, and the app always shows both.",
        },
        {
          icon: "shirt",
          title: "Your number on your back",
          body: "You get a numbered vest, so passengers find the right moto. You'll need a licence and a national ID.",
          extra: (
            <View style={styles.vest}>
              <VestPatch value="214" size="md" roll delay={200} />
              <Txt v="label" tone="onHeroMuted" style={styles.flex}>
                Passengers look for this number.
              </Txt>
            </View>
          ),
        },
      ]}
      primary={{ label: "Become a rider", onPress: () => router.push({ pathname: "/onboarding/phone", params: { mode: "signup" } }) }}
      secondary={{ label: "I already ride for Nova", onPress: () => router.push({ pathname: "/onboarding/phone", params: { mode: "login" } }) }}
      tertiary={{ label: "Nova staff? Sign in here", onPress: () => router.push("/staff-login") }}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  vest: { flexDirection: "row", alignItems: "center", gap: space.md },
});
