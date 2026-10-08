import { createClient, type Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

export type StaffRole = "admin" | "operations" | "control_room" | "fleet" | "safety" | "support" | "finance" | "inspector";

export interface Staff {
  readonly role: StaffRole;
  readonly name: string;
  readonly email: string;
}

/**
 * The signed-in person and their staff role, or null. The role is read from
 * the database on every load - the dashboard never trusts a role it cached,
 * because a disabled account must lose access on its next page, not next week.
 */
export function useStaff(): { loading: boolean; session: Session | null; staff: Staff | null } {
  const [session, setSession] = useState<Session | null>(null);
  const [staff, setStaff] = useState<Staff | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const read = async (s: Session | null) => {
      setSession(s);
      if (!s) {
        setStaff(null);
        setLoading(false);
        return;
      }
      const { data } = await supabase.rpc("my_staff");
      if (!active) return;
      const row = (data as { role: StaffRole; display_name: string }[] | null)?.[0];
      setStaff(row ? { role: row.role, name: row.display_name, email: s.user.email ?? "" } : null);
      setLoading(false);
    };
    supabase.auth.getSession().then(({ data }) => read(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => void read(s));
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { loading, session, staff };
}

/** Calls a staff function and turns the database's refusal into plain words. */
export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(explain(error.message));
  return data as T;
}

const WORDS: Record<string, string> = {
  not_permitted: "Your role can't do that.",
  resolution_required: "Say what happened and what was done before closing it.",
  reason_required: "Give a reason - the rider sees it.",
  vehicle_on_shift: "That vehicle is out on a shift. It can be moved once the shift ends.",
  rider_on_shift: "That rider is on a shift. Assign a vehicle once it ends.",
  plate_exists: "A vehicle with that plate is already in the fleet.",
  plate_required: "Enter the plate.",
  only_bonus_or_deduction: "Only bonuses and deductions can be added here.",
  not_all_documents_approved: "Every document has to be approved before the rider can be verified.",
  commission_out_of_range: "Nova's share has to be between 0 and 90%.",
  cannot_backdate: "A price can't start in the past - trips already quoted keep their price.",
  negative_price: "Prices can't be negative.",
  out_of_range: "That value is outside what Nova can safely run with.",
  bad_value: "Enter a whole number.",
  describe_it: "Say what happened - a few words at least.",
  case_not_found_or_resolved: "That case is already resolved.",
  rider_cannot_take_this: "That rider isn't approved, or doesn't have a vehicle of this class.",
  ride_already_assigned: "A rider already has this ride. Cancel it to change who takes it.",
  zone_crosses_itself: "The shape crosses itself. Place the corners in order around the edge.",
  zone_needs_points: "Place at least three corners on the map.",
  zone_too_large: "That zone is bigger than Kigali - check the corners.",
  name_required: "Give it a name.",
  promo_code_taken: "There is already a code like that. Passengers type codes without spaces or dashes, so pick another.",
  invalid_promo: "Check the discount, the dates and the number of codes.",
  promo_not_found: "That code no longer exists.",
  alert_not_found_or_reviewed: "Someone already reviewed that alert.",
};

export function explain(message: string): string {
  for (const [code, words] of Object.entries(WORDS)) if (message.includes(code)) return words;
  return message;
}

export const can = (role: StaffRole | undefined, ...roles: StaffRole[]) =>
  role === "admin" || (role !== undefined && roles.includes(role));

export const money = (n: number | null | undefined) => (n ?? 0).toLocaleString("en-US");

export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "-";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function kigaliTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Kigali" });
}

export function kigaliDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Kigali",
  });
}

export function usePoll(fn: () => void | Promise<void>, ms: number, deps: unknown[] = []) {
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (alive) await fn();
    };
    void tick();
    const id = setInterval(tick, ms);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
