import { useCallback, useEffect, useRef, useState } from "react";
import { listMessages, markMessagesRead, sendMessage, unreadCount, watchMessages, type TripMessage } from "@nova/data";
import type { ChatLine } from "@nova/kit";
import { supabase } from "./supabase";

/**
 * The thread for one live trip. Realtime carries new messages; a slow poll
 * behind it keeps the thread honest on a connection that drops the socket.
 */
export function useTripChat(tripId: string | null, meId: string | null, live: boolean) {
  const [messages, setMessages] = useState<TripMessage[]>([]);
  const [sending, setSending] = useState(false);
  // The trip whose thread is open, or null. A read that comes back after the
  // trip has ended, or after a switch to another trip, is dropped.
  const open = useRef<string | null>(null);

  const load = useCallback(async () => {
    const id = open.current;
    if (!id) return;
    try {
      const rows = await listMessages(supabase, id);
      if (open.current === id) setMessages(rows);
    } catch {
      // A dropped read keeps the last thread on screen.
    }
  }, []);

  useEffect(() => {
    setMessages([]);
    if (!tripId || !live) return;
    open.current = tripId;
    void load();
    const watch = watchMessages(supabase, tripId, () => void load());
    const poll = setInterval(() => void load(), 12_000);
    return () => {
      open.current = null;
      watch.unsubscribe();
      clearInterval(poll);
    };
  }, [tripId, live, load]);

  const send = useCallback(
    async (text: string) => {
      if (!tripId || !meId) return;
      setSending(true);
      try {
        await sendMessage(supabase, tripId, meId, text);
        await load();
      } finally {
        setSending(false);
      }
    },
    [tripId, meId, load],
  );

  const unread = meId ? unreadCount(messages, meId) : 0;

  const markRead = useCallback(async () => {
    if (!tripId || !meId || unread === 0) return;
    try {
      await markMessagesRead(supabase, tripId, meId);
      await load();
    } catch {
      // Unread is a hint, not a record; a failed mark clears next time.
    }
  }, [tripId, meId, unread, load]);

  const lines: ChatLine[] = messages.map((m) => ({ id: m.id, body: m.body, mine: m.senderId === meId, at: m.createdAt, read: m.readAt !== null }));

  return { lines, unread, send, sending, markRead };
}
