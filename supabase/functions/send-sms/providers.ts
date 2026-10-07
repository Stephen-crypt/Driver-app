// How a sign-in code reaches a phone. Two routes, chosen by which secrets are
// set: an Android phone running SMS Gate with a local SIM (free but for the
// SIM's own texts - the pilot route), or Pindo with a registered sender ID
// (the route at volume). Pure request builders, so both are tested offline.

export interface SmsRequest {
  readonly provider: "sms-gate" | "pindo";
  readonly url: string;
  readonly init: RequestInit;
}

const SMS_GATE_URL = "https://api.sms-gate.app/3rdparty/v1/messages";
const PINDO_URL = "https://api.pindo.io/v1/sms/";

// A code is good for ten minutes. If the gateway phone was offline, a code
// delivered after that only confuses - better it never arrives.
const CODE_LIFETIME_S = 600;

/** E.164 with the plus. GoTrue hands the number over without it. */
export function e164(phone: string): string {
  return phone.startsWith("+") ? phone : `+${phone}`;
}

/**
 * Kept to one segment on purpose: an SMS over 160 characters bills as two,
 * and this is the single most-sent message in the product.
 */
export function codeText(otp: string): string {
  return `Your Nova code is ${otp}. It expires in 10 minutes.`;
}

export function smsGateRequest(username: string, password: string, to: string, text: string): SmsRequest {
  return {
    provider: "sms-gate",
    url: SMS_GATE_URL,
    init: {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${username}:${password}`)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ textMessage: { text }, phoneNumbers: [to], ttl: CODE_LIFETIME_S }),
    },
  };
}

export function pindoRequest(token: string, sender: string, to: string, text: string): SmsRequest {
  return {
    provider: "pindo",
    url: PINDO_URL,
    init: {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to, text, sender }),
    },
  };
}

/** The route to use, from the secrets that are set; SMS Gate first. Null when neither is. */
export function pickRoute(
  env: (name: string) => string | undefined,
  to: string,
  text: string,
): SmsRequest | null {
  const user = env("SMSGATE_USERNAME");
  const pass = env("SMSGATE_PASSWORD");
  if (user && pass) return smsGateRequest(user, pass, to, text);
  const token = env("PINDO_API_TOKEN");
  if (token) return pindoRequest(token, env("PINDO_SENDER_ID") ?? "Nova", to, text);
  return null;
}
