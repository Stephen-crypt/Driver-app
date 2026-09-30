import { useCallback, useEffect, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { EmptyState, NotificationList, Screen, SkeletonRows, Txt, space, type Notice } from "@nova/kit";
import { listInbox, markInboxRead, watchInbox, type InboxItem } from "@nova/data";
import { supabase } from "../src/lib/supabase";
import { useSession } from "../src/lib/session";
import { goBack } from "../src/lib/nav";
import { useLightStatusBar } from "../src/lib/statusBar";

/**
 * Everything Nova has told this passenger, newest first. Opening the list
 * marks it read, but the dots stay for this visit so what was new is still
 * visible.
 */
export default function Inbox() {
  const router = useRouter();
  useLightStatusBar();
  const { userId } = useSession();
  const [items, setItems] = useState<InboxItem[] | null>(null);

  const load = useCallback(() => {
    listInbox(supabase)
      .then(setItems)
      .catch(() => setItems((prev) => prev ?? []));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      const t = setTimeout(() => void markInboxRead(supabase).catch(() => {}), 1200);
      return () => clearTimeout(t);
    }, [load]),
  );

  useEffect(() => {
    if (!userId) return;
    const w = watchInbox(supabase, userId, load);
    return () => w.unsubscribe();
  }, [userId, load]);

  const unread = (items ?? []).filter((n) => !n.read).length;

  // A message opens the trip, where the thread is; anything else about a trip
  // opens its page.
  const open = (n: Notice) => {
    const item = items?.find((x) => x.id === n.id);
    if (!item?.tripId) return;
    if (item.kind === "message") router.push({ pathname: "/ride", params: { trip: item.tripId } });
    else router.push({ pathname: "/trip/[id]", params: { id: item.tripId } });
  };

  return (
    <Screen
      title="Notifications"
      brand
      onBack={() => goBack(router)}
      gap={space.lg}
      hero={
        items && items.length > 0 ? (
          <Txt v="body" tone="onHeroMuted">
            {unread > 0 ? `${unread} new since you last looked` : "You're all caught up"}
          </Txt>
        ) : undefined
      }
    >
      {items === null ? (
        <SkeletonRows count={5} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="notifications-outline"
          title="Nothing yet"
          body="Trip updates, messages from your rider and answers to your reports show up here."
        />
      ) : (
        <NotificationList items={items} onOpen={open} />
      )}
    </Screen>
  );
}
