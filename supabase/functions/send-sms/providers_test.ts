import { assertEquals } from "jsr:@std/assert@1";
import { codeText, e164, pickRoute } from "./providers.ts";

const env = (vars: Record<string, string>) => (name: string) => vars[name];

Deno.test("numbers get their plus; the code fits one text", () => {
  assertEquals(e164("250788123456"), "+250788123456");
  assertEquals(e164("+250788123456"), "+250788123456");
  assertEquals(codeText("123456").length <= 160, true);
});

Deno.test("SMS Gate: basic auth, one number, and a code that dies with its lifetime", async () => {
  const r = pickRoute(env({ SMSGATE_USERNAME: "ABC", SMSGATE_PASSWORD: "xyz" }), "+250788123456", "Your Nova code is 1")!;
  assertEquals(r.provider, "sms-gate");
  assertEquals(r.url, "https://api.sms-gate.app/3rdparty/v1/messages");
  assertEquals((r.init.headers as Record<string, string>).Authorization, `Basic ${btoa("ABC:xyz")}`);
  assertEquals(JSON.parse(r.init.body as string), {
    textMessage: { text: "Your Nova code is 1" },
    phoneNumbers: ["+250788123456"],
    ttl: 600,
  });
});

Deno.test("SMS Gate wins when both are set; Pindo when only it is", () => {
  const both = env({ SMSGATE_USERNAME: "a", SMSGATE_PASSWORD: "b", PINDO_API_TOKEN: "t" });
  assertEquals(pickRoute(both, "+250", "x")!.provider, "sms-gate");
  const pindo = pickRoute(env({ PINDO_API_TOKEN: "t", PINDO_SENDER_ID: "Nova" }), "+250788123456", "x")!;
  assertEquals(pindo.provider, "pindo");
  assertEquals(JSON.parse(pindo.init.body as string), { to: "+250788123456", text: "x", sender: "Nova" });
});

Deno.test("half a set of credentials is no route at all", () => {
  assertEquals(pickRoute(env({ SMSGATE_USERNAME: "a" }), "+250", "x"), null);
  assertEquals(pickRoute(env({}), "+250", "x"), null);
});
