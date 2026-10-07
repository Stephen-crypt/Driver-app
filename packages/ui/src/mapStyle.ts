/**
 * The map's look, shared by the phones (MapLibre in a WebView) and the
 * dashboard (MapLibre in the page).
 *
 * The tiles are OpenStreetMap vector tiles from OpenFreeMap: no key, no stated
 * limits, commercial use allowed. The raster tiles at tile.openstreetmap.org
 * that this replaces are a volunteer service that blocks apps without a Referer
 * - a WebView page loaded from a string has none - and hands back an "Access
 * blocked" picture with a 200, so nothing in the app ever noticed.
 *
 * Vector tiles are what make the map Nova's: every road class, label and land
 * colour is a value here, where the old CSS filter could only grey the whole
 * picture at once. The base is OpenFreeMap's Positron, recoloured: a cool grey
 * ground, white roads, blue-grey water and midnight type. Yellow is kept off
 * the map entirely, so on screen it only ever means Nova's own marks.
 */

/**
 * The OSM licence requires "© OpenStreetMap" on every map. The tiles carry that
 * credit themselves, and MapLibre's attribution control shows it, so a map
 * built from this style must keep that control on.
 */
export const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

/** Paint values by the Positron layer they replace. Layers not named keep Positron's own. */
export const MAP_PAINT = {
  background: { "background-color": "#ECEFF3" },
  landuse_residential: { "fill-color": "#E8ECF1" },
  park: { "fill-color": "#DCEBDF" },
  landcover_wood: { "fill-color": "#D9E8DC" },
  water: { "fill-color": "#C3D3E8" },
  waterway: { "line-color": "#C3D3E8" },
  building: { "fill-color": "#E0E5EC", "fill-outline-color": "#D2D9E3" },
  road_area_pier: { "fill-color": "#ECEFF3" },
  road_pier: { "line-color": "#ECEFF3" },
  highway_path: { "line-color": "#DDE3EB" },
  highway_minor: { "line-color": "#FFFFFF", "line-opacity": 1 },
  highway_major_casing: { "line-color": "#C9D3E1" },
  highway_major_inner: { "line-color": "#FFFFFF" },
  highway_major_subtle: { "line-color": "#D5DDE8" },
  highway_motorway_casing: { "line-color": "#A9B9CF" },
  highway_motorway_inner: { "line-color": "#FFFFFF" },
  highway_motorway_subtle: { "line-color": "#C9D3E1" },
  highway_motorway_bridge_casing: { "line-color": "#A9B9CF" },
  highway_motorway_bridge_inner: { "line-color": "#FFFFFF" },
  boundary_2: { "line-color": "#B4C0D3" },
  boundary_3: { "line-color": "#B4C0D3" },
  waterway_line_label: { "text-color": "#5D7AA3" },
  water_name_point_label: { "text-color": "#5D7AA3" },
  water_name_line_label: { "text-color": "#5D7AA3" },
  "highway-name-path": { "text-color": "#7C8BA0", "text-halo-color": "#FFFFFF" },
  "highway-name-minor": { "text-color": "#5B6B82", "text-halo-color": "#FFFFFF" },
  "highway-name-major": { "text-color": "#41526B", "text-halo-color": "#FFFFFF" },
  airport: { "text-color": "#41526B" },
  label_other: { "text-color": "#41526B" },
  label_village: { "text-color": "#0A2342" },
  label_town: { "text-color": "#0A2342" },
  label_state: { "text-color": "#41526B" },
  label_city: { "text-color": "#0A2342" },
  label_city_capital: { "text-color": "#0A2342" },
} as const satisfies Readonly<Record<string, Readonly<Record<string, unknown>>>>;

const PAINT_BY_ID: Readonly<Record<string, Readonly<Record<string, unknown>> | undefined>> = MAP_PAINT;

/**
 * Named places - markets, bus parks, hotels, schools - as small grey words.
 * Positron leaves them out; in Kigali they are how people say where they are,
 * so a map without them is a map nobody can read a pickup off.
 */
export const MAP_PLACES_LAYER = {
  id: "nova_places",
  type: "symbol",
  source: "openmaptiles",
  "source-layer": "poi",
  minzoom: 15,
  // Some places carry no rank; they count as the least important.
  filter: ["all", ["has", "name"], ["<", ["coalesce", ["get", "rank"], 99], 25]],
  layout: {
    "text-field": ["coalesce", ["get", "name_en"], ["get", "name"]],
    "text-font": ["Noto Sans Regular"],
    "text-size": 11,
    "text-max-width": 8,
    "symbol-sort-key": ["coalesce", ["get", "rank"], 99],
  },
  paint: { "text-color": "#6A7990", "text-halo-color": "#FFFFFF", "text-halo-width": 1.2 },
} as const;

/** Places go in under the town and city names, so those win any collision. */
const PLACES_BEFORE = "label_other";

interface StyleLayer {
  id: string;
  paint?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface MapStyleSpec {
  layers: StyleLayer[];
  [key: string]: unknown;
}

/** Positron, in Nova's colours and with the named places added. Returns a new style. */
export function brandMapStyle<T extends MapStyleSpec>(style: T): T {
  const layers: StyleLayer[] = style.layers.map((l) => {
    const paint = PAINT_BY_ID[l.id];
    return paint ? { ...l, paint: { ...l.paint, ...paint } } : l;
  });
  const at = layers.findIndex((l) => l.id === PLACES_BEFORE);
  const places = JSON.parse(JSON.stringify(MAP_PLACES_LAYER)) as StyleLayer;
  if (at >= 0) layers.splice(at, 0, places);
  else layers.push(places);
  return { ...style, layers };
}
