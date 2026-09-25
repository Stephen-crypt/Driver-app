import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export interface Session {
  /** null while the stored session is still being read. */
  readonly signedIn: boolean | null;
  readonly userId: string | null;
}

/** The signed-in passenger, kept current as the session changes. */
export function useSession(): Session {
  const [session, setSession] = useState<Session>({ signedIn: null, userId: null });

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession({ signedIn: data.session !== null, userId: data.session?.user.id ?? null });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (!active) return;
      setSession({ signedIn: s !== null, userId: s?.user.id ?? null });
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return session;
}
