import type { NovaClient } from "./client";
import { dataError } from "./client";

/** What a passenger can report. Vehicle faults are the rider app's. */
export type PassengerCaseKind = "lost_property" | "complaint" | "incident" | "other";
export type CaseStatus = "open" | "in_progress" | "resolved";

export const PASSENGER_CASE_KINDS: readonly { kind: PassengerCaseKind; label: string; hint: string; prompt: string }[] = [
  {
    kind: "lost_property",
    label: "I left something behind",
    hint: "A phone, a bag, keys",
    prompt: "What did you leave, and where in the vehicle? Describe it so the rider can recognise it.",
  },
  {
    kind: "complaint",
    label: "A problem with my trip",
    hint: "The price, the route, how the rider behaved",
    prompt: "What happened? Include anything the rider said.",
  },
  {
    kind: "incident",
    label: "I didn't feel safe",
    hint: "Dangerous riding, a threat, an accident",
    prompt: "Tell us what happened and where. If you are in danger now, call 112.",
  },
  { kind: "other", label: "Something else", hint: "Anything we should know", prompt: "Tell us what happened." },
];

export interface MyCase {
  readonly id: string;
  readonly number: number;
  readonly kind: string;
  readonly category: string | null;
  readonly status: CaseStatus;
  readonly description: string;
  readonly resolution: string | null;
  readonly tripId: string | null;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
}

interface CaseRow {
  id: string;
  number: number;
  kind: string;
  category: string | null;
  status: CaseStatus;
  description: string;
  resolution: string | null;
  trip_id: string | null;
  created_at: string;
  resolved_at: string | null;
}

const toCase = (r: CaseRow): MyCase => ({
  id: r.id,
  number: r.number,
  kind: r.kind,
  category: r.category,
  status: r.status,
  description: r.description,
  resolution: r.resolution,
  tripId: r.trip_id,
  createdAt: r.created_at,
  resolvedAt: r.resolved_at,
});

export async function openCase(
  client: NovaClient,
  kind: PassengerCaseKind,
  tripId: string | null,
  description: string,
): Promise<MyCase> {
  const { data, error } = await client.rpc("open_case", { p_kind: kind, p_trip_id: tripId, p_description: description });
  if (error) throw new Error(caseError(error.message));
  return toCase(data as CaseRow);
}

/** The signed-in person's own reports; RLS returns nothing else. */
export async function listMyCases(client: NovaClient, userId: string, limit = 30): Promise<MyCase[]> {
  const { data, error } = await client
    .from("support_cases")
    .select("id, number, kind, category, status, description, resolution, trip_id, created_at, resolved_at")
    .eq("reported_by", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw dataError(error.message);
  return ((data ?? []) as CaseRow[]).map(toCase);
}

const KIND_TITLE: Record<string, string> = {
  lost_property: "Lost property",
  complaint: "Trip problem",
  incident: "Safety",
  vehicle: "Vehicle",
  other: "Report",
  vehicle_problem: "Vehicle problem",
  safety_issue: "Safety issue",
  accident: "Accident",
};

export function caseTitle(c: Pick<MyCase, "kind" | "category">): string {
  return KIND_TITLE[c.category ?? ""] ?? KIND_TITLE[c.kind] ?? "Report";
}

export function caseStatusLabel(s: CaseStatus): string {
  return s === "open" ? "Received" : s === "in_progress" ? "Someone is on it" : "Resolved";
}

const WORDS: Record<string, string> = {
  describe_it: "Tell us a little more - a sentence or two.",
  too_many_reports: "You've sent a lot of reports today. Call us if it's urgent.",
  not_your_trip: "That trip isn't on your account.",
};

export function caseError(message: string): string {
  for (const [code, words] of Object.entries(WORDS)) if (message.includes(code)) return words;
  return "Couldn't send that. Check your connection and try again.";
}
