import type { GeraClient } from "./client";
import { dataError } from "./client";

/** Same keys, same order, as public.inspection_items(). */
export const INSPECTION_ITEMS = [
  { key: "identity", label: "Rider matches the name on their ID", group: "rider" },
  { key: "documents", label: "Driving licence and national ID on them", group: "rider" },
  { key: "vest", label: "Wearing the Gera vest, number visible", group: "rider" },
  { key: "helmets", label: "Own helmet, and a clean one for the passenger", group: "rider" },
  { key: "brakes", label: "Brakes", group: "vehicle" },
  { key: "lights", label: "Lights and indicators", group: "vehicle" },
  { key: "tyres", label: "Tyres", group: "vehicle" },
  { key: "mirrors", label: "Mirrors", group: "vehicle" },
  { key: "bodywork", label: "No new damage", group: "vehicle" },
  { key: "safety_kit", label: "Safety kit present", group: "vehicle" },
] as const;

export type InspectionItem = (typeof INSPECTION_ITEMS)[number]["key"];
export type CheckValue = "pass" | "fail" | "na";
export type AlcoholResult = "negative" | "positive" | "refused";
export type InspectionResult = "pass" | "advisory" | "fail";

export interface LookupResult {
  readonly scanned: "rider" | "vehicle";
  readonly rider: { id: string; name: string; verification: string; onShift: boolean; shiftStartedAt: string | null } | null;
  readonly vehicle: { id: string; plate: string; class: string; vest: string | null; active: boolean } | null;
  readonly lastInspection: { at: string; result: InspectionResult; inspector: string | null } | null;
}

interface LookupRow {
  scanned: "rider" | "vehicle";
  rider: { id: string; name: string; verification: string; on_shift: boolean; shift_started_at: string | null } | null;
  vehicle: LookupResult["vehicle"];
  last_inspection: LookupResult["lastInspection"];
}

export async function inspectLookup(client: GeraClient, code: string): Promise<LookupResult> {
  const { data, error } = await client.rpc("inspect_lookup", { p_code: code.trim() });
  if (error) throw new Error(inspectError(error.message));
  const r = data as LookupRow;
  return {
    scanned: r.scanned,
    rider: r.rider
      ? { id: r.rider.id, name: r.rider.name, verification: r.rider.verification, onShift: r.rider.on_shift, shiftStartedAt: r.rider.shift_started_at }
      : null,
    vehicle: r.vehicle,
    lastInspection: r.last_inspection,
  };
}

/** The result a set of checks allows at best. The inspector can go stricter. */
export function bestResultFor(checks: Partial<Record<InspectionItem, CheckValue>>, alcohol: AlcoholResult | null): InspectionResult {
  if (alcohol === "positive" || alcohol === "refused") return "fail";
  return Object.values(checks).includes("fail") ? "fail" : "pass";
}

export interface InspectionInput {
  readonly riderId: string | null;
  readonly vehicleId: string | null;
  readonly kind: "routine" | "random";
  readonly checks: Partial<Record<InspectionItem, CheckValue>>;
  readonly alcohol: { result: AlcoholResult; reading: number | null; device: string } | null;
  readonly result: InspectionResult;
  readonly notes: string;
  readonly photos: readonly string[];
  readonly at: { lat: number; lng: number } | null;
}

export async function recordInspection(client: GeraClient, i: InspectionInput): Promise<{ id: string; caseNumber: number | null }> {
  const { data, error } = await client.rpc("record_inspection", {
    p_rider_id: i.riderId,
    p_vehicle_id: i.vehicleId,
    p_kind: i.kind,
    p_checks: i.checks,
    p_alcohol_result: i.alcohol?.result ?? null,
    p_alcohol_reading: i.alcohol?.reading ?? null,
    p_alcohol_device: i.alcohol?.device ?? null,
    p_result: i.result,
    p_notes: i.notes,
    p_photos: i.photos,
    p_lng: i.at?.lng ?? null,
    p_lat: i.at?.lat ?? null,
  });
  if (error) throw new Error(inspectError(error.message));
  const r = data as { id: string; case_number: number | null };
  return { id: r.id, caseNumber: r.case_number };
}

export async function uploadInspectionPhoto(
  client: GeraClient,
  inspectorId: string,
  file: { uri: string; mimeType: string; extension: string },
): Promise<string> {
  const path = `${inspectorId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${file.extension}`;
  const body = await (await fetch(file.uri)).arrayBuffer();
  const { error } = await client.storage.from("inspection-photos").upload(path, body, { contentType: file.mimeType });
  if (error) throw new Error("Couldn't upload the photo. Check your connection.");
  return path;
}

export async function myRiderQr(client: GeraClient): Promise<string | null> {
  const { data, error } = await client.rpc("my_rider_qr");
  if (error) throw dataError(error.message);
  return (data as string | null) ?? null;
}

/** The staff role of whoever is signed in, or null for everyone else. */
export async function myStaffRole(client: GeraClient): Promise<{ role: string; name: string } | null> {
  const { data, error } = await client.rpc("my_staff");
  if (error) return null;
  const row = (data as { role: string; display_name: string }[] | null)?.[0];
  return row ? { role: row.role, name: row.display_name } : null;
}

const WORDS: Record<string, string> = {
  not_found: "Nobody matches that code. Check the vest number or plate, or scan again.",
  not_permitted: "This account can't do inspections.",
  result_contradicts_checks: "Something failed, so the result can't be a pass.",
  reading_required: "Enter the reading from the breathalyser.",
  nothing_to_inspect: "Scan a rider or a vehicle first.",
};

export function inspectError(message: string): string {
  for (const [code, words] of Object.entries(WORDS)) if (message.includes(code)) return words;
  return "That didn't go through. Check your connection and try again.";
}
