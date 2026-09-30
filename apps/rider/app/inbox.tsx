import { useCallback, useEffect, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { EmptyState, NotificationList, Screen, SkeletonRows, Txt, space, type Notice } from "@nova/kit";
import { listInbox, markInboxRead, watchInbox, type InboxItem } from "@nova/data";
import { supabase } from "../src/lib/supabase";
import { useSession } from "../src/lib/session";
import { goBack } from "../src/lib/nav";
import { useLightStatusBar } from "../src/lib/statusBar";

/**
 * Everything Nova has told this rider, newest first: trips, messages from
 * passengers, the fleet office's answers. Offers are not here - they last
 * fifteen seconds, and a list of expired ones would only be trips someone
 * else took.
 */
export default function Inbox() {
  const router = useRouter();
  useLightStatusBar();
  const { riderId } = useSession();
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
    if (!riderId) return;
    const w = watchInbox(supabase, riderId, load);
    return () => w.unsubscribe();
  }, [riderId, load]);

  const unread = (items ?? []).filter((n) => !n.read).length;

  const open = (n: Notice) => {
    const item = items?.find((x) => x.id === n.id);
    if (!item) return;
    if (item.kind === "case") router.push("/reports");
    else if (item.tripId) router.navigate("/trips");
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
          body="Trip updates, messages from passengers and answers from the fleet office show up here."
        />
      ) : (
        <NotificationList items={items} onOpen={open} />
      )}
    </Screen>
  );
}
