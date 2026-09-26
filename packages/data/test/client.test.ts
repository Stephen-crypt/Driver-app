import { describe, it, expect } from "vitest";
import { friendlyError } from "../src/client";

describe("friendlyError", () => {
  it("never shows a database message to a rider or passenger", () => {
    expect(friendlyError('new row violates row-level security policy for table "trips"')).toBe("This account can't do that.");
    expect(friendlyError("TypeError: Failed to fetch")).toMatch(/No connection/);
    expect(friendlyError("JWT expired")).toMatch(/signed out/);
    expect(friendlyError('relation "public.x" does not exist')).toMatch(/on our side/);
  });

  it("keeps our own codes so each screen can word them", () => {
    expect(friendlyError("too_soon")).toBe("too_soon");
    expect(friendlyError("grace_not_elapsed: 120 seconds left")).toBe("grace_not_elapsed: 120 seconds left");
  });
});
