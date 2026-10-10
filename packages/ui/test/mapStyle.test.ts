import { describe, it, expect } from "vitest";
import { brandMapStyle, MAP_CASINGS, MAP_LAYOUT, MAP_PAINT, MAP_PAINT_DARK, MAP_PLACES_LAYERS, mapTheme } from "../src/mapStyle";
import { contrastRatio } from "../src/tokens";

const minorWidth = ["interpolate", ["exponential", 1.55], ["zoom"], 13, 1.8, 20, 20];

const positron = () => ({
  version: 8,
  sources: {},
  layers: [
    { id: "background", type: "background", paint: { "background-color": "rgb(242,243,240)" } },
    { id: "water", type: "fill", paint: { "fill-color": "grey", "fill-antialias": true } },
    { id: "highway_minor", type: "line", filter: ["==", "class", "minor"], paint: { "line-color": "#ddd", "line-width": minorWidth } },
    { id: "railway", type: "line", paint: { "line-color": "#ddd" } },
    { id: "highway-name-minor", type: "symbol", layout: { "text-font": ["Noto Sans Regular"], "text-size": 12 }, paint: { "text-color": "#666" } },
    { id: "label_other", type: "symbol", paint: { "text-color": "#333" } },
    { id: "label_city", type: "symbol", paint: { "text-color": "#000" } },
  ],
});

const ids = () => brandMapStyle(positron()).layers.map((l) => l.id);

describe("brandMapStyle", () => {
  it("recolours the layers it names and keeps their other paint", () => {
    const water = brandMapStyle(positron()).layers.find((l) => l.id === "water")!;
    expect(water.paint).toEqual({ "fill-color": MAP_PAINT.water["fill-color"], "fill-antialias": true });
  });

  it("leaves layers it does not name alone", () => {
    expect(brandMapStyle(positron()).layers.find((l) => l.id === "railway")!.paint).toEqual({ "line-color": "#ddd" });
  });

  it("enlarges street names and keeps their font", () => {
    const names = brandMapStyle(positron()).layers.find((l) => l.id === "highway-name-minor")!;
    expect(names.layout).toEqual({ "text-font": ["Noto Sans Regular"], "text-size": MAP_LAYOUT["highway-name-minor"]["text-size"] });
  });

  it("draws an edge under side streets, as wide as the street, from the same filter", () => {
    const layers = brandMapStyle(positron()).layers;
    const edge = layers.find((l) => l.id === MAP_CASINGS[0].id)!;
    expect(ids().indexOf(MAP_CASINGS[0].id)).toBe(ids().indexOf("highway_minor") - 1);
    expect((edge.paint as Record<string, unknown>)["line-gap-width"]).toEqual(minorWidth);
    expect(edge.filter).toEqual(["==", "class", "minor"]);
  });

  it("puts named places under the town names, so those win a collision", () => {
    const order = ids();
    const places = MAP_PLACES_LAYERS.map((l) => order.indexOf(l.id));
    expect(places.every((i) => i >= 0 && i < order.indexOf("label_other"))).toBe(true);
    expect(order.indexOf("label_other") - 1).toBe(Math.max(...places));
  });

  it("does not change the style it was given", () => {
    const style = positron();
    const before = JSON.stringify(style);
    brandMapStyle(style);
    expect(JSON.stringify(style)).toBe(before);
  });

  it("keeps road and place names readable on the ground", () => {
    const ground = MAP_PAINT.background["background-color"];
    for (const id of ["highway-name-minor", "highway-name-major", "label_city", "label_town"] as const) {
      expect(contrastRatio(MAP_PAINT[id]["text-color"], ground)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrastRatio(MAP_PLACES_LAYERS[0]!.paint["text-color"], ground)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("the night map", () => {
  it("paints at least every layer and property the day map paints", () => {
    const night = MAP_PAINT_DARK as Record<string, Record<string, unknown>>;
    for (const id of Object.keys(MAP_PAINT) as (keyof typeof MAP_PAINT)[]) {
      expect(night[id], id).toBeDefined();
      for (const key of Object.keys(MAP_PAINT[id])) expect(Object.keys(night[id]!), `${id} ${key}`).toContain(key);
    }
  });

  it("gives every name it paints a night halo - a white glow behind pale type is a smudge", () => {
    for (const [id, paint] of Object.entries(MAP_PAINT_DARK as Record<string, Record<string, unknown>>)) {
      if (!("text-color" in paint)) continue;
      const halo = String(paint["text-halo-color"] ?? "");
      expect(halo, id).toMatch(/^(#0A1220|rgba\(10, ?18, ?32, ?0?\.\d+\))$/i);
    }
  });

  it("leaves nothing day-white at night: airport, railways, tunnels, country names", () => {
    const night = MAP_PAINT_DARK as unknown as Record<string, Record<string, string>>;
    const dayWhite = ["aeroway-area", "aeroway-runway", "aeroway-taxiway", "aeroway-runway-casing", "railway", "railway_dashline",
      "railway_transit", "railway_transit_dashline", "railway_service", "railway_service_dashline", "tunnel_motorway_casing",
      "tunnel_motorway_inner"];
    for (const id of dayWhite) {
      const colour = night[id]?.["fill-color"] ?? night[id]?.["line-color"];
      expect(colour, id).toBeDefined();
      expect(contrastRatio(colour!, "#000000"), id).toBeLessThan(3);
    }
    for (const id of ["label_country_1", "label_country_2", "label_country_3"]) expect(night[id]?.["text-halo-color"], id).toBe("#0A1220");
  });

  it("is applied by brandMapStyle for the dark scheme", () => {
    const water = brandMapStyle(positron(), "dark").layers.find((l) => l.id === "water")!;
    expect(water.paint).toEqual({ "fill-color": MAP_PAINT_DARK.water["fill-color"], "fill-antialias": true });
    const edge = brandMapStyle(positron(), "dark").layers.find((l) => l.id === MAP_CASINGS[0].id)!;
    expect(edge.paint?.["line-color"]).toBe(mapTheme("dark").casings[0]!.color);
  });

  it("keeps the day map as the default", () => {
    expect(brandMapStyle(positron()).layers.find((l) => l.id === "water")!.paint?.["fill-color"]).toBe(MAP_PAINT.water["fill-color"]);
  });

  it("every name on the night map reads against its ground", () => {
    const ground = MAP_PAINT_DARK.background["background-color"];
    for (const id of ["highway-name-path", "highway-name-minor", "highway-name-major", "label_other", "label_village", "label_city", "airport"] as const) {
      expect(contrastRatio((MAP_PAINT_DARK[id] as { "text-color": string })["text-color"], ground)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrastRatio(MAP_PAINT_DARK.water_name_point_label["text-color"], MAP_PAINT_DARK.water["fill-color"])).toBeGreaterThanOrEqual(4.5);
    for (const l of mapTheme("dark").places) {
      expect(contrastRatio((l.paint as { "text-color": string })["text-color"], ground)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
