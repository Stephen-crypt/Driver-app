// Texts the safety phones when someone presses SOS.
//
//   POST { alertId }  - called by the app right after raise_sos succeeds
//
// The SOS itself is already recorded by then; this only makes sure a person
// hears about it when the control room tab is shut. The database decides
// whether to text (claim_sos_text): the caller's own alert, once, recent, and
// not within two minutes of the last text about them. Phones come from
// SOS_ALERT_PHONES; the text goes the same way as sign-in codes.
import { callerClient, json, serviceClient } from "../_shared/supabase.ts";
import { pickRoute } from "../_shared/sms.ts";
import { alertPhones, type Notice, sosText } from "./notice.ts";

// SMS Gate may hold an SOS for an hour if its phone is offline: late is far
// better than never for an emergency, unlike a sign-in code.
const SOS_LIFETIME_S = 3600;

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const caller = callerClient(req);
  const { data: auth } = await caller.auth.getUser();
  if (!auth.user) return json({ error: "unauthenticated" }, 401);

  const phones = alertPhones(Deno.env.get("SOS_ALERT_PHONES"));
  if (phones.length === 0) return json({ error: "sos_phones_not_configured" }, 500);

  let body: { alertId?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (typeof body.alertId !== "string") return json({ error: "alert_id_required" }, 400);

  const svc = serviceClient();
  const { data, error } = await svc.rpc("claim_sos_text", { p_alert_id: body.alertId, p_caller: auth.user.id });
  if (error) {
    console.error(`claim_sos_text: ${error.message}`);
    return json({ error: "claim_failed" }, 500);
  }
  const notice = (data as Notice[] | null)?.[0];
  // Not theirs, already texted, too old, or a repeat press: nothing to send,
  // and nothing wrong either.
  if (!notice) return json({ texted: 0 });

  const text = sosText(notice);
  let sent = 0;
  for (const to of phones) {
    const route = pickRoute((name) => Deno.env.get(name), to, text, SOS_LIFETIME_S);
    if (!route) break;
    const res = await fetch(route.url, route.init).catch(() => null);
    if (res?.ok) sent++;
    else console.error(`sos text via ${route.provider} failed: ${res?.status ?? "unreachable"}`);
  }

  if (sent === 0) {
    // Give the claim back so the next press, or a retry, can send it.
    await svc.rpc("release_sos_text", { p_alert_id: body.alertId });
    return json({ error: "sos_text_failed" }, 502);
  }
  return json({ texted: sent });
});
