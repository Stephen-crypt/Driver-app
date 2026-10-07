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
 * colour is a value here. The base is OpenFreeMap's Positron, made easier to
 * read on a phone in the sun: a cool grey ground, white roads with an edge so
 * the small ones stand out, larger street names, and the shops, markets and
 * bus stops people give directions by, with their icons. Yellow is kept off
 * the map entirely, so on screen it only ever means Nova's own marks.
 *
 * Both renderers apply the same spec - brandMapStyle here, brand() in the
 * WebView page - so everything below is plain data.
 */

/**
 * The OSM licence requires "© OpenStreetMap" on every map. The tiles carry that
 * credit themselves, and MapLibre's attribution control shows it, so a map
 * built from this style must keep that control on.
 */
export const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

/** Paint values by the Positron layer they replace. Layers not named keep Positron's own. */
export const MAP_PAINT = {
  background: { "background-color": "#E8EBF0" },
  landuse_residential: { "fill-color": "#E3E7ED" },
  park: { "fill-color": "#D2E7D6" },
  landcover_wood: { "fill-color": "#CFE3D3" },
  water: { "fill-color": "#AFC8E6" },
  waterway: { "line-color": "#AFC8E6" },
  building: { "fill-color": "#D9DEE6", "fill-outline-color": "#C9D0DA" },
  road_area_pier: { "fill-color": "#E8EBF0" },
  road_pier: { "line-color": "#E8EBF0" },
  highway_path: { "line-color": "#D3DAE3" },
  highway_minor: { "line-color": "#FFFFFF", "line-opacity": 1 },
  highway_major_casing: { "line-color": "#B7C3D3" },
  highway_major_inner: { "line-color": "#FFFFFF" },
  highway_major_subtle: { "line-color": "#C9D2DE" },
  highway_motorway_casing: { "line-color": "#9FB2CB" },
  highway_motorway_inner: { "line-color": "#FFFFFF" },
  highway_motorway_subtle: { "line-color": "#B7C3D3" },
  highway_motorway_bridge_casing: { "line-color": "#9FB2CB" },
  highway_motorway_bridge_inner: { "line-color": "#FFFFFF" },
  boundary_2: { "line-color": "#B4C0D3" },
  boundary_3: { "line-color": "#B4C0D3" },
  waterway_line_label: { "text-color": "#4F6E99" },
  water_name_point_label: { "text-color": "#4F6E99" },
  water_name_line_label: { "text-color": "#4F6E99" },
  "highway-name-path": { "text-color": "#6A7990", "text-halo-color": "#FFFFFF" },
  "highway-name-minor": { "text-color": "#4A5A70", "text-halo-color": "#FFFFFF", "text-halo-width": 1.4 },
  "highway-name-major": { "text-color": "#33435A", "text-halo-color": "#FFFFFF", "text-halo-width": 1.4 },
  airport: { "text-color": "#33435A" },
  label_other: { "text-color": "#4A5A70" },
  label_village: { "text-color": "#0A2342" },
  label_town: { "text-color": "#0A2342" },
  label_state: { "text-color": "#4A5A70" },
  label_city: { "text-color": "#0A2342" },
  label_city_capital: { "text-color": "#0A2342" },
} as const satisfies Readonly<Record<string, Readonly<Record<string, unknown>>>>;

/** Layout values by layer: bigger street and area names than Positron's. */
export const MAP_LAYOUT = {
  "highway-name-minor": { "text-size": ["interpolate", ["linear"], ["zoom"], 15, 12.5, 17, 14.5] },
  "highway-name-major": { "text-size": ["interpolate", ["linear"], ["zoom"], 12, 12, 16, 15] },
  label_other: { "text-size": ["interpolate", ["linear"], ["zoom"], 10, 10.5, 15, 13.5] },
} as const satisfies Readonly<Record<string, Readonly<Record<string, unknown>>>>;

/**
 * Edges for road layers that have none, drawn just under them: as wide as the
 * road itself through line-gap-width, so a thin line shows on both sides.
 * White side streets on a grey ground were close to invisible without one.
 */
export const MAP_CASINGS = [{ id: "nova_minor_casing", of: "highway_minor", color: "#C6CFDB", width: 1.1 }] as const;

