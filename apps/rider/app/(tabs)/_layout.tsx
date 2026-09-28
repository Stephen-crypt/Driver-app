import { useEffect, useState } from "react";
import { View } from "react-native";
import { Redirect, Tabs } from "expo-router";
import { TabBar, c, type TabBarProps } from "@nova/kit";
import { myStaffRole } from "@nova/data";
import { supabase } from "../../src/lib/supabase";
import { useSession } from "../../src/lib/session";

const ICONS = {
  index: { on: "speedometer", off: "speedometer-outline" },
  earnings: { on: "wallet", off: "wallet-outline" },
  trips: { on: "time", off: "time-outline" },
  me: { on: "person", off: "person-outline" },
} as const;

type Gate = "loading" | "welcome" | "details" | "pending" | "ok" | "inspector";

/**
 * The tabs are the working app, and only an approved rider reaches them. The
 * gate used to be nowhere: a rider still under review opened straight onto the
 * console and found out at "Start shift" that none of it would work.
 */
export default function TabsLayout() {
  const { signedIn, riderId } = useSession();
  const [gate, setGate] = useState<Gate>("loading");

  useEffect(() => {
    if (signedIn === null) return;
    if (!signedIn || !riderId) {
      setGate("welcome");
      return;
    }
    let active = true;
    supabase
      .from("riders")
      .select("verification")
      .eq("id", riderId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        // A read that failed is not a verdict - let them in and let the server
        // refuse the shift if it has to.
        if (error) return setGate("ok");
        const v = (data as { verification?: string } | null)?.verification;
        if (v) return setGate(v === "verified" ? "ok" : "pending");
        // Not a rider: an inspector signed in with a staff account goes to
        // their own screens; anyone else is a rider who hasn't finished.
        void myStaffRole(supabase).then((s) => {
          if (active) setGate(s && ["inspector", "safety", "admin"].includes(s.role) ? "inspector" : "details");
        });
      });
    return () => {
      active = false;
    };
  }, [signedIn, riderId]);

  if (gate === "loading") return <View style={{ flex: 1, backgroundColor: c.surface }} />;
  if (gate === "welcome") return <Redirect href="/welcome" />;
  if (gate === "details") return <Redirect href="/onboarding/details" />;
  if (gate === "pending") return <Redirect href="/onboarding/pending" />;
  if (gate === "inspector") return <Redirect href="/inspect" />;

  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <TabBar {...(props as unknown as TabBarProps)} icons={ICONS} />}
    >
      <Tabs.Screen name="index" options={{ title: "Today" }} />
      <Tabs.Screen name="earnings" options={{ title: "Earnings" }} />
      <Tabs.Screen name="trips" options={{ title: "Trips" }} />
      <Tabs.Screen name="me" options={{ title: "Me" }} />
    </Tabs>
  );
}
