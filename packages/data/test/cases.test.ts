import { describe, it, expect, vi } from "vitest";
import { caseStatusLabel, caseTitle, openCase } from "../src/cases";
import type { NovaClient } from "../src/client";

const rpcClient = (result: { data?: unknown; error?: { message: string } | null }) => {
  const rpc = vi.fn(() => Promise.resolve({ data: result.data ?? null, error: result.error ?? null }));
  return { client: { rpc } as unknown as NovaClient, rpc };
};

describe("openCase", () => {
  it("returns the case with the number the passenger can quote", async () => {
    const { client, rpc } = rpcClient({
      data: { id: "c1", number: 1004, kind: "lost_property", category: null, status: "open", description: "Black phone",
              resolution: null, trip_id: "t1", created_at: "2026-09-26T08:00:00Z", resolved_at: null },
    });
    const c = await openCase(client, "lost_property", "t1", "Black phone on the seat");
    expect(c.number).toBe(1004);
    expect(rpc).toHaveBeenCalledWith("open_case", { p_kind: "lost_property", p_trip_id: "t1", p_description: "Black phone on the seat" });
  });

  it("turns the database's refusal into words", async () => {
    const { client } = rpcClient({ error: { message: "describe_it" } });
    await expect(openCase(client, "other", null, "hi")).rejects.toThrow(/a sentence or two/);
  });

  it("never shows a raw database error", async () => {
    const { client } = rpcClient({ error: { message: "permission denied for relation x" } });
    await expect(openCase(client, "other", null, "hello there")).rejects.toThrow(/Couldn't send that/);
  });
});

describe("case labels", () => {
  it("names a rider's report by what it was, not the queue it went to", () => {
    expect(caseTitle({ kind: "incident", category: "accident" })).toBe("Accident");
    expect(caseTitle({ kind: "lost_property", category: null })).toBe("Lost property");
  });

  it("describes status from the reporter's side", () => {
    expect(caseStatusLabel("in_progress")).toBe("Someone is on it");
  });
});
