import { describe, it, expect } from "vitest";
import pkg from "../package.json" with { type: "json" };

describe("@gera/core packaging", () => {
  it("has zero runtime dependencies", () => {
    expect(pkg.dependencies ?? {}).toEqual({});
  });

  it("has zero peer dependencies", () => {
    expect((pkg as Record<string, unknown>).peerDependencies ?? {}).toEqual({});
  });
});
