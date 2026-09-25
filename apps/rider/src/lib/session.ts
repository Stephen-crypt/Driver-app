import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export interface Session {
  /** null while the stored session is still being read. */
  readonly signedIn: boolean | null;
  readonly riderId: string | null;
}

/** The signed-in rider, kept current as the session changes. */
export function useSession(): Session {
  const [session, setSession] = useState<Session>({ signedIn: null, riderId: null });

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession({ signedIn: data.session !== null, riderId: data.session?.user.id ?? null });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (!active) return;
      setSession({ signedIn: s !== null, riderId: s?.user.id ?? null });
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return session;
}
