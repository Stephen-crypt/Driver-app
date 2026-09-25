// Supabase's Send SMS Hook, delivering through Pindo.
//
// Pindo is the Rwandan route: local delivery, local rates, and a sender ID that
// reads as a Rwandan brand rather than a foreign shortcode. Supabase has no
// native Pindo provider, so auth calls this hook instead of a built-in one.
//
// The signature check is not optional. Without it this endpoint is a public
// button that spends the SMS balance, and an attacker who finds the URL can
// drain it and post any text they like under the Gera sender ID.
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

interface HookPayload {
  user?: { id?: string; phone?: string };
  sms?: { otp?: string };
}

const PINDO_URL = "https://api.pindo.io/v1/sms/";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const hookSecret = Deno.env.get("SEND_SMS_HOOK_SECRET");
  const pindoToken = Deno.env.get("PINDO_API_TOKEN");
  const sender = Deno.env.get("PINDO_SENDER_ID") ?? "Gera";

  // Fail closed. A missing secret must never degrade into "skip the check" -
  // that is how a misconfigured deploy silently becomes an open relay.
  if (!hookSecret) return json({ error: "hook_secret_not_configured" }, 500);
  if (!pindoToken) return json({ error: "pindo_token_not_configured" }, 500);

  const raw = await req.text();

  let payload: HookPayload;
  try {
    // Supabase signs with `v1,whsec_<base64>`; standardwebhooks wants the
    // base64 alone.
    const wh = new Webhook(hookSecret.replace("v1,whsec_", ""));
    payload = wh.verify(raw, Object.fromEntries(req.headers)) as HookPayload;
  } catch {
    return json({ error: "invalid_signature" }, 401);
  }

  const phone = payload.user?.phone;
  const otp = payload.sms?.otp;
  if (!phone || !otp) return json({ error: "malformed_payload" }, 400);

  // Pindo wants E.164 with the plus. GoTrue hands the number without it.
  const to = phone.startsWith("+") ? phone : `+${phone}`;

  // Kept to one segment on purpose: an SMS over 160 characters bills as two,
  // and this is the single most-sent message in the product.
  const text = `Your Gera code is ${otp}. It expires in 10 minutes.`;

  const res = await fetch(PINDO_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${pindoToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to, text, sender }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    // Never echo the OTP or the token into logs - this line ends up in the
    // project's log stream, which is not a secret store.
    console.error(`pindo send failed: ${res.status} ${detail.slice(0, 200)}`);
    if (res.status === 401) return json({ error: "pindo_unauthorized" }, 500);
    if (res.status === 409) return json({ error: "pindo_rejected_number" }, 400);
    return json({ error: "pindo_send_failed" }, 502);
  }

  // An empty 200 is what the hook contract treats as success.
  return new Response(null, { status: 200 });
});
