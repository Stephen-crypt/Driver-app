import { describe, it, expect, vi } from "vitest";
import { QUICK_REPLIES, sendMessage, unreadCount, type TripMessage } from "../src/messages";
import type { NovaClient } from "../src/client";

const msg = (over: Partial<TripMessage>): TripMessage => ({
  id: 1,
  tripId: "t",
  senderId: "them",
  body: "hi",
  createdAt: "2026-09-30T08:00:00Z",
  readAt: null,
  ...over,
});

describe("unreadCount", () => {
  it("counts only the other person's unread messages", () => {
    const all = [
      msg({ id: 1, senderId: "them" }),
      msg({ id: 2, senderId: "them", readAt: "2026-09-30T08:01:00Z" }),
      msg({ id: 3, senderId: "me" }),
    ];
    expect(unreadCount(all, "me")).toBe(1);
  });

  it("is zero for an empty thread", () => {
    expect(unreadCount([], "me")).toBe(0);
  });
});

describe("sendMessage", () => {
  const clientWith = (insert: ReturnType<typeof vi.fn>) =>
    ({ from: () => ({ insert }) }) as unknown as NovaClient;

  it("trims and sends", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    await sendMessage(clientWith(insert), "t", "me", "  I'm at the gate  ");
    expect(insert).toHaveBeenCalledWith({ trip_id: "t", sender_id: "me", body: "I'm at the gate" });
  });

  it("does not send an empty message", async () => {
    const insert = vi.fn();
    await sendMessage(clientWith(insert), "t", "me", "   ");
    expect(insert).not.toHaveBeenCalled();
  });

  it("cuts a message to the database limit rather than failing it", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    await sendMessage(clientWith(insert), "t", "me", "x".repeat(600));
    expect(insert.mock.calls[0]?.[0].body).toHaveLength(500);
  });

  it("surfaces a refused write as an error", async () => {
    const insert = vi.fn().mockResolvedValue({ error: { message: "new row violates row-level security policy" } });
    await expect(sendMessage(clientWith(insert), "t", "me", "hello")).rejects.toThrow();
  });
});

describe("QUICK_REPLIES", () => {
  it("gives each side a short, distinct set", () => {
    expect(QUICK_REPLIES.passenger.length).toBeGreaterThanOrEqual(3);
    expect(QUICK_REPLIES.rider.length).toBeGreaterThanOrEqual(3);
    for (const r of [...QUICK_REPLIES.passenger, ...QUICK_REPLIES.rider]) expect(r.length).toBeLessThanOrEqual(40);
  });
});
