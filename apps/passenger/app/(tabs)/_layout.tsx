import { useEffect, useState } from "react";
import { View } from "react-native";
import { Redirect, Tabs } from "expo-router";
import { TabBar, c, type TabBarProps } from "@gera/kit";
import { supabase } from "../../src/lib/supabase";
import { useSession } from "../../src/lib/session";

const ICONS = {
  index: { on: "navigate-circle", off: "navigate-circle-outline" },
  activity: { on: "time", off: "time-outline" },
  account: { on: "person", off: "person-outline" },
} as const;

type Gate = "loading" | "welcome" | "name" | "ok";

/**
 * Signed out goes to the welcome screen; signed in without a profile goes to
 * the one question onboarding asks. Verification used to send everyone to that
 * question, so a returning passenger was asked their name again and the second
 * profile insert failed.
 */
export default function TabsLayout() {
  const { signedIn, userId } = useSession();
  const [gate, setGate] = useState<Gate>("loading");

  useEffect(() => {
    if (signedIn === null) return;
    if (!signedIn || !userId) {
      setGate("welcome");
      return;
    }
    let active = true;
    supabase
      .from("profiles")
      .select("id")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        setGate(error || data ? "ok" : "name");
      });
    return () => {
      active = false;
    };
  }, [signedIn, userId]);

  if (gate === "loading") return <View style={{ flex: 1, backgroundColor: c.surface }} />;
  if (gate === "welcome") return <Redirect href="/welcome" />;
  if (gate === "name") return <Redirect href="/onboarding/name" />;

  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <TabBar {...(props as unknown as TabBarProps)} icons={ICONS} />}
    >
      <Tabs.Screen name="index" options={{ title: "Ride" }} />
      <Tabs.Screen name="activity" options={{ title: "Activity" }} />
      <Tabs.Screen name="account" options={{ title: "Account" }} />
    </Tabs>
  );
}
