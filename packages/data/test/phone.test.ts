import { describe, it, expect } from "vitest";
import { normaliseRwandanPhone } from "../src/phone";

describe("normaliseRwandanPhone", () => {
  it("accepts the local leading-zero format", () => {
    expect(normaliseRwandanPhone("0788123456")).toBe("+250788123456");
  });

  it("accepts the bare nine-digit format", () => {
    expect(normaliseRwandanPhone("788123456")).toBe("+250788123456");
  });

  it("accepts the country code without a plus", () => {
    expect(normaliseRwandanPhone("250788123456")).toBe("+250788123456");
  });

  it("passes through a correct E.164 number", () => {
    expect(normaliseRwandanPhone("+250788123456")).toBe("+250788123456");
  });

  it("ignores spaces and dashes", () => {
    expect(normaliseRwandanPhone("078 812-3456")).toBe("+250788123456");
  });

  it("accepts every Rwandan mobile prefix", () => {
    for (const prefix of ["72", "73", "78", "79"]) {
      expect(normaliseRwandanPhone(`0${prefix}8123456`)).toBe(`+250${prefix}8123456`);
    }
  });

  it("rejects a landline prefix", () => {
    expect(() => normaliseRwandanPhone("0252123456")).toThrow("invalid Rwandan mobile number");
  });

  it("rejects a number that is too short", () => {
    expect(() => normaliseRwandanPhone("078812345")).toThrow("invalid Rwandan mobile number");
  });

  it("rejects a foreign number", () => {
    expect(() => normaliseRwandanPhone("+447700900123")).toThrow(
      "invalid Rwandan mobile number",
    );
  });

  it("rejects empty input", () => {
    expect(() => normaliseRwandanPhone("")).toThrow("invalid Rwandan mobile number");
  });
});
