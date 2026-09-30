import { useState } from "react";
import { useRouter } from "expo-router";
import { AuthNote, AuthScreen, Banner, Button, Field, StaffScene } from "@nova/kit";
import { myStaffRole } from "@nova/data";
import { supabase } from "../src/lib/supabase";
import { goBack } from "../src/lib/nav";
import { useLightStatusBar } from "../src/lib/statusBar";

const INSPECTING = ["inspector", "safety", "admin"];

/**
 * Inspectors are staff: their accounts are made with the staff script and
 * sign in with an email and password, not the phone code riders use.
 */
export default function StaffLogin() {
  useLightStatusBar();
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
    <AuthScreen
      scene={<StaffScene />}
      title="Staff sign in"
      subtitle="For Nova inspectors. Riders sign in with their phone number."
      onBack={() => goBack(router)}
      footer={<Button label="Sign in" variant="highlight" onPress={signIn} loading={busy} disabled={!email.includes("@") || password.length < 6} />}
    >
      <Field label="Work email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" onSubmitEditing={signIn} />
      {error ? (
        <Banner tone="bad" icon="alert-circle">
          {error}
        </Banner>
      ) : null}
      <AuthNote icon="help-circle">Forgotten it? An administrator can reset it with the staff script.</AuthNote>
    </AuthScreen>
  );
}
