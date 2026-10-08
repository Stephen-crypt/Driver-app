// Which of the passenger's saved codes a quote should use: "best" (the
// default, the one saving most), "none", or one code by id. Anything else
// is treated as "best" rather than passed on.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function promoChoice(raw: unknown): string {
  if (raw === "none" || raw === "best") return raw;
  if (typeof raw === "string" && UUID.test(raw)) return raw;
  return "best";
}
