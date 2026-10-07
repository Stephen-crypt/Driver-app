// Supabase's Send SMS Hook: sign-in codes, delivered by SMS Gate (an Android
// phone with a local SIM) or by Pindo - see _shared/sms.ts for which and why.
// Supabase has no native provider for either, so auth calls this hook instead
// of a built-in one.
//
// The signature check is not optional. Without it this endpoint is a public
// button that spends the SMS balance, and an attacker who finds the URL can
// drain it and send any text they like from Nova's number.
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";
import { codeText, e164, pickRoute } from "../_shared/sms.ts";

interface HookPayload {
  user?: { id?: string; phone?: string };
  sms?: { otp?: string };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Supabase Auth reads a hook's failure as { error: { http_code, message } }
// and refuses any reply - success included - without a JSON content type.
const fail = (message: string, status: number) => json({ error: { http_code: status, message } }, status);

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return fail("method_not_allowed", 405);

  const hookSecret = Deno.env.get("SEND_SMS_HOOK_SECRET");

  // Fail closed. A missing secret must never degrade into "skip the check" -
  // that is how a misconfigured deploy silently becomes an open relay.
  if (!hookSecret) return fail("hook_secret_not_configured", 500);

  const raw = await req.text();

  let payload: HookPayload;
  try {
    // Supabase signs with `v1,whsec_<base64>`; standardwebhooks wants the
    // base64 alone.
    const wh = new Webhook(hookSecret.replace("v1,whsec_", ""));
    payload = wh.verify(raw, Object.fromEntries(req.headers)) as HookPayload;
  } catch {
    return fail("invalid_signature", 401);
  }

  const phone = payload.user?.phone;
  const otp = payload.sms?.otp;
  if (!phone || !otp) return fail("malformed_payload", 400);

  const route = pickRoute((name) => Deno.env.get(name), e164(phone), codeText(otp));
  if (!route) return fail("sms_provider_not_configured", 500);

  const res = await fetch(route.url, route.init).catch(() => null);
  if (!res?.ok) {
    const detail = res ? await res.text().catch(() => "") : "unreachable";
    // Never echo the code or the credentials into logs - this line ends up in
    // the project's log stream, which is not a secret store.
    console.error(`${route.provider} send failed: ${res?.status ?? "-"} ${detail.slice(0, 200)}`);
    if (res?.status === 401) return fail("sms_unauthorized", 500);
    if (route.provider === "pindo" && res?.status === 409) return fail("sms_rejected_number", 400);
    return fail("sms_send_failed", 502);
  }

  // An empty JSON object is what the hook contract treats as success.
  return json({}, 200);
});
