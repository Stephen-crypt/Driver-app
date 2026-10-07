// Place search and "where am I" for Kigali, from Geoapify (OpenStreetMap data).
// Everything here is pure - URLs in, parsed answers out - so it is tested
// without the network; index.ts does the fetching.

export interface Point {
  lat: number;
  lng: number;
}

/** A searched place, ready for a results row. */
export interface Found {
  id: string;
  name: string;
  /** The second line: its street and area. */
  detail: string | null;
  lat: number;
  lng: number;
}

const BASE = "https://api.geoapify.com/v1/geocode";
const KIGALI: Point = { lat: -1.9441, lng: 30.0619 };
// Nova rides inside Kigali. Without a fence, "Remera" answers with five
// villages across the country and "Serena" with the hotel in Gisenyi.
const FENCE_M = 35_000;

const SUFFIX: Record<string, string> = {
  av: "Avenue",
  ave: "Avenue",
  avenue: "Avenue",
  rd: "Road",
  road: "Road",
  st: "Street",
  str: "Street",
  street: "Street",
};

/**
 * Kigali's coded streets as OpenStreetMap names them: "kg7 ave" becomes
 * "KG 7 Avenue". Unabbreviated, the geocoder reads a bare number as a house
 * number and answers "kg 7 av" with "7 KG 645 Street".
 */
export function normaliseQuery(text: string): { text: string; street: boolean } {
  const t = text.trim().replace(/\s+/g, " ");
  const m = /^(k[ngk])\s*(\d{1,4})\s*([a-z]*)\.?$/i.exec(t);
  if (!m) return { text: t, street: false };
  const code = `${m[1]!.toUpperCase()} ${m[2]}`;
  const suffix = SUFFIX[m[3]!.toLowerCase()];
  return { text: suffix ? `${code} ${suffix}` : code, street: true };
}

export function searchUrl(key: string, text: string, near: Point | null): string {
  const q = normaliseQuery(text);
  const bias = near ?? KIGALI;
  const params = new URLSearchParams({
    text: q.text,
    filter: `circle:${KIGALI.lng},${KIGALI.lat},${FENCE_M}`,
    bias: `proximity:${bias.lng},${bias.lat}`,
    format: "json",
    lang: "en",
    limit: "8",
    apiKey: key,
  });
  if (q.street) params.set("type", "street");
  return `${BASE}/autocomplete?${params}`;
}

interface Result {
  place_id?: string;
  name?: string;
  result_type?: string;
  address_line1?: string;
  address_line2?: string;
  street?: string;
  suburb?: string;
  district?: string;
  lat?: number;
  lon?: number;
  distance?: number;
}

const tidy = (s: string | undefined) =>
  (s ?? "")
    .replace(/,?\s*Rwanda$/, "")
    .replace(/City of Kigali/g, "Kigali")
    .trim() || null;

/** Metres between two points, near enough for "is this the same place". */
function metres(a: Point, b: Point): number {
  const r = Math.PI / 180;
  const x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r);
  const y = (b.lat - a.lat) * r;
  return Math.sqrt(x * x + y * y) * 6_371_000;
}

/**
 * Results worth a row. A building with no name is somebody's house number;
 * a whole province is not somewhere to be dropped. The same place mapped
 * twice - Kigali Heights is in OSM three times - shows once.
 */
export function parseSearch(data: unknown): Found[] {
  const results = ((data as { results?: Result[] } | null)?.results ?? []);
  const out: Found[] = [];
  for (const r of results) {
    if (typeof r.lat !== "number" || typeof r.lon !== "number" || !r.place_id) continue;
    if (r.result_type === "country" || r.result_type === "state" || r.result_type === "county" || r.result_type === "postcode") continue;
    if (r.result_type === "building" && !r.name) continue;
    const name = (r.address_line1 ?? r.name ?? "").trim();
    if (!name) continue;
    const at = { lat: r.lat, lng: r.lon };
    const twin = out.some((o) => o.name.toLowerCase() === name.toLowerCase() && metres(o, at) < 400);
    if (twin) continue;
    out.push({ id: r.place_id, name, detail: tidy(r.address_line2), lat: at.lat, lng: at.lng });
  }
  return out;
}

export function reverseUrl(key: string, at: Point): string {
  const params = new URLSearchParams({ lat: String(at.lat), lon: String(at.lng), format: "json", lang: "en", apiKey: key });
  return `${BASE}/reverse?${params}`;
}

/**
 * How to name where someone is standing: a named place right beside them,
 * else the street and area, else just the area. Null when there is nothing
 * better than "Current location".
 */
export function parseReverse(data: unknown): string | null {
  const r = (data as { results?: Result[] } | null)?.results?.[0];
  if (!r) return null;
  const close = typeof r.distance !== "number" || r.distance <= 150;
  if (r.result_type === "amenity" && r.name && close) return `Near ${r.name}`;
  const area = r.suburb ?? r.district?.replace(/ District$/, "") ?? null;
  if (r.street) return area ? `${r.street}, ${area}` : r.street;
  return area;
}
