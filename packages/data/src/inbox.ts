import type { NovaClient } from "./client";
import { dataError } from "./client";

export interface InboxItem {
  readonly id: number;
  readonly title: string;
  readonly body: string;
  /** "trip", "message", "case", "rider_changed". */
  readonly kind: string;
  /** The trip it is about, when it is about one. */
  readonly tripId: string | null;
  readonly at: string;
  readonly read: boolean;
}

interface Row {
  id: number;
  title: string;
  body: string;
  kind: string;
  data: Record<string, unknown> | null;
  created_at: string;
  read_at: string | null;
}

export function toInboxItem(r: Row): InboxItem {
  const trip = r.data?.tripId;
  return {
    id: Number(r.id),
    title: r.title,
    body: r.body,
    kind: r.kind,
    tripId: typeof trip === "string" ? trip : null,
    at: r.created_at,
    read: r.read_at !== null,
  };
}

/** The caller's own notifications, newest first. RLS limits it to them. */
export async function listInbox(client: NovaClient, limit = 60): Promise<InboxItem[]> {
  const { data, error } = await client
    .from("notifications")
    .select("id, title, body, kind, data, created_at, read_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw dataError(error.message);
  return ((data ?? []) as Row[]).map(toInboxItem);
}

/** How many are unread: the number on the bell. */
export async function countUnread(client: NovaClient): Promise<number> {
  const { count, error } = await client.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null);
  if (error) throw dataError(error.message);
  return count ?? 0;
}

/** Everything read, once the inbox has been opened and seen. */
export async function markInboxRead(client: NovaClient): Promise<void> {
  const { error } = await client.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
  if (error) throw dataError(error.message);
}

/** Calls back when a notification for this person lands. */
export function watchInbox(client: NovaClient, userId: string, onChange: () => void): { unsubscribe: () => void } {
  const channel = client
    .channel(`inbox:${userId}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, () => onChange())
    .subscribe();
  return { unsubscribe: () => void client.removeChannel(channel) };
}
