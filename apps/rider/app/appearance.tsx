import { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { Banner, ChoiceRow, Divider, Group, Screen, appearance, setAppearance, space, type Appearance, type IconName } from "@nova/kit";
import { goBack } from "../src/lib/nav";

const OPTIONS: { kind: Appearance; label: string; hint: string; icon: IconName }[] = [
  { kind: "system", label: "Match phone", hint: "Light or dark, whatever your phone is set to", icon: "phone-portrait" },
  { kind: "light", label: "Light", hint: "Always the light look", icon: "sunny" },
  { kind: "dark", label: "Dark", hint: "Always the night look", icon: "moon" },
];

export default function AppearanceScreen() {
  const router = useRouter();
  const [chosen, setChosen] = useState<Appearance>(appearance);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = async (kind: Appearance) => {
    if (kind === chosen || busy) return;
    setChosen(kind);
    setBusy(true);
    try {
      // The app restarts in the new look; nothing here runs after this.
      await setAppearance(kind);
    } catch {
      setBusy(false);
      setError("Could not change the look. Try again.");
    }
  };

  return (
    <Screen title="Appearance" subtitle="The app restarts for a moment when you change this." onBack={() => goBack(router)} gap={space.lg}>
      <Group key="options">
        {OPTIONS.map((o, i) => (
          <View key={o.kind}>
            {i > 0 ? <Divider inset={space.md + 38 + space.md} /> : null}
            <ChoiceRow kind="radio" icon={o.icon} on={chosen === o.kind} onPress={() => void choose(o.kind)} disabled={busy} title={o.label} hint={o.hint} />
          </View>
        ))}
      </Group>
      {error ? (
        <Banner key="error" tone="bad" icon="alert-circle">
          {error}
        </Banner>
      ) : null}
    </Screen>
  );
}
