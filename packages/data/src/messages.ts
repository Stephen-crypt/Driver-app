import type { NovaClient } from "./client";
import { dataError } from "./client";

/**
 * Messages between the passenger and the rider of one trip. A thread is open
 * only while the trip is live; the database refuses anything after.
 */
export interface TripMessage {
  readonly id: number;
  readonly tripId: string;
  readonly senderId: string;
  readonly body: string;
  readonly createdAt: string;
  readonly readAt: string | null;
}

/**
 * What each side most often needs to say, one tap each. A rider on a moving
 * bike cannot type; a passenger at a crowded gate should not have to.
 */
export const QUICK_REPLIES = {
  passenger: ["I'm coming out now", "I'm at the gate", "Give me 2 minutes", "Please call me"],
  rider: ["I'm on my way", "I'm outside", "2 minutes away", "I can't find it, please call"],
} as const;

interface Row {
  id: number;
  trip_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
}

const toMessage = (r: Row): TripMessage => ({
  id: r.id,
  tripId: r.trip_id,
  senderId: r.sender_id,
  body: r.body,
  createdAt: r.created_at,
  readAt: r.read_at,
});

export async function listMessages(client: NovaClient, tripId: string): Promise<TripMessage[]> {
  const { data, error } = await client
    .from("trip_messages")
    .select("id, trip_id, sender_id, body, created_at, read_at")
    .eq("trip_id", tripId)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) throw dataError(error.message);
  return ((data ?? []) as Row[]).map(toMessage);
}

/** Sends one message. Whitespace is trimmed; an empty message is not sent. */
export async function sendMessage(client: NovaClient, tripId: string, senderId: string, body: string): Promise<void> {
  const text = body.trim();
  if (!text) return;
  const { error } = await client.from("trip_messages").insert({ trip_id: tripId, sender_id: senderId, body: text.slice(0, 500) });
  if (error) throw dataError(error.message);
}

/** Marks everything the other person wrote as read. */
export async function markMessagesRead(client: NovaClient, tripId: string, meId: string): Promise<void> {
  const { error } = await client
    .from("trip_messages")
    .update({ read_at: new Date().toISOString() })
    .eq("trip_id", tripId)
    .neq("sender_id", meId)
    .is("read_at", null);
  if (error) throw dataError(error.message);
}

/** Messages from the other person that this person has not read. */
export function unreadCount(messages: readonly TripMessage[], meId: string): number {
  return messages.filter((m) => m.senderId !== meId && m.readAt === null).length;
}

/**
 * Called whenever the thread changes. Realtime carries the event; the caller
 * re-reads the thread rather than trusting the payload, which keeps the row
 * shape in one place.
 */
export function watchMessages(client: NovaClient, tripId: string, onChange: () => void): { unsubscribe: () => void } {
  const channel = client
    .channel(`messages:${tripId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "trip_messages", filter: `trip_id=eq.${tripId}` }, () => onChange())
    .subscribe();
  return { unsubscribe: () => void client.removeChannel(channel) };
}
