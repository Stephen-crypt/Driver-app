import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Banner, Button, Field, Screen, Txt, space } from "@gera/kit";
import { myStaffRole } from "@gera/data";
import { supabase } from "../src/lib/supabase";
import { goBack } from "../src/lib/nav";

const INSPECTING = ["inspector", "safety", "admin"];

/**
 * Inspectors are staff: their accounts are made with the staff script and
 * sign in with an email and password, not the phone code riders use.
 */
export default function StaffLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      const { error: e } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (e) throw new Error("That email and password don't match a staff account.");
      const staff = await myStaffRole(supabase);
      if (!staff || !INSPECTING.includes(staff.role)) {
        await supabase.auth.signOut();
        throw new Error("This account isn't set up for inspections. Ask an administrator.");
      }
      router.replace("/inspect");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't sign in.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      title="Staff sign in"
      subtitle="For Gera inspectors. Riders sign in with their phone number."
      onBack={() => goBack(router)}
      footer={
        <View style={styles.footer}>
          {error ? (
            <Banner tone="bad" icon="alert-circle">
              {error}
            </Banner>
          ) : null}
          <Button label="Sign in" onPress={signIn} loading={busy} disabled={!email.includes("@") || password.length < 6} />
        </View>
      }
    >
      <View style={styles.stack}>
        <Field label="Work email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" onSubmitEditing={signIn} />
        <Txt v="caption" tone="muted">
          Forgotten it? An administrator can reset it with the staff script.
        </Txt>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.md },
  footer: { gap: space.sm },
});
