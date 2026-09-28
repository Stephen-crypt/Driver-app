import type { Session } from "@supabase/supabase-js";
import type { NovaClient } from "./client";
import { normaliseRwandanPhone } from "./phone";

export async function requestOtp(client: NovaClient, phone: string): Promise<void> {
  const e164 = normaliseRwandanPhone(phone);
  const { error } = await client.auth.signInWithOtp({ phone: e164 });
  if (error) throw error;
}

export async function verifyOtp(
  client: NovaClient,
  phone: string,
  token: string,
): Promise<Session> {
  const e164 = normaliseRwandanPhone(phone);
  const { data, error } = await client.auth.verifyOtp({
    phone: e164,
    token,
    type: "sms",
  });
  if (error) throw error;
  if (!data.session) throw new Error("otp verification returned no session");
  return data.session;
}