const PLACE_NAME = ["coalesce", ["get", "name_en"], ["get", "name"]];
const PLACE_ICON = ["match", ["get", "subclass"], ["florist", "furniture"], ["get", "subclass"], ["get", "class"]];
const PLACE_PAINT = { "text-color": "#5B6B82", "text-halo-color": "#FFFFFF", "text-halo-width": 1.2 };
// Some places carry no rank; they count as the least important.
const RANK = ["coalesce", ["get", "rank"], 99];

const placesLayer = (id: string, minzoom: number, rank: readonly unknown[]) => ({
  id,
  type: "symbol",
  source: "openmaptiles",
  "source-layer": "poi",
  minzoom,
  filter: ["all", ["match", ["geometry-type"], ["MultiPoint", "Point"], true, false], ...rank],
  layout: {
    "icon-image": PLACE_ICON,
    "icon-size": 0.85,
    "text-field": PLACE_NAME,
    "text-font": ["Noto Sans Regular"],
    "text-size": 11.5,
    "text-max-width": 8,
    "text-anchor": "top",
    "text-offset": [0, 0.7],
    "text-optional": true,
  },
  paint: PLACE_PAINT,
});

/**
 * Named places - markets, bus parks, hotels, schools, shops - with their icon.
 * Positron leaves them out; in Kigali they are how people say where they are,
 * so a map without them is a map nobody can read a pickup off. The most
 * important arrive first as you zoom in. The icons are OpenFreeMap's own
 * sprite, which Positron already loads.
 */
export const MAP_PLACES_LAYERS = [
  placesLayer("nova_places_main", 14, [["<", RANK, 7]]),
  placesLayer("nova_places_more", 15.5, [[">=", RANK, 7], ["<", RANK, 20]]),
  placesLayer("nova_places_all", 17, [[">=", RANK, 20]]),
  {
    id: "nova_places_transit",
    type: "symbol",
    source: "openmaptiles",
    "source-layer": "poi",
    minzoom: 14,
    filter: ["match", ["get", "class"], ["bus", "airport"], true, false],
    layout: {
      "icon-image": ["to-string", ["get", "class"]],
      "icon-size": 0.8,
      "text-field": PLACE_NAME,
      "text-font": ["Noto Sans Regular"],
      "text-size": 11.5,
      "text-max-width": 8,
      "text-anchor": "left",
      "text-offset": [0.9, 0],
      "text-optional": true,
    },
    paint: { ...PLACE_PAINT, "text-color": "#2E5A80" },
  },
] as const;

/** Places go in under the town and city names, so those win any collision. */
export const MAP_PLACES_BEFORE = "label_other";

const PAINT_BY_ID: Readonly<Record<string, Readonly<Record<string, unknown>> | undefined>> = MAP_PAINT;
const LAYOUT_BY_ID: Readonly<Record<string, Readonly<Record<string, unknown>> | undefined>> = MAP_LAYOUT;

interface StyleLayer {
  id: string;
  paint?: Record<string, unknown>;
  layout?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface MapStyleSpec {
  layers: StyleLayer[];
  [key: string]: unknown;
}

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Positron in Nova's colours, with road edges and named places added. Returns a new style. */
export function brandMapStyle<T extends MapStyleSpec>(style: T): T {
  const layers: StyleLayer[] = [];
  for (const l of style.layers) {
    for (const edge of MAP_CASINGS) {
      if (edge.of === l.id) {
        layers.push({
          ...copy(l),
          id: edge.id,
          paint: { "line-color": edge.color, "line-width": edge.width, "line-gap-width": l.paint?.["line-width"] ?? 1 },
        });
      }
    }
    const paint = PAINT_BY_ID[l.id];
    const layout = LAYOUT_BY_ID[l.id];
    layers.push(paint || layout ? { ...l, paint: { ...l.paint, ...paint }, layout: { ...l.layout, ...layout } } : l);
  }
  const at = layers.findIndex((l) => l.id === MAP_PLACES_BEFORE);
  layers.splice(at < 0 ? layers.length : at, 0, ...copy(MAP_PLACES_LAYERS as unknown as StyleLayer[]));
  return { ...style, layers };
}
