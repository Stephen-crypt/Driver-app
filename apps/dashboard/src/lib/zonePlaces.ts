import { rpc } from "./supabase";

/** [lat, lng]: how the Zones page and LiveMap hold corners. The server speaks [lng, lat]. */
export type LatLng = [number, number];
type LngLat = [number, number];

const toPage = (pts: readonly LngLat[] | null): LatLng[] => (pts ?? []).map(([lng, lat]) => [lat, lng]);
const toServer = (pts: readonly LatLng[]): LngLat[] => pts.map(([lat, lng]) => [lng, lat]);

export type PlaceKind = "sector" | "cell" | "site" | "landmark" | "place";

export interface FoundPlace {
  readonly ref: string;
  readonly kind: PlaceKind;
  readonly name: string;
  readonly detail: string;
  readonly lng: number;
  readonly lat: number;
}

/** Sectors, cells, sites and point places whose names match, best first. */
export const findPlaces = (query: string) => rpc<FoundPlace[]>("staff_find_places", { p_query: query });

/** A picked place's shape: a border, a site grown by a margin, or a circle. */
export const placeShape = async (ref: string, size: number | null): Promise<LatLng[]> =>
  toPage(await rpc<LngLat[] | null>("staff_place_shape", { p_ref: ref, p_metres: size }));

export interface RoadStrip {
  /** Empty until there are two clicks. */
  readonly corners: LatLng[];
  /** The clicks, snapped onto their roads. */
  readonly clicks: LatLng[];
  readonly name: string | null;
}

export const roadStrip = async (clicks: readonly LatLng[], width: number): Promise<RoadStrip> => {
  const r = await rpc<{ corners: LngLat[] | null; clicks: LngLat[]; name: string | null }>("staff_road_strip", {
    p_clicks: toServer(clicks),
    p_width: width,
  });
  return { corners: toPage(r.corners), clicks: toPage(r.clicks), name: r.name };
};

/** A name for a shape drawn by hand, from the site, cell or sector it sits in. */
export const suggestName = (corners: readonly LatLng[]) => rpc<string | null>("staff_suggest_zone_name", { p_points: toServer(corners) });

export interface SizeRange {
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly start: number;
}

/** The slider each kind of place gets: a site's margin, a point's circle; borders are fixed. */
export const SIZE: Record<PlaceKind, SizeRange | null> = {
  sector: null,
  cell: null,
  site: { label: "Margin", min: 0, max: 300, step: 10, start: 0 },
  landmark: { label: "Size", min: 50, max: 2000, step: 50, start: 150 },
  place: { label: "Size", min: 50, max: 2000, step: 50, start: 150 },
};

export const ROAD_WIDTH = { min: 10, max: 100, step: 5, start: 30 } as const;

/** 150 -> "150 m", 1200 -> "1.2 km". */
export const metres = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(m % 1000 === 0 ? 0 : 1)} km` : `${m} m`);
