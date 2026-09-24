/** MTN Rwanda uses 78/79; Airtel Rwanda uses 72/73. */
const MOBILE_PREFIXES = ["72", "73", "78", "79"] as const;

/**
 * Accepts 0788123456, 788123456, 250788123456, +250788123456 (with any
 * spacing or dashes) and returns strict E.164. Throws on anything else.
 */
export function normaliseRwandanPhone(input: string): string {
  const digits = input.replace(/[^\d]/g, "");

  let national: string;
  if (digits.length === 9) {
    national = digits;
  } else if (digits.length === 10 && digits.startsWith("0")) {
    national = digits.slice(1);
  } else if (digits.length === 12 && digits.startsWith("250")) {
    national = digits.slice(3);
  } else {
    throw new Error("invalid Rwandan mobile number");
  }

  const prefix = national.slice(0, 2);
  if (!(MOBILE_PREFIXES as readonly string[]).includes(prefix)) {
    throw new Error("invalid Rwandan mobile number");
  }

  return `+250${national}`;
}
