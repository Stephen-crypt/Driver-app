import { describe, expect, it, vi } from "vitest";
import { countUnread, markInboxRead, toInboxItem } from "../src/inbox";
import type { NovaClient } from "../src/client";

describe("toInboxItem", () => {
  it("reads the trip from the push data and the read state from read_at", () => {
    const item = toInboxItem({
      id: 7,
      title: "Trip complete",
      body: "Pay 1700 RWF in cash.",
      kind: "trip",
      data: { kind: "trip", tripId: "t1", state: "completed" },
      created_at: "2026-09-30T10:00:00Z",
      read_at: null,
    });
    expect(item).toEqual({ id: 7, title: "Trip complete", body: "Pay 1700 RWF in cash.", kind: "trip", tripId: "t1", at: "2026-09-30T10:00:00Z", read: false });
  });

  it("has no trip when the notification is not about one", () => {
    expect(toInboxItem({ id: 1, title: "x", body: "y", kind: "case", data: {}, created_at: "", read_at: "2026-09-30" }).tripId).toBeNull();
  });
});

describe("countUnread", () => {
  it("counts only the unread, without fetching rows", async () => {
    const is = vi.fn().mockResolvedValue({ count: 3, error: null });
    const select = vi.fn(() => ({ is }));
    const client = { from: () => ({ select }) } as unknown as NovaClient;
    expect(await countUnread(client)).toBe(3);
    expect(select).toHaveBeenCalledWith("id", { count: "exact", head: true });
    expect(is).toHaveBeenCalledWith("read_at", null);
  });
});

describe("markInboxRead", () => {
  it("only touches what is still unread", async () => {
    const is = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ is }));
    const client = { from: () => ({ update }) } as unknown as NovaClient;
    await markInboxRead(client);
    expect(is).toHaveBeenCalledWith("read_at", null);
    expect(Object.keys((update.mock.calls[0] as unknown as [Record<string, unknown>])[0])).toEqual(["read_at"]);
  });
});
